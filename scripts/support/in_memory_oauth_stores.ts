/* In-memory stand-ins for the OAuth repositories, shared by the OAuth tests. */
import { OAuthStoresLoader, type OAuthStores } from '../../src/oauth_svc/oauth_stores.js';
import type { OAuthAuthorizationRequestRepository } from '../../src/oauth_svc/repositories/oauth_authorization_request_repository_interface.js';
import type { OAuthAuthorizationCodeRepository, OAuthCodeLookup } from '../../src/oauth_svc/repositories/oauth_authorization_code_repository_interface.js';
import type { OAuthGrantRepository } from '../../src/oauth_svc/repositories/oauth_grant_repository_interface.js';
import type { OAuthTokenRepository } from '../../src/oauth_svc/repositories/oauth_token_repository_interface.js';
import type {
  CreateOAuthAuthorizationCodeInput,
  CreateOAuthAuthorizationRequestInput,
  CreateOAuthTokenInput,
  OAuthAuthorizationCode,
  OAuthAuthorizationRequest,
  OAuthGrant,
  OAuthTokenRecord,
  UpsertOAuthGrantInput
} from '../../src/oauth_svc/types/oauth.types.js';

export class InMemoryRequests implements OAuthAuthorizationRequestRepository {
  rows: OAuthAuthorizationRequest[] = [];
  async createAuthorizationRequest(input: CreateOAuthAuthorizationRequestInput) {
    this.rows.push({ ...input, created_at: new Date() });
  }
  async findActiveAuthorizationRequest(input: { request_id: string; now: Date }) {
    return this.rows.find((r) => r.request_id === input.request_id && r.expires_at > input.now) ?? null;
  }
  async consumeAuthorizationRequest(input: { request_id: string; now: Date }) {
    const found = this.rows.find((r) => r.request_id === input.request_id && r.expires_at > input.now);
    if (found) this.rows = this.rows.filter((r) => r !== found);
    return found ?? null;
  }
}

export class InMemoryCodes implements OAuthAuthorizationCodeRepository {
  rows: OAuthAuthorizationCode[] = [];
  async createAuthorizationCode(input: CreateOAuthAuthorizationCodeInput) {
    this.rows.push({ ...input, created_at: new Date() });
  }
  async consumeAuthorizationCode(input: OAuthCodeLookup & { family_id: string }) {
    const found = this.rows.find(
      (r) => r.code_hash === input.code_hash && r.client_id === input.client_id && !r.consumed_at && r.expires_at > input.now
    );
    if (!found) return null;
    found.consumed_at = input.now;
    found.family_id = input.family_id;
    return found;
  }
  async findAuthorizationCodeByHash(code_hash: string) {
    return this.rows.find((r) => r.code_hash === code_hash) ?? null;
  }
}

export class InMemoryGrants implements OAuthGrantRepository {
  rows: OAuthGrant[] = [];
  async upsertGrant(input: UpsertOAuthGrantInput & { grant_id: string }) {
    const existing = this.rows.find(
      (g) => g.user_id === input.user_id && g.client_id === input.client_id && g.resource === input.resource
    );
    if (existing) {
      Object.assign(existing, { ...input, grant_id: existing.grant_id, updated_at: new Date() });
      return existing;
    }
    const grant: OAuthGrant = { ...input, created_at: new Date(), updated_at: new Date() };
    this.rows.push(grant);
    return grant;
  }
  async findGrantById(grant_id: string) {
    return this.rows.find((g) => g.grant_id === grant_id) ?? null;
  }
  async listExternalGrantsForUser(user_id: string) {
    return this.rows.filter((g) => g.user_id === user_id && g.kind === 'external');
  }
  async deleteExternalGrantForUser(input: { user_id: string; grant_id: string }) {
    const before = this.rows.length;
    this.rows = this.rows.filter((g) => !(g.user_id === input.user_id && g.grant_id === input.grant_id && g.kind === 'external'));
    return this.rows.length < before;
  }
  async updateGrantLastUsedAt(input: { grant_id: string; at: Date }) {
    const grant = this.rows.find((g) => g.grant_id === input.grant_id);
    if (grant) grant.last_used_at = input.at;
  }
}

export class InMemoryTokens implements OAuthTokenRepository {
  rows: OAuthTokenRecord[] = [];
  async insertTokenRecords(tokens: CreateOAuthTokenInput[]) {
    this.rows.push(...tokens.map((t) => ({ ...t, created_at: new Date() })));
  }
  async findActiveAccessToken(input: { token_hash: string; now: Date }) {
    return this.rows.find((t) => t.token_hash === input.token_hash && t.type === 'access' && !t.revoked_at && t.expires_at > input.now) ?? null;
  }
  async findRefreshToken(input: { token_hash: string; client_id: string }) {
    return this.rows.find((t) => t.token_hash === input.token_hash && t.client_id === input.client_id && t.type === 'refresh') ?? null;
  }
  async consumeRefreshTokenForRotation(input: { token_hash: string; client_id: string; now: Date }) {
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
  async revokeTokenFamily(input: { family_id: string; now: Date }) {
    for (const t of this.rows) if (t.family_id === input.family_id && !t.revoked_at) t.revoked_at = input.now;
  }
  async findTokenByHash(input: { token_hash: string; client_id: string }) {
    return this.rows.find((t) => t.token_hash === input.token_hash && t.client_id === input.client_id) ?? null;
  }
  async deleteTokensForGrant(grant_id: string) {
    this.rows = this.rows.filter((t) => t.grant_id !== grant_id);
  }
}

export type InMemoryOAuthRepositories = { requests: InMemoryRequests; codes: InMemoryCodes; grants: InMemoryGrants; tokens: InMemoryTokens };

export class InMemoryOAuthStores {
  private constructor() {}

  /** The stores as production wires them, plus the rows underneath for assertions. */
  static create(): { stores: OAuthStores; repos: InMemoryOAuthRepositories } {
    const repos = { requests: new InMemoryRequests(), codes: new InMemoryCodes(), grants: new InMemoryGrants(), tokens: new InMemoryTokens() };
    return { stores: OAuthStoresLoader.fromRepositories(repos), repos };
  }
}
