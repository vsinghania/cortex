import type { HighlightRange, NoteChunkRef } from './note.types';

export class NoteHighlight {
  /**
   * Chunk content is not a guaranteed substring of the body (headings are dropped, blank
   * lines collapse, oversized blocks round-trip through the tokenizer), so offsets are the
   * primary anchor and a literal search is the fallback for chunks written before offsets
   * existed.
   */
  static resolve(body: string, chunk: NoteChunkRef | null): HighlightRange | null {
    if (!chunk) return null;

    const { start_offset, end_offset } = chunk;
    if (
      start_offset != null &&
      end_offset != null &&
      start_offset >= 0 &&
      end_offset > start_offset &&
      end_offset <= body.length
    ) {
      return { start: start_offset, end: end_offset };
    }

    const found = body.indexOf(chunk.content);
    if (found !== -1) return { start: found, end: found + chunk.content.length };

    return null;
  }
}
