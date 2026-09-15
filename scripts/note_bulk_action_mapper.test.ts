import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteBulkActionMapper } from '../src/notes_svc/note_bulk_action_mapper.js';

test('organizing actions map to organize fields', () => {
  assert.deepEqual(NoteBulkActionMapper.toRepoUpdate({ action: 'pin' }), { kind: 'organize', fields: { is_pinned: true } });
  assert.deepEqual(NoteBulkActionMapper.toRepoUpdate({ action: 'unarchive' }), { kind: 'organize', fields: { is_archived: false } });
  assert.deepEqual(
    NoteBulkActionMapper.toRepoUpdate({ action: 'move', folder_id: null }),
    { kind: 'organize', fields: { folder_id: null } }
  );
});

test('tag actions trim, drop blanks and dedupe', () => {
  assert.deepEqual(
    NoteBulkActionMapper.toRepoUpdate({ action: 'add_tags', tags: [' work ', 'work', '', 'ideas'] }),
    { kind: 'add_tags', tags: ['work', 'ideas'] }
  );
});

test('archivedStateAfter only reports archive-changing actions', () => {
  assert.equal(NoteBulkActionMapper.archivedStateAfter({ action: 'archive' }), true);
  assert.equal(NoteBulkActionMapper.archivedStateAfter({ action: 'unarchive' }), false);
  assert.equal(NoteBulkActionMapper.archivedStateAfter({ action: 'pin' }), undefined);
  assert.equal(NoteBulkActionMapper.archivedStateAfter({ action: 'delete' }), undefined);
});
