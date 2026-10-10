import assert from 'node:assert/strict';
import test from 'node:test';
import { NoteTagCache } from '../web/src/lib/note_tag_cache.js';
import { NoteTagOptions } from '../web/src/lib/note_tag_options.js';
import { AuthStore } from '../web/src/lib/auth_store.js';
import type { User } from '../web/src/lib/auth.types.js';

const WORK = { tags: [{ tag: 'Work', count: 2 }] };
const IDEAS = { tags: [{ tag: 'Ideas', count: 1 }] };

test('tag cache shares concurrent reads and expires after one minute', async (t) => {
  let now_ms = 1_000;
  t.mock.method(Date, 'now', () => now_ms);
  const cache = new NoteTagCache();
  let calls = 0;
  const loader = async () => { calls += 1; return WORK; };
  assert.deepEqual(await Promise.all([cache.listTags('user-1', loader), cache.listTags('user-1', loader)]), [WORK, WORK]);
  now_ms += NoteTagCache.TTL_MS - 1;
  await cache.listTags('user-1', loader);
  assert.equal(calls, 1);
  now_ms += 1;
  await cache.listTags('user-1', loader);
  assert.equal(calls, 2);
});

test('refresh replaces pending data and an older response cannot repopulate the cache', async () => {
  const cache = new NoteTagCache();
  const pending = Promise.withResolvers<typeof WORK>();
  const old_read = cache.listTags('user-1', () => pending.promise);
  assert.deepEqual(await cache.listTags('user-1', async () => IDEAS, true), IDEAS);
  pending.resolve(WORK);
  await old_read;
  assert.deepEqual(await cache.listTags('user-1', async () => { throw new Error('Should use refreshed tags'); }), IDEAS);
});

test('mutation invalidation ignores an earlier in-flight read', async () => {
  const cache = new NoteTagCache();
  const pending = Promise.withResolvers<typeof WORK>();
  const old_read = cache.listTags('user-1', () => pending.promise);
  cache.invalidate();
  const fresh_read = cache.listTags('user-1', async () => IDEAS);
  pending.resolve(WORK);
  await Promise.all([old_read, fresh_read]);
  assert.deepEqual(await cache.listTags('user-1', async () => WORK), IDEAS);
});

test('failed tag requests can be retried and empty results are cached', async () => {
  const cache = new NoteTagCache();
  await assert.rejects(cache.listTags('user-1', async () => { throw new Error('Offline'); }), /Offline/);
  const empty = { tags: [] };
  assert.deepEqual(await cache.listTags('user-1', async () => empty), empty);
  assert.deepEqual(await cache.listTags('user-1', async () => { throw new Error('Should use empty cache'); }), empty);
});

test('tag data is scoped to the current user and unauthenticated reads are not cached', async () => {
  const cache = new NoteTagCache();
  await cache.listTags('user-1', async () => WORK);
  assert.deepEqual(await cache.listTags('user-2', async () => IDEAS), IDEAS);
  assert.deepEqual(await cache.listTags(null, async () => WORK), WORK);
  assert.deepEqual(await cache.listTags(null, async () => IDEAS), IDEAS);
});

test('sign-out and account changes clear cached tags, while token rotation preserves them', async () => {
  const auth = AuthStore.instance();
  const cache = NoteTagCache.instance;
  const user: User = { user_id: 'user-1', email: 'test@example.com', name: 'Test', roles: ['user'], created_at: '', updated_at: '' };
  try {
    auth.setSession('first-token', user);
    await cache.listTags(user.user_id, async () => WORK);
    auth.setToken('rotated-token');
    assert.deepEqual(await cache.listTags(user.user_id, async () => IDEAS), WORK);
    auth.clear();
    auth.setSession('next-token', user);
    assert.deepEqual(await cache.listTags(user.user_id, async () => IDEAS), IDEAS);
    auth.setUser({ ...user, user_id: 'user-2' });
    assert.deepEqual(await cache.listTags('user-2', async () => WORK), WORK);
  } finally {
    auth.clear();
  }
});

test('suggestions filter case-insensitively, exclude attached tags, and preserve existing spelling', () => {
  const tags = ['Work', 'Ideas', 'Homework'];
  assert.deepEqual(NoteTagOptions.filterAvailableTags(tags, ['ideas'], ''), ['Homework', 'Work']);
  assert.deepEqual(NoteTagOptions.filterAvailableTags(tags, [], ' #WORK '), ['Homework', 'Work']);
  assert.equal(NoteTagOptions.resolveTagToAdd(tags, ' #work '), 'Work');
  assert.equal(NoteTagOptions.resolveTagToAdd(tags, ' # new tag '), 'new tag');
  assert.equal(NoteTagOptions.normalizeTag(' # '), '');
  assert.deepEqual(NoteTagOptions.findCommonTags([['Work'], ['work', 'Ideas']]), ['Work']);
});
