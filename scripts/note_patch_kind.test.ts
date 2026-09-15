import assert from 'node:assert/strict';
import test from 'node:test';
import { NotePatchKind } from '../src/notes_svc/note_patch_kind.js';

test('pin, archive and folder changes are organizational', () => {
  assert.equal(NotePatchKind.isOrganizationalOnly({ is_pinned: true }), true);
  assert.equal(NotePatchKind.isOrganizationalOnly({ is_archived: false, folder_id: null }), true);
  assert.equal(NotePatchKind.isOrganizationalOnly({ folder_id: 'f1' }), true);
});

test('any content field makes a patch a real edit', () => {
  assert.equal(NotePatchKind.isOrganizationalOnly({ is_pinned: true, title: 'x' }), false);
  assert.equal(NotePatchKind.isOrganizationalOnly({ tags: ['a'] }), false);
});

test('undefined keys are ignored, and an empty patch is not organizational', () => {
  assert.equal(NotePatchKind.isOrganizationalOnly({ is_pinned: true, body: undefined }), true);
  assert.equal(NotePatchKind.isOrganizationalOnly({}), false);
});

test('touchesBody covers the body only', () => {
  assert.equal(NotePatchKind.touchesBody({ title: 't' }), false);
  assert.equal(NotePatchKind.touchesBody({ body: '' }), true);
  assert.equal(NotePatchKind.touchesBody({ is_archived: true }), false);
});

test('touchesArchive sees both archive and unarchive', () => {
  assert.equal(NotePatchKind.touchesArchive({ is_archived: false }), true);
  assert.equal(NotePatchKind.touchesArchive({ is_pinned: true }), false);
});
