import type { Note } from './note.types';

export class NotePreview {
  private static readonly HEADING_MARKER = /^#{1,6}\s+/;
  private static readonly MAX_CHARS = 400;

  /**
   * Plain-text excerpt for list rows. Heading markers are stripped, and a leading heading
   * that just repeats the title is dropped so the card doesn't say the same thing twice.
   */
  static excerpt(note: Pick<Note, 'title' | 'body'>): string {
    const lines = note.body
      .split('\n')
      .map((line) => line.replace(NotePreview.HEADING_MARKER, '').trim())
      .filter((line) => line.length > 0);

    if (lines[0]?.toLowerCase() === note.title.trim().toLowerCase()) lines.shift();

    return lines.join('\n').slice(0, NotePreview.MAX_CHARS);
  }
}
