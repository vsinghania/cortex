import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { McpResourceCatalog } from '../mcp/resource/mcp_resource_catalog.js';
import type { McpResource } from '../mcp/resource/mcp_resource.types.js';
import { OAuthConfigLoader, type OAuthConfig } from './config/oauth_config.js';
import { OAuthAuthorizationServer } from './oauth_authorization_server.js';
import { OAuthRedirects } from './oauth_redirects.js';
import { OAuthStoresLoader, type OAuthStores } from './oauth_stores.js';
import type { OAuthSvcInterface } from './oauth_svc_interface.js';
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
    const config = overrides?.config ?? OAuthSvc.requireConfig();
    return new OAuthSvc({
      stores: overrides?.stores ?? (await OAuthStoresLoader.get()),
      config,
      resources: overrides?.resources ?? McpResourceCatalog.fromEnv(),
      now: overrides?.now
    });
  }

  private static requireConfig(): OAuthConfig {
    const config = OAuthConfigLoader.fromEnv();
    if (!config) throw new ServiceUnavailableError('Connecting external assistants is not configured');
    return config;
  }

  async describeRequest(request_id: string): Promise<OAuthConsentRequestView> {
    const request = await this.deps.stores.requests.findActive({ request_id, now: this.now() });
    if (!request) throw OAuthSvc.requestGone();
    const resource = this.requireResource(request.resource);
    const access_options = OAuthSvc.accessOptions(resource, request.requested_scopes);

    return {
      request_id,
      client_name: request.client_name,
      client_host: request.client_host,
      redirect_host: OAuthSvc.hostOf(request.redirect_uri),
      resource: { id: resource.id, name: resource.display_name },
      requested_scopes: request.requested_scopes,
      access_options,
      default_access: access_options.find((option) => option.value === 'read_write')?.available ? 'read_write' : 'read'
    };
  }

  /** Records the user's consent as the grant, then hands the client a one-minute code tied to it. */
  async approve(input: ApproveOAuthRequestInput): Promise<{ redirect_url: string }> {
    const now = this.now();
    const request = await this.consumeRequest(input.request_id, now);
    const resource = this.requireResource(request.resource);
    const scopes = McpResourceCatalog.scopesFor(resource, input.access, request.requested_scopes);
    if (scopes.length === 0) throw new BadRequestError('The app did not ask for that level of access');

    const grant = await this.deps.stores.grants.upsert({
      user_id: input.user_id,
      client_id: request.client_id,
      client_name: request.client_name,
      client_host: request.client_host,
      kind: 'external',
      scopes,
      resource: request.resource
    });

    const code = await this.deps.stores.codes.issue({
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
    return { redirect_url: this.respond(request, { code }) };
  }

  async deny(input: { request_id: string; user_id: string }): Promise<{ redirect_url: string }> {
    const request = await this.consumeRequest(input.request_id, this.now());
    logger.info({ client_id: request.client_id }, 'oauth consent denied');
    return { redirect_url: this.respond(request, { error: 'access_denied', error_description: 'The user declined access' }) };
  }

  /** The MCP servers a user can connect an assistant to, with the URL to paste. */
  listResources(): PublicMcpResource[] {
    return this.deps.resources.all().map((resource) => ({ id: resource.id, name: resource.display_name, url: resource.url }));
  }

  async listGrants(user_id: string): Promise<PublicOAuthGrant[]> {
    const grants = await this.deps.stores.grants.listExternal(user_id);
    return grants.map((grant) => this.toPublic(grant));
  }

  /** Ends the connection everywhere at once: the grant and every token on every device. */
  async revokeGrant(input: { user_id: string; grant_id: string }): Promise<void> {
    const revoked = await this.deps.stores.grants.deleteExternal(input);
    if (!revoked) throw new NotFoundError('Connection not found');
    await this.deps.stores.tokens.deleteForGrant(input.grant_id);
    logger.info({ grant_id: input.grant_id }, 'oauth grant revoked');
  }

  /** Single use: approving or denying removes it, so a consent link cannot be replayed. */
  private async consumeRequest(request_id: string, now: Date): Promise<OAuthAuthorizationRequest> {
    const request = await this.deps.stores.requests.consume({ request_id, now });
    if (!request) throw OAuthSvc.requestGone();
    return request;
  }

  private respond(request: OAuthAuthorizationRequest, params: Record<string, string>): string {
    return OAuthRedirects.authorizationResponse({
      redirect_uri: request.redirect_uri,
      issuer: OAuthAuthorizationServer.issuerOf(this.deps.config),
      state: request.state,
      params
    });
  }

  private toPublic(grant: OAuthGrant): PublicOAuthGrant {
    const resource = this.deps.resources.findByUrl(grant.resource);
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
  private requireResource(url: string): McpResource {
    const resource = this.deps.resources.findByUrl(url);
    if (!resource) throw new NotFoundError('This MCP endpoint is no longer available');
    return resource;
  }

  private static accessOptions(resource: McpResource, requested_scopes: string[]): OAuthAccessOption[] {
    return (['read', 'read_write'] as const).map((value) => ({
      value,
      label: value === 'read' ? 'Read only' : 'Read & write',
      detail: resource.access_copy[value],
      available: McpResourceCatalog.scopesFor(resource, value, requested_scopes).length === (value === 'read' ? 1 : 2)
    }));
  }

  private static hostOf(uri: string): string {
    try {
      const url = new URL(uri);
      return url.host || url.protocol;
    } catch {
      return 'invalid';
    }
  }

  private static requestGone(): NotFoundError {
    return new NotFoundError('This authorization request has expired or was already used');
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
