import type { Citation } from './agent.types';

export type CitationSegment =
  | { type: 'text'; text: string }
  | { type: 'citation'; citation: Citation };

export class CitationText {
  /** Matches the [c:<chunk_id>] markers the recall agent emits. */
  private static readonly MARKER_PATTERN = /\[c:([^\]\s]+)\]/g;

  /**
   * Splits answer text into renderable segments. Markers whose chunk is missing from
   * `citations` are dropped entirely rather than shown raw - a dangling id is noise.
   */
  static parse(text: string, citations: Citation[] = []): CitationSegment[] {
    if (!text) return [];
    const by_chunk_id = new Map(citations.map((c) => [c.chunk_id, c]));
    const segments: CitationSegment[] = [];
    let cursor = 0;

    for (const match of text.matchAll(CitationText.MARKER_PATTERN)) {
      const start = match.index ?? 0;
      CitationText.pushText(segments, text.slice(cursor, start));
      cursor = start + match[0].length;

      const citation = by_chunk_id.get(match[1]);
      if (citation) segments.push({ type: 'citation', citation });
    }

    CitationText.pushText(segments, text.slice(cursor));
    return segments;
  }

  private static pushText(segments: CitationSegment[], text: string): void {
    if (!text) return;
    segments.push({ type: 'text', text });
  }

  static headingLabel(citation: Citation): string {
    return citation.heading_path?.length ? citation.heading_path.join(' › ') : '';
  }
}
