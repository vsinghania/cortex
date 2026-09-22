import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminUserRowBuilder } from '../src/admin_svc/admin_user_row_builder.js';
import { AdminUsersSvc } from '../src/admin_svc/admin_users_svc.js';
import type { AdminUserLookups } from '../src/admin_svc/types/admin_user.types.js';
import type { AdminUserRecord } from '../src/user/types/user.types.js';
import { NoteSource } from '../src/notes_svc/types/note.types.js';
import { OneNoteConnectionStatus } from '../src/onenote_svc/types/onenote_connection.types.js';

const CREATED_AT = new Date('2026-01-01T00:00:00Z');
const EARLIER = new Date('2026-09-01T00:00:00Z');
const LATER = new Date('2026-09-20T00:00:00Z');

function userRecord(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    user_id: 'u1',
    email: 'ada@example.com',
    name: 'Ada',
    roles: ['user'],
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    has_password: true,
    has_google: false,
    ...overrides
  };
}

function emptyLookups(): AdminUserLookups {
  return { notes: new Map(), conversations: new Map(), onenote: new Map(), sessions: new Map() };
}

test('a user with nothing gets zero counts and no integrations', () => {
  const row = AdminUserRowBuilder.build(userRecord(), emptyLookups());
  assert.deepEqual(row.notes, { total: 0, archived: 0, by_source: {} });
  assert.equal(row.conversation_count, 0);
  assert.deepEqual(row.integrations, {});
  assert.equal(row.last_active_at, undefined);
  assert.equal(row.email_verified, false);
  assert.equal(row.is_admin, false);
});

test('a legacy user stored without a name still gets a string name', () => {
  const legacy = { ...userRecord(), name: undefined } as unknown as AdminUserRecord;
  assert.equal(AdminUserRowBuilder.build(legacy, emptyLookups()).name, '');
});

test('sign-in methods and role come from the record', () => {
  const row = AdminUserRowBuilder.build(
    userRecord({ has_google: true, has_password: false, roles: ['user', 'admin'], email_verified_at: EARLIER }),
    emptyLookups()
  );
  assert.deepEqual(row.sign_in, { google: true, password: false });
  assert.equal(row.is_admin, true);
  assert.equal(row.email_verified, true);
});

test('last active is the later of sign-in and session activity', () => {
  const lookups = emptyLookups();
  lookups.sessions.set('u1', { user_id: 'u1', last_active_at: LATER });
  assert.equal(AdminUserRowBuilder.build(userRecord({ last_login_at: EARLIER }), lookups).last_active_at, LATER);

  lookups.sessions.set('u1', { user_id: 'u1', last_active_at: EARLIER });
  assert.equal(AdminUserRowBuilder.build(userRecord({ last_login_at: LATER }), lookups).last_active_at, LATER);
});

test('last active falls back to whichever one exists', () => {
  assert.equal(AdminUserRowBuilder.build(userRecord({ last_login_at: EARLIER }), emptyLookups()).last_active_at, EARLIER);

  const lookups = emptyLookups();
  lookups.sessions.set('u1', { user_id: 'u1', last_active_at: LATER });
  assert.equal(AdminUserRowBuilder.build(userRecord(), lookups).last_active_at, LATER);
});

test('the OneNote integration carries only its status and last sync', () => {
  const lookups = emptyLookups();
  lookups.onenote.set('u1', { user_id: 'u1', status: OneNoteConnectionStatus.NeedsReauth, last_synced_at: EARLIER });
  const row = AdminUserRowBuilder.build(userRecord(), lookups);
  assert.deepEqual(row.integrations, {
    onenote: { status: OneNoteConnectionStatus.NeedsReauth, last_synced_at: EARLIER }
  });
});

test('listUsers joins each lookup onto its own user and passes paging through', async () => {
  const svc = await AdminUsersSvc.create({
    user_repo: {
      listUsers: async () => [userRecord({ user_id: 'u1' }), userRecord({ user_id: 'u2', email: 'bo@example.com' })],
      countUsers: async () => 7
    },
    note_repo: {
      countNotesByUser: async () => [
        { user_id: 'u2', total: 5, archived: 1, by_source: { [NoteSource.Native]: 2, [NoteSource.OneNote]: 3 } }
      ]
    },
    conversation_repo: { countConversationsByUser: async () => [{ user_id: 'u1', count: 4 }] },
    onenote_repo: { listSummariesByUserIds: async () => [] },
    session_repo: { latestActivityByUser: async () => [] }
  });

  const page = await svc.listUsers({ limit: 2, offset: 4 });
  assert.equal(page.total, 7);
  assert.equal(page.limit, 2);
  assert.equal(page.offset, 4);

  const [first, second] = page.users;
  assert.equal(first.conversation_count, 4);
  assert.equal(first.notes.total, 0);
  assert.equal(second.conversation_count, 0);
  assert.deepEqual(second.notes, { total: 5, archived: 1, by_source: { native: 2, onenote: 3 } });
});
