import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteListSort } from '../src/notes_svc/note_list_sort.js';

test('defaults to newest-updated first, pinned leading', () => {
  const resolved = NoteListSort.resolve({ has_query: false });
  assert.deepEqual(resolved.sort, { is_pinned: -1, updated_at: -1, id: -1 });
  assert.equal(resolved.by_relevance, false);
  assert.equal(resolved.needs_case_insensitive_collation, false);
});

test('pinned notes lead an explicit ascending sort too', () => {
  const resolved = NoteListSort.resolve({ sort: { field: 'created_at', order: 'asc' }, has_query: false });
  assert.deepEqual(Object.keys(resolved.sort), ['is_pinned', 'created_at', 'id']);
  assert.equal(resolved.sort.is_pinned, -1);
  assert.equal(resolved.sort.created_at, 1);
});

test('a title sort asks for the case-insensitive collation', () => {
  const resolved = NoteListSort.resolve({ sort: { field: 'title', order: 'asc' }, has_query: false });
  assert.equal(resolved.needs_case_insensitive_collation, true);
});

test('a text query without an explicit sort ranks by relevance first', () => {
  const resolved = NoteListSort.resolve({ has_query: true });
  assert.equal(resolved.by_relevance, true);
  assert.deepEqual(Object.keys(resolved.sort)[0], 'score');
});

test('an explicit sort overrides relevance for a text query', () => {
  const resolved = NoteListSort.resolve({ sort: { field: 'title', order: 'desc' }, has_query: true });
  assert.equal(resolved.by_relevance, false);
  assert.equal(resolved.sort.title, -1);
});

test('fromParts returns nothing when neither part is given', () => {
  assert.equal(NoteListSort.fromParts({}), undefined);
});

test('fromParts picks the natural order for a bare field', () => {
  assert.deepEqual(NoteListSort.fromParts({ field: 'title' }), { field: 'title', order: 'asc' });
  assert.deepEqual(NoteListSort.fromParts({ field: 'created_at' }), { field: 'created_at', order: 'desc' });
});

test('fromParts applies a bare order to updated_at', () => {
  assert.deepEqual(NoteListSort.fromParts({ order: 'asc' }), { field: 'updated_at', order: 'asc' });
});
