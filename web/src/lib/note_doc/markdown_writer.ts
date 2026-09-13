/**
 * A markdown range that maps back to editor document positions. Literal runs map 1:1;
 * an escaped character maps two markdown chars (`\*`) to one document char.
 */
export type MarkdownSegment = {
  md_from: number;
  md_to: number;
  doc_from: number;
  doc_to: number;
};

export type LinePrefix = {
  /** Emitted on the first line, e.g. a list marker. */
  first: string;
  /** Emitted on every following line, e.g. the marker-width indent. */
  rest: string;
};

type ActivePrefix = LinePrefix & { used: boolean };

/**
 * Appends markdown while tracking two things the serializer cannot reconstruct after the
 * fact: container prefixes (`> `, list indents) that must start every line, and where
 * each document character landed in the output.
 */
export class MarkdownWriter {
  private static readonly INLINE_SPECIALS = new Set(['\\', '*', '`', '[', ']', '~']);
  private static readonly LINE_START_SPECIALS = new Set(['#', '>', '-', '+']);
  private static readonly ORDERED_MARKER = /^\d{1,9}[.)]/;
  private static readonly WORD_CHAR = /[\p{L}\p{N}]/u;

  private out = '';
  private readonly segments: MarkdownSegment[] = [];
  private readonly prefixes: ActivePrefix[] = [];
  private at_line_start = true;

  withPrefix(prefix: LinePrefix, render: () => void): void {
    this.prefixes.push({ ...prefix, used: false });
    try {
      render();
    } finally {
      this.prefixes.pop();
    }
  }

  /** Markdown syntax (delimiters, markers, fences); never mapped back to the document. */
  writeSyntax(syntax: string): void {
    this.startLineIfNeeded();
    this.out += syntax;
  }

  writeText(text: string, doc_from: number, opts: { escape: boolean }): void {
    let ordered_marker_delimiter_at = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        this.newline();
        continue;
      }

      const line_start = this.at_line_start;
      this.startLineIfNeeded();
      if (opts.escape && line_start) {
        ordered_marker_delimiter_at = MarkdownWriter.orderedMarkerDelimiterIndex(text, i);
      }

      const escaped = opts.escape && (
        i === ordered_marker_delimiter_at ||
        MarkdownWriter.isInlineSpecial(text, i) ||
        (line_start && MarkdownWriter.LINE_START_SPECIALS.has(ch))
      );

      const md_from = this.out.length;
      this.out += escaped ? `\\${ch}` : ch;
      this.recordSegment({ md_from, md_to: this.out.length, doc_from: doc_from + i, doc_to: doc_from + i + 1 });
    }
  }

  newline(): void {
    this.out += '\n';
    this.at_line_start = true;
  }

  /** Ends the current line and leaves an empty one, keeping blockquote markers on it. */
  blankLine(): void {
    this.newline();
    this.out += this.prefixes.map((p) => (p.used ? p.rest : p.first)).join('').trimEnd();
    this.newline();
  }

  finish(): { markdown: string; segments: MarkdownSegment[] } {
    const markdown = this.out.replace(/\s+$/, '');
    return { markdown, segments: this.segments.filter((s) => s.md_from < markdown.length) };
  }

  private startLineIfNeeded(): void {
    if (!this.at_line_start) return;
    for (const prefix of this.prefixes) {
      this.out += prefix.used ? prefix.rest : prefix.first;
      prefix.used = true;
    }
    this.at_line_start = false;
  }

  private recordSegment(next: MarkdownSegment): void {
    const last = this.segments[this.segments.length - 1];
    if (
      last &&
      MarkdownWriter.isLiteral(last) &&
      MarkdownWriter.isLiteral(next) &&
      last.md_to === next.md_from &&
      last.doc_to === next.doc_from
    ) {
      last.md_to = next.md_to;
      last.doc_to = next.doc_to;
      return;
    }
    this.segments.push(next);
  }

  private static isLiteral(segment: MarkdownSegment): boolean {
    return segment.md_to - segment.md_from === segment.doc_to - segment.doc_from;
  }

  /** `_` only opens emphasis at a word boundary, so escaping it inside snake_case would just add noise. */
  private static isInlineSpecial(text: string, i: number): boolean {
    const ch = text[i];
    if (ch === '_') {
      return !(MarkdownWriter.WORD_CHAR.test(text[i - 1] ?? '') && MarkdownWriter.WORD_CHAR.test(text[i + 1] ?? ''));
    }
    return MarkdownWriter.INLINE_SPECIALS.has(ch);
  }

  /** A paragraph starting with "1." would otherwise re-parse as an ordered list. */
  private static orderedMarkerDelimiterIndex(text: string, i: number): number {
    const match = MarkdownWriter.ORDERED_MARKER.exec(text.slice(i));
    return match ? i + match[0].length - 1 : -1;
  }
}
