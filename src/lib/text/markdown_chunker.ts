import { createHash } from 'node:crypto';
import { Tokenizer } from './tokenizer.js';

export type CharRange = {
  /** Inclusive char index into the source body. */
  start: number;
  /** Exclusive char index into the source body. */
  end: number;
};

export type ChunkSpec = {
  content: string;
  token_count: number;
  hash: string;
  heading_path?: string[];
  start_offset: number;
  end_offset: number;
};

type Line = {
  text: string;
  start: number;
  /** Exclusive; excludes the line separator. */
  end: number;
};

type Block = {
  text: string;
  heading_path: string[];
} & CharRange;

export type ChunkOptions = {
  target_tokens: number;
  overlap_tokens: number;
};

export class MarkdownChunker {

  private constructor() {}

  static chunk(body: string, opts: ChunkOptions): ChunkSpec[] {
    if (!body || !body.trim()) return [];

    const blocks = MarkdownChunker.toBlocks(body);
    return MarkdownChunker.packBlocks(blocks, opts);
  }

  /**
   * Splits on newlines while keeping each line's char range, so chunks can carry
   * offsets back into the original body. Ranges are computed from the source
   * separators rather than the rejoined text, which keeps them accurate for CRLF
   * bodies even though the rejoined block text normalizes to LF.
   */
  private static toLines(body: string): Line[] {
    const lines: Line[] = [];
    const separator = /\r?\n/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = separator.exec(body)) !== null) {
      lines.push({ text: body.slice(cursor, match.index), start: cursor, end: match.index });
      cursor = match.index + match[0].length;
    }
    lines.push({ text: body.slice(cursor), start: cursor, end: body.length });
    return lines;
  }

  private static toBlocks(body: string): Block[] {
    const blocks: Block[] = [];
    const heading_stack: string[] = [];
    let buffer: Line[] = [];

    const flush = () => {
      if (!buffer.length) return;
      const buffered = buffer;
      buffer = [];
      const text = buffered.map((l) => l.text).join('\n').trim();
      if (!text) return;
      const range = MarkdownChunker.trimmedRange(buffered);
      blocks.push({ text, heading_path: [...heading_stack], ...range });
    };

    for (const line of MarkdownChunker.toLines(body)) {
      const heading_match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
      if (heading_match) {
        flush();
        const depth = heading_match[1].length;
        const title = heading_match[2].trim();
        heading_stack.length = Math.max(0, depth - 1);
        heading_stack[depth - 1] = title;
        continue;
      }

      if (line.text.trim() === '') {
        flush();
        continue;
      }

      buffer.push(line);
    }
    flush();
    return blocks;
  }

  /** Mirrors the `.trim()` applied to the rejoined block text. Buffered lines are never blank. */
  private static trimmedRange(lines: Line[]): CharRange {
    const first = lines[0];
    const last = lines[lines.length - 1];
    const leading_ws = first.text.length - first.text.trimStart().length;
    const trailing_ws = last.text.length - last.text.trimEnd().length;
    return { start: first.start + leading_ws, end: last.end - trailing_ws };
  }

  private static packBlocks(blocks: Block[], opts: ChunkOptions): ChunkSpec[] {
    const target = Math.max(64, opts.target_tokens);
    const overlap = Math.max(0, Math.min(opts.overlap_tokens, Math.floor(target / 2)));

    const out: ChunkSpec[] = [];
    let current_text = '';
    let current_tokens = 0;
    let current_heading: string[] = [];
    let current_range: CharRange = { start: 0, end: 0 };

    const finalize = () => {
      if (!current_text.trim()) return;
      out.push(MarkdownChunker.toSpec(current_text, current_tokens, current_heading, current_range));
    };

    for (const block of blocks) {
      const block_tokens = Tokenizer.countTokens(block.text);

      if (block_tokens > target) {
        if (current_text) {
          finalize();
          current_text = '';
          current_tokens = 0;
        }
        for (const piece of MarkdownChunker.splitOversizedBlock(block, target, overlap)) {
          out.push(MarkdownChunker.toSpec(piece.text, piece.token_count, block.heading_path, piece.range));
        }
        current_heading = block.heading_path;
        continue;
      }

      const candidate_tokens = current_tokens === 0 ? block_tokens : current_tokens + block_tokens + 1;
      const heading_changed = !MarkdownChunker.headingsEqual(current_heading, block.heading_path);

      if (current_tokens > 0 && (candidate_tokens > target || heading_changed)) {
        finalize();
        const tail = MarkdownChunker.tailForOverlap(current_text, overlap);
        current_text = tail ? `${tail}\n\n${block.text}` : block.text;
        current_tokens = Tokenizer.countTokens(current_text);
        // The overlap tail is embedding context borrowed from the previous chunk; the
        // offsets describe only this chunk's own material so highlights don't overlap.
        current_range = { start: block.start, end: block.end };
      } else {
        const is_first_block = current_text === '';
        current_text = current_text ? `${current_text}\n\n${block.text}` : block.text;
        current_tokens = candidate_tokens;
        if (is_first_block) current_range = { start: block.start, end: block.end };
        else current_range = { start: current_range.start, end: block.end };
      }
      current_heading = block.heading_path;
    }
    finalize();
    return out;
  }

  private static splitOversizedBlock(
    block: Block,
    target_tokens: number,
    overlap_tokens: number
  ): { text: string; token_count: number; range: CharRange }[] {
    const tokens = Tokenizer.encode(block.text);
    const out: { text: string; token_count: number; range: CharRange }[] = [];
    const stride = Math.max(1, target_tokens - overlap_tokens);
    const stride_offsets = MarkdownChunker.strideCharOffsets(tokens, stride);
    let start = 0;
    let stride_index = 0;
    while (start < tokens.length) {
      const end = Math.min(tokens.length, start + target_tokens);
      const slice = tokens.slice(start, end);
      const text = Tokenizer.decode(slice);
      const piece_start = Math.min(block.end, block.start + stride_offsets[stride_index]);
      out.push({
        text,
        token_count: slice.length,
        range: { start: piece_start, end: Math.min(block.end, piece_start + text.length) }
      });
      if (end >= tokens.length) break;
      start += stride;
      stride_index += 1;
    }
    return out;
  }

  /**
   * Cumulative char length of the decoded text preceding each stride boundary.
   * Decodes every token exactly once instead of re-decoding growing prefixes.
   */
  private static strideCharOffsets(tokens: number[], stride: number): number[] {
    const offsets: number[] = [];
    let chars = 0;
    for (let i = 0; i < tokens.length; i += stride) {
      offsets.push(chars);
      chars += Tokenizer.decode(tokens.slice(i, Math.min(tokens.length, i + stride))).length;
    }
    return offsets;
  }

  private static tailForOverlap(text: string, overlap_tokens: number): string {
    if (overlap_tokens <= 0) return '';
    const tokens = Tokenizer.encode(text);
    if (tokens.length <= overlap_tokens) return text;
    return Tokenizer.decode(tokens.slice(tokens.length - overlap_tokens));
  }

  private static headingsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private static toSpec(
    text: string,
    token_count: number,
    heading_path: string[],
    range: CharRange
  ): ChunkSpec {
    const trimmed = text.trim();
    return {
      content: trimmed,
      token_count,
      hash: MarkdownChunker.hashContent(trimmed),
      heading_path: heading_path.length ? [...heading_path] : undefined,
      start_offset: range.start,
      end_offset: range.end
    };
  }

  private static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
