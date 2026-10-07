/* In-memory stand-ins for the OAuth repositories, shared by the OAuth tests. */
import type { OAuthStores } from '../../src/oauth_svc/oauth_stores.js';
import type { OAuthGrantRepository } from '../../src/oauth_svc/repositories/oauth_grant_repository_interface.js';
import type { OAuthTokenRepository } from '../../src/oauth_svc/repositories/oauth_token_repository_interface.js';
import type {
  CreateOAuthTokenInput,
  OAuthGrant,
  OAuthTokenRecord,
  UpsertOAuthGrantInput
} from '../../src/oauth_svc/types/oauth.types.js';

export class InMemoryGrants implements OAuthGrantRepository {
  rows: OAuthGrant[] = [];
  async upsert(input: UpsertOAuthGrantInput & { grant_id: string }) {
    const existing = this.rows.find((g) => g.user_id === input.user_id && g.client_id === input.client_id);
    if (existing) {
      Object.assign(existing, { ...input, grant_id: existing.grant_id, updated_at: new Date() });
      return existing;
    }
    const grant: OAuthGrant = { ...input, created_at: new Date(), updated_at: new Date() };
    this.rows.push(grant);
    return grant;
  }
  async findById(grant_id: string) {
    return this.rows.find((g) => g.grant_id === grant_id) ?? null;
  }
  async listExternalByUser(user_id: string) {
    return this.rows.filter((g) => g.user_id === user_id && g.kind === 'external');
  }
  async deleteExternalForUser(input: { user_id: string; grant_id: string }) {
    const before = this.rows.length;
    this.rows = this.rows.filter((g) => !(g.user_id === input.user_id && g.grant_id === input.grant_id && g.kind === 'external'));
    return this.rows.length < before;
  }
  async touchLastUsed(input: { grant_id: string; at: Date }) {
    const grant = this.rows.find((g) => g.grant_id === input.grant_id);
    if (grant) grant.last_used_at = input.at;
  }
}

export class InMemoryTokens implements OAuthTokenRepository {
  rows: OAuthTokenRecord[] = [];
  async insertMany(tokens: CreateOAuthTokenInput[]) {
    this.rows.push(...tokens.map((t) => ({ ...t, created_at: new Date() })));
  }
  async findActiveAccess(input: { token_hash: string; now: Date }) {
    return this.rows.find((t) => t.token_hash === input.token_hash && t.type === 'access' && !t.revoked_at && t.expires_at > input.now) ?? null;
  }
  async findRefresh(input: { token_hash: string; client_id: string }) {
    return this.rows.find((t) => t.token_hash === input.token_hash && t.client_id === input.client_id && t.type === 'refresh') ?? null;
  }
  async claimForRotation(input: { token_hash: string; client_id: string; now: Date }) {
    const token = this.rows.find(
      (t) =>
        t.token_hash === input.token_hash &&
        t.client_id === input.client_id &&
        t.type === 'refresh' &&
        !t.rotated_at &&
        !t.revoked_at &&
        t.expires_at > input.now
    );
    if (!token) return null;
    token.rotated_at = input.now;
    return token;
  }
  async revokeFamily(input: { family_id: string; now: Date }) {
    for (const t of this.rows) if (t.family_id === input.family_id && !t.revoked_at) t.revoked_at = input.now;
  }
  async revokeByHash(input: { token_hash: string; client_id: string; now: Date }) {
    const token = this.rows.find((t) => t.token_hash === input.token_hash && t.client_id === input.client_id);
    if (!token) return false;
    await this.revokeFamily({ family_id: token.family_id, now: input.now });
    return true;
  }
  async deleteByGrant(grant_id: string) {
    this.rows = this.rows.filter((t) => t.grant_id !== grant_id);
  }
}

export class InMemoryOAuthStores {
  private constructor() {}

  static create(): OAuthStores & { grants: InMemoryGrants; tokens: InMemoryTokens } {
    return { grants: new InMemoryGrants(), tokens: new InMemoryTokens() };
  }
}
