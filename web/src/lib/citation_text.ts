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

  /**
   * Turns an answer into a self-contained note body: markers become "[n]" and the cited
   * sources are appended with links to their notes. Raw chunk ids would otherwise be
   * saved, and embedded, as noise.
   */
  static toPlainWithSources(text: string, citations: Citation[] = []): string {
    const by_chunk_id = new Map(citations.map((c) => [c.chunk_id, c]));
    const cited = new Map<number, Citation>();

    const body = text
      .replace(CitationText.MARKER_PATTERN, (_marker, chunk_id: string) => {
        const citation = by_chunk_id.get(chunk_id);
        if (!citation) return '';
        cited.set(citation.index, citation);
        return `[${citation.index}]`;
      })
      .trim();

    if (cited.size === 0) return body;

    const source_lines = [...cited.values()]
      .sort((a, b) => a.index - b.index)
      .map((citation) => `- [${citation.index}] ${CitationText.sourceLabel(citation)}`);
    return `${body}\n\n**Sources**\n\n${source_lines.join('\n')}`;
  }

  private static sourceLabel(citation: Citation): string {
    const heading = CitationText.headingLabel(citation);
    const label = (heading ? `${citation.document_title} › ${heading}` : citation.document_title).replace(/[[\]]/g, '');
    const linkable = citation.document_available && citation.corpus === 'notes';
    return linkable ? `[${label}](/notes/${encodeURIComponent(citation.document_id)})` : label;
  }

  static headingLabel(citation: Citation): string {
    return citation.heading_path?.length ? citation.heading_path.join(' › ') : '';
  }
}
