import type { OutlineHeading } from './note_workspace.types';

export class NoteOutline {
  private static readonly HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
  private static readonly FENCE_PATTERN = /^\s*(```|~~~)/;
  private static readonly LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/g;
  private static readonly SYNTAX_PATTERN = /^#{1,6}\s+|^\s*[-*+]\s+|\[[ xX]\]|[*_`>~#|]/gm;

  /** H1-H3 only, skipping anything inside fenced code blocks. */
  static headings(body: string): OutlineHeading[] {
    const headings: OutlineHeading[] = [];
    let in_fence = false;
    body.split('\n').forEach((line, index) => {
      if (NoteOutline.FENCE_PATTERN.test(line)) {
        in_fence = !in_fence;
        return;
      }
      if (in_fence) return;
      const match = NoteOutline.HEADING_PATTERN.exec(line);
      if (match) {
        headings.push({ line: index + 1, level: match[1].length as 1 | 2 | 3, text: match[2] });
      }
    });
    return headings;
  }

  static wordCount(body: string): number {
    const plain = body.replace(NoteOutline.LINK_PATTERN, '$1').replace(NoteOutline.SYNTAX_PATTERN, ' ');
    return plain.split(/\s+/).filter(Boolean).length;
  }

  /** Drops inline emphasis and code markers from an excerpt that is already heading-free. */
  static plainExcerpt(excerpt: string): string {
    return excerpt.replace(NoteOutline.LINK_PATTERN, '$1').replace(/(\*\*|__|[*_`~])/g, '');
  }

  static lineStartOffset(body: string, line: number): number {
    const lines = body.split('\n');
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    return offset;
  }

  static lineCount(body: string): number {
    return body.split('\n').length;
  }
}
