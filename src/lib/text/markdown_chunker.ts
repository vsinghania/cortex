import { createHash } from 'node:crypto';
import { Tokenizer } from './tokenizer.js';

export type ChunkSpec = {
  content: string;
  token_count: number;
  hash: string;
  heading_path?: string[];
};

type Block = {
  text: string;
  heading_path: string[];
};

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

  private static toBlocks(body: string): Block[] {
    const lines = body.split(/\r?\n/);
    const blocks: Block[] = [];
    const heading_stack: string[] = [];
    let buffer: string[] = [];

    const flush = () => {
      if (!buffer.length) return;
      const text = buffer.join('\n').trim();
      buffer = [];
      if (!text) return;
      blocks.push({ text, heading_path: [...heading_stack] });
    };

    for (const line of lines) {
      const heading_match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading_match) {
        flush();
        const depth = heading_match[1].length;
        const title = heading_match[2].trim();
        heading_stack.length = Math.max(0, depth - 1);
        heading_stack[depth - 1] = title;
        continue;
      }

      if (line.trim() === '') {
        flush();
        continue;
      }

      buffer.push(line);
    }
    flush();
    return blocks;
  }

  private static packBlocks(blocks: Block[], opts: ChunkOptions): ChunkSpec[] {
    const target = Math.max(64, opts.target_tokens);
    const overlap = Math.max(0, Math.min(opts.overlap_tokens, Math.floor(target / 2)));

    const out: ChunkSpec[] = [];
    let current_text = '';
    let current_tokens = 0;
    let current_heading: string[] = [];

    const finalize = () => {
      if (!current_text.trim()) return;
      out.push(MarkdownChunker.toSpec(current_text, current_tokens, current_heading));
    };

    for (const block of blocks) {
      const block_tokens = Tokenizer.countTokens(block.text);

      if (block_tokens > target) {
        if (current_text) {
          finalize();
          current_text = '';
          current_tokens = 0;
        }
        for (const piece of MarkdownChunker.splitOversizedBlock(block.text, target, overlap)) {
          out.push(MarkdownChunker.toSpec(piece.text, piece.token_count, block.heading_path));
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
      } else {
        current_text = current_text ? `${current_text}\n\n${block.text}` : block.text;
        current_tokens = candidate_tokens;
      }
      current_heading = block.heading_path;
    }
    finalize();
    return out;
  }

  private static splitOversizedBlock(
    text: string,
    target_tokens: number,
    overlap_tokens: number
  ): { text: string; token_count: number }[] {
    const tokens = Tokenizer.encode(text);
    const out: { text: string; token_count: number }[] = [];
    const stride = Math.max(1, target_tokens - overlap_tokens);
    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(tokens.length, start + target_tokens);
      const slice = tokens.slice(start, end);
      out.push({ text: Tokenizer.decode(slice), token_count: slice.length });
      if (end >= tokens.length) break;
      start += stride;
    }
    return out;
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

  private static toSpec(text: string, token_count: number, heading_path: string[]): ChunkSpec {
    const trimmed = text.trim();
    return {
      content: trimmed,
      token_count,
      hash: MarkdownChunker.hashContent(trimmed),
      heading_path: heading_path.length ? [...heading_path] : undefined
    };
  }

  private static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
