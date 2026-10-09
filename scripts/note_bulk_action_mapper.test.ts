import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteBulkActionMapper } from '../src/notes_svc/note_bulk_action_mapper.js';

test('organizing actions map to organize fields', () => {
  assert.deepEqual(NoteBulkActionMapper.toRepositoryBulkUpdate({ action: 'pin' }), { kind: 'organize', fields: { is_pinned: true } });
  assert.deepEqual(NoteBulkActionMapper.toRepositoryBulkUpdate({ action: 'unarchive' }), { kind: 'organize', fields: { is_archived: false } });
  assert.deepEqual(
    NoteBulkActionMapper.toRepositoryBulkUpdate({ action: 'move', folder_id: null }),
    { kind: 'organize', fields: { folder_id: null } }
  );
});

test('tag actions trim, drop blanks and dedupe', () => {
  assert.deepEqual(
    NoteBulkActionMapper.toRepositoryBulkUpdate({ action: 'add_tags', tags: [' work ', 'work', '', 'ideas'] }),
    { kind: 'add_tags', tags: ['work', 'ideas'] }
  );
});

test('archivedStateAfter only reports archive-changing actions', () => {
  assert.equal(NoteBulkActionMapper.getArchiveStateAfterAction({ action: 'archive' }), true);
  assert.equal(NoteBulkActionMapper.getArchiveStateAfterAction({ action: 'unarchive' }), false);
  assert.equal(NoteBulkActionMapper.getArchiveStateAfterAction({ action: 'pin' }), undefined);
  assert.equal(NoteBulkActionMapper.getArchiveStateAfterAction({ action: 'delete' }), undefined);
});
