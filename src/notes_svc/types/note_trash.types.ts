import type { Note } from './note.types.js';

export type TrashedNote = Note & {
  deleted_at: Date;
};
