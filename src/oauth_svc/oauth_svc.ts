import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { McpResourceCatalog } from '../mcp/resource/mcp_resource_catalog.js';
import type { McpResource } from '../mcp/resource/mcp_resource.types.js';
import { OAuthConfigLoader, type OAuthConfig } from './config/oauth_config.js';
import { OAuthAuthorizationServer } from './oauth_authorization_server.js';
import { OAuthRedirects } from './oauth_redirects.js';
import { OAuthStoresLoader, type OAuthStores } from './oauth_stores.js';
import type { FirstPartyTokenRequest, OAuthSvcInterface } from './oauth_svc_interface.js';
import type {
  ApproveOAuthRequestInput,
  OAuthAccessOption,
  OAuthAuthorizationRequest,
  OAuthConsentRequestView,
  OAuthGrant,
  PublicMcpResource,
  PublicOAuthGrant
} from './types/oauth.types.js';

type OAuthSvcDeps = {
  stores: OAuthStores;
  config: OAuthConfig;
  resources: McpResourceCatalog;
  now?: () => Date;
};

export class OAuthSvc implements OAuthSvcInterface {
  private constructor(private readonly deps: OAuthSvcDeps) {}

  static isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return OAuthConfigLoader.fromEnv(env) !== null;
  }

  static async create(overrides?: Partial<OAuthSvcDeps>): Promise<OAuthSvc> {
    const config = overrides?.config ?? OAuthSvc.requireOAuthConfig();
    return new OAuthSvc({
      stores: overrides?.stores ?? (await OAuthStoresLoader.getStores()),
      config,
      resources: overrides?.resources ?? McpResourceCatalog.fromEnv(),
      now: overrides?.now
    });
  }

  private static requireOAuthConfig(): OAuthConfig {
    const config = OAuthConfigLoader.fromEnv();
    if (!config) throw new ServiceUnavailableError('Connecting external assistants is not configured');
    return config;
  }

  async describeAuthorizationRequest(request_id: string): Promise<OAuthConsentRequestView> {
    const request = await this.deps.stores.requests.findActiveAuthorizationRequest({ request_id, now: this.getCurrentTime() });
    if (!request) throw OAuthSvc.createAuthorizationRequestGoneError();
    const resource = this.requireMcpResource(request.resource);
    const access_options = OAuthSvc.buildConsentAccessOptions(resource, request.requested_scopes);

    return {
      request_id,
      client_name: request.client_name,
      client_host: request.client_host,
      redirect_host: OAuthSvc.getUriHost(request.redirect_uri),
      resource: { id: resource.id, name: resource.display_name },
      requested_scopes: request.requested_scopes,
      access_options,
      default_access: access_options.find((option) => option.value === 'read_write')?.available ? 'read_write' : 'read'
    };
  }

  /** Records the user's consent as the grant, then hands the client a one-minute code tied to it. */
  async approveAuthorizationRequest(input: ApproveOAuthRequestInput): Promise<{ redirect_url: string }> {
    const now = this.getCurrentTime();
    const request = await this.consumeAuthorizationRequest(input.request_id, now);
    const resource = this.requireMcpResource(request.resource);
    const scopes = McpResourceCatalog.resolveScopesForResourceAccess(resource, input.access, request.requested_scopes);
    if (scopes.length === 0) throw new BadRequestError('The app did not ask for that level of access');

    const grant = await this.deps.stores.grants.upsertGrant({
      user_id: input.user_id,
      client_id: request.client_id,
      client_name: request.client_name,
      client_host: request.client_host,
      kind: 'external',
      scopes,
      resource: request.resource
    });

    const code = await this.deps.stores.codes.issueAuthorizationCode({
      client_id: request.client_id,
      user_id: input.user_id,
      grant_id: grant.grant_id,
      redirect_uri: request.redirect_uri,
      code_challenge: request.code_challenge,
      scopes,
      resource: request.resource,
      now
    });

    logger.info({ client_id: request.client_id, grant_id: grant.grant_id, scopes }, 'oauth consent approved');
    return { redirect_url: this.buildAuthorizationResponseRedirect(request, { code }) };
  }

  async denyAuthorizationRequest(input: { request_id: string; user_id: string }): Promise<{ redirect_url: string }> {
    const request = await this.consumeAuthorizationRequest(input.request_id, this.getCurrentTime());
    logger.info({ client_id: request.client_id }, 'oauth consent denied');
    return { redirect_url: this.buildAuthorizationResponseRedirect(request, { error: 'access_denied', error_description: 'The user declined access' }) };
  }

  /** The MCP servers a user can connect an assistant to, with the URL to paste. */
  listMcpResources(): PublicMcpResource[] {
    return this.deps.resources.listResources().map((resource) => ({ id: resource.id, name: resource.display_name, url: resource.url }));
  }

  async listConnectedAppGrants(user_id: string): Promise<PublicOAuthGrant[]> {
    const grants = await this.deps.stores.grants.listExternalGrantsForUser(user_id);
    return grants.map((grant) => this.toPublicOAuthGrant(grant));
  }

  /** Ends the connection everywhere at once: the grant and every token on every device. */
  async revokeConnectedAppGrant(input: { user_id: string; grant_id: string }): Promise<void> {
    const revoked = await this.deps.stores.grants.deleteExternalGrantForUser(input);
    if (!revoked) throw new NotFoundError('Connection not found');
    await this.deps.stores.tokens.deleteTokensForGrant(input.grant_id);
    logger.info({ grant_id: input.grant_id }, 'oauth grant revoked');
  }

  async issueFirstPartyAccessToken(input: FirstPartyTokenRequest): Promise<{ access_token: string; expires_at: Date }> {
    const now = this.getCurrentTime();
    const resource = this.deps.resources.findResourceById(input.resource_id);
    if (!resource) throw new ServiceUnavailableError(`The ${input.resource_id} MCP endpoint is not served`);
    const grant = await this.deps.stores.grants.upsertGrant({
      user_id: input.user_id,
      client_id: input.client_id,
      client_name: input.client_name,
      kind: 'first_party',
      scopes: McpResourceCatalog.listResourceScopes(resource),
      resource: resource.url
    });
    const issued = await this.deps.stores.tokens.issueTokensInNewFamily({
      grant,
      scopes: grant.scopes,
      now,
      with_refresh: false,
      access_ttl_sec: input.ttl_sec
    });
    logger.debug({ client_id: input.client_id, ttl_sec: input.ttl_sec }, 'oauth first-party token issued');
    return { access_token: issued.access.value, expires_at: issued.access.expires_at };
  }

  /** Single use: approving or denying removes it, so a consent link cannot be replayed. */
  private async consumeAuthorizationRequest(request_id: string, now: Date): Promise<OAuthAuthorizationRequest> {
    const request = await this.deps.stores.requests.consumeAuthorizationRequest({ request_id, now });
    if (!request) throw OAuthSvc.createAuthorizationRequestGoneError();
    return request;
  }

  private buildAuthorizationResponseRedirect(request: OAuthAuthorizationRequest, params: Record<string, string>): string {
    return OAuthRedirects.buildAuthorizationResponseRedirect({
      redirect_uri: request.redirect_uri,
      issuer: OAuthAuthorizationServer.getIssuerUrl(this.deps.config),
      state: request.state,
      params
    });
  }

  private toPublicOAuthGrant(grant: OAuthGrant): PublicOAuthGrant {
    const resource = this.deps.resources.findResourceByUrl(grant.resource);
    return {
      grant_id: grant.grant_id,
      client_name: grant.client_name,
      client_host: grant.client_host ?? null,
      resource_id: resource?.id ?? null,
      resource_name: resource?.display_name ?? null,
      scopes: grant.scopes,
      created_at: grant.created_at,
      last_used_at: grant.last_used_at ?? null
    };
  }

  /** A request or grant whose resource is no longer served cannot be consented to. */
  private requireMcpResource(url: string): McpResource {
    const resource = this.deps.resources.findResourceByUrl(url);
    if (!resource) throw new NotFoundError('This MCP endpoint is no longer available');
    return resource;
  }

  private static buildConsentAccessOptions(resource: McpResource, requested_scopes: string[]): OAuthAccessOption[] {
    return (['read', 'read_write'] as const).map((value) => ({
      value,
      label: value === 'read' ? 'Read only' : 'Read & write',
      detail: resource.access_copy[value],
      available: McpResourceCatalog.resolveScopesForResourceAccess(resource, value, requested_scopes).length === (value === 'read' ? 1 : 2)
    }));
  }

  private static getUriHost(uri: string): string {
    try {
      const url = new URL(uri);
      return url.host || url.protocol;
    } catch {
      return 'invalid';
    }
  }

  private static createAuthorizationRequestGoneError(): NotFoundError {
    return new NotFoundError('This authorization request has expired or was already used');
  }

  private getCurrentTime(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
