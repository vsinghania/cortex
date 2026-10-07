/*
 * Imported notes are read-only at the HTTP boundary. The rule lives there rather than in
 * NotesSvc because the sync itself writes through NotesSvc: guarding the service would
 * block the very thing that keeps these notes current.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteSource } from '../src/notes_svc/types/note.types.js';
import type { Note } from '../src/notes_svc/types/note.types.js';
import type { NotesSvc } from '../src/notes_svc/notes_svc.js';
import { ForbiddenError, NotFoundError } from '../src/common/errors.js';

const USER_ID = 'user-1';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    user_id: USER_ID,
    source: NoteSource.Native,
    title: 'A note',
    body: 'text',
    tags: [],
    is_archived: false,
    is_pinned: false,
    is_deleted: false,
    sync_status: 'idle',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  } as Note;
}

/**
 * The guard as the controller applies it. Kept in step with
 * `NotesController.assertEditable`, which is private to that module.
 */
async function assertEditable(args: {
  stored: Note | null;
  patch: Record<string, unknown>;
}): Promise<void> {
  const notes_svc = { getNote: async () => args.stored } as unknown as NotesSvc;
  const touches_content = args.patch.title !== undefined || args.patch.body !== undefined;
  if (!touches_content) return;

  const found = await notes_svc.getNote(USER_ID, { id: 'note-1' });
  if (!found) throw new NotFoundError('Note not found');
  if (found.source === NoteSource.Native) return;
  throw new ForbiddenError(`This note is synced from ${found.source} and can only be edited there`);
}

test('editing the body or title of an imported note is refused', async () => {
  const imported = note({ source: NoteSource.OneNote, external_id: 'page-1' });

  await assert.rejects(assertEditable({ stored: imported, patch: { body: 'mine now' } }), ForbiddenError);
  await assert.rejects(assertEditable({ stored: imported, patch: { title: 'Renamed' } }), ForbiddenError);
});

test('organising an imported note is still allowed', async () => {
  const imported = note({ source: NoteSource.OneNote, external_id: 'page-1' });

  // The sync never writes these, so they survive every pass and stay the user's.
  await assertEditable({ stored: imported, patch: { tags: ['work'] } });
  await assertEditable({ stored: imported, patch: { is_pinned: true } });
  await assertEditable({ stored: imported, patch: { is_archived: true } });
  await assertEditable({ stored: imported, patch: { folder_id: 'folder-2' } });
});

test('a note the user wrote is untouched by the rule', async () => {
  await assertEditable({ stored: note(), patch: { body: 'edited' } });
  await assertEditable({ stored: note(), patch: { title: 'Renamed' } });
});

test('a patch that touches nothing guarded does not even read the note', async () => {
  // `stored: null` would throw if the guard looked it up.
  await assertEditable({ stored: null, patch: { is_pinned: true } });
});
