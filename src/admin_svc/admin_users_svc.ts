import type { UserRepository } from '../user/repositories/user_repository_interface.js';
import { MongooseUserRepository } from '../user/repositories/user_repository.js';
import type { NoteRepository } from '../notes_svc/repositories/note_repository_interface.js';
import { MongooseNoteRepository } from '../notes_svc/repositories/mongoose_note_repository.js';
import type { ConversationRepositoryInterface } from '../agent_svc/conversation/conversation_repository_interface.js';
import { MongooseConversationRepository } from '../agent_svc/conversation/mongoose_conversation_repository.js';
import type { OneNoteConnectionRepository } from '../onenote_svc/repositories/onenote_connection_repository_interface.js';
import { MongooseOneNoteConnectionRepository } from '../onenote_svc/repositories/onenote_connection_repository.js';
import type { RefreshTokenRepository } from '../auth_svc/repositories/refresh_token_repository_interface.js';
import { MongooseRefreshTokenRepository } from '../auth_svc/repositories/refresh_token_repository.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { logger } from '../common/logger.js';
import { Time } from '../lib/time.js';
import type { AdminUsersSvcInterface } from './admin_users_svc_interface.js';
import { AdminUserRowBuilder } from './admin_user_row_builder.js';
import type { AdminUserLookups, AdminUserPage, ListAdminUsersParams } from './types/admin_user.types.js';

type AdminUsersSvcDeps = {
  user_repo: Pick<UserRepository, 'listUsers' | 'countUsers'>;
  note_repo: Pick<NoteRepository, 'countNotesByUser'>;
  conversation_repo: Pick<ConversationRepositoryInterface, 'countConversationsByUser'>;
  onenote_repo: Pick<OneNoteConnectionRepository, 'listSummariesByUserIds'>;
  session_repo: Pick<RefreshTokenRepository, 'latestActivityByUser'>;
};

/**
 * A read model over five databases, so it cannot join: it reads one page of users, then
 * one batched lookup per database for that page. Reads repositories rather than the
 * domain services because OneNoteConnectionSvc cannot be built without Microsoft config,
 * and listing users must not depend on it.
 */
export class AdminUsersSvc implements AdminUsersSvcInterface {
  private constructor(private readonly deps: AdminUsersSvcDeps) {}

  static async create(overrides?: Partial<AdminUsersSvcDeps>): Promise<AdminUsersSvc> {
    return new AdminUsersSvc({
      user_repo: overrides?.user_repo ?? (await MongooseUserRepository.create({ db: DbNameResolver.resolve('user') })),
      note_repo: overrides?.note_repo ?? (await MongooseNoteRepository.create({ db: DbNameResolver.resolve('notes') })),
      conversation_repo: overrides?.conversation_repo ?? (await MongooseConversationRepository.create()),
      onenote_repo:
        overrides?.onenote_repo ??
        (await MongooseOneNoteConnectionRepository.create({ db: DbNameResolver.resolve('onenote') })),
      session_repo:
        overrides?.session_repo ?? (await MongooseRefreshTokenRepository.create({ db: DbNameResolver.resolve('auth') }))
    });
  }

  async listUsers(params: ListAdminUsersParams): Promise<AdminUserPage> {
    const start_ms = performance.now();
    const [users, total] = await Promise.all([
      this.deps.user_repo.listUsers(params),
      this.deps.user_repo.countUsers()
    ]);
    const lookups = await this.readLookups(users.map((u) => u.user_id));
    const rows = users.map((user) => AdminUserRowBuilder.build(user, lookups));

    logger.info({ user_count: rows.length, total, duration_ms: Time.elapsedMs(start_ms) }, 'admin users listed');
    return { users: rows, total, limit: params.limit, offset: params.offset };
  }

  private async readLookups(user_ids: string[]): Promise<AdminUserLookups> {
    const [notes, conversations, onenote, sessions] = await Promise.all([
      this.deps.note_repo.countNotesByUser({ user_ids }),
      this.deps.conversation_repo.countConversationsByUser(user_ids),
      this.deps.onenote_repo.listSummariesByUserIds(user_ids),
      this.deps.session_repo.latestActivityByUser(user_ids)
    ]);
    return {
      notes: AdminUsersSvc.byUserId(notes),
      conversations: AdminUsersSvc.byUserId(conversations),
      onenote: AdminUsersSvc.byUserId(onenote),
      sessions: AdminUsersSvc.byUserId(sessions)
    };
  }

  private static byUserId<T extends { user_id: string }>(rows: T[]): Map<string, T> {
    return new Map(rows.map((row) => [row.user_id, row]));
  }
}
