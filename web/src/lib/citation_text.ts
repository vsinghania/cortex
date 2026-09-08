import type { Citation } from './agent.types';

export class CitationText {
  /** Matches the [c:<chunk_id>] markers the recall agent emits. */
  private static readonly MARKER_PATTERN = /\[c:([^\]\s]+)\]/g;

  /** Private URL scheme markers are rewritten to, so the markdown renderer can spot them. */
  private static readonly HREF_SCHEME = 'citation:';

  /**
   * Rewrites citation markers into markdown links so the answer can be parsed as a
   * single markdown document with the citations still inline. Markers whose chunk is
   * missing from `citations` are dropped entirely rather than shown raw - a dangling
   * id is noise.
   */
  static toMarkdown(text: string, citations: Citation[] = []): string {
    if (!text) return '';
    const by_chunk_id = new Map(citations.map((c) => [c.chunk_id, c]));

    return text.replace(CitationText.MARKER_PATTERN, (_marker, chunk_id: string) => {
      const citation = by_chunk_id.get(chunk_id);
      if (!citation) return '';
      return `[${citation.index}](${CitationText.HREF_SCHEME}${encodeURIComponent(chunk_id)})`;
    });
  }

  /** Returns the chunk_id a rewritten link points at, or null for an ordinary link. */
  static chunkIdFromHref(href: string | undefined): string | null {
    if (!href?.startsWith(CitationText.HREF_SCHEME)) return null;
    return decodeURIComponent(href.slice(CitationText.HREF_SCHEME.length));
  }

  /** react-markdown drops unknown schemes by default; keep ours intact. */
  static isCitationHref(href: string): boolean {
    return href.startsWith(CitationText.HREF_SCHEME);
  }

  static headingLabel(citation: Citation): string {
    return citation.heading_path?.length ? citation.heading_path.join(' › ') : '';
  }
}
