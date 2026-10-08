import { logger } from '../common/logger.js';
import { Id } from '../lib/id.js';
import { Time } from '../lib/time.js';
import type { OAuthGrantRepository } from './repositories/oauth_grant_repository_interface.js';
import type { OAuthGrant, UpsertOAuthGrantInput } from './types/oauth.types.js';

/** Stops every MCP call from also being a write. */
const LAST_USED_WRITE_INTERVAL_MS = Time.minutesToMs(1);

/** The only way to `oauth_grants`: the lasting consent between a user, a client and one resource. */
export class OAuthGrants {
  constructor(private readonly repo: OAuthGrantRepository) {}

  /** One grant per user, client and resource: consenting again replaces the scopes and keeps the grant id. */
  upsert(input: UpsertOAuthGrantInput): Promise<OAuthGrant> {
    return this.repo.upsert({ ...input, grant_id: Id.generateUuidV7() });
  }

  find(grant_id: string): Promise<OAuthGrant | null> {
    return this.repo.findById(grant_id);
  }

  /** The connections Settings lists; first-party grants such as voice's are never shown. */
  listExternal(user_id: string): Promise<OAuthGrant[]> {
    return this.repo.listExternalByUser(user_id);
  }

  /** Only the user's own external grant; false when there is none. Its tokens are the token store's to remove. */
  deleteExternal(input: { user_id: string; grant_id: string }): Promise<boolean> {
    return this.repo.deleteExternalForUser(input);
  }

  /** At most one write a minute per grant, never awaited: a missed timestamp must not fail or slow the call it describes. */
  recordUse(grant: OAuthGrant, now: Date): void {
    const last_used_ms = grant.last_used_at?.getTime() ?? 0;
    if (now.getTime() - last_used_ms < LAST_USED_WRITE_INTERVAL_MS) return;
    void this.touchLastUsed(grant.grant_id, now);
  }

  private async touchLastUsed(grant_id: string, at: Date): Promise<void> {
    try {
      await this.repo.touchLastUsed({ grant_id, at });
    } catch (err) {
      logger.debug({ err, grant_id }, 'oauth last-used update skipped');
    }
  }
}
