import { logger } from '../common/logger.js';
import { CanonicalUrl } from '../lib/canonical_url.js';
import { McpResourceCatalog } from '../mcp/resource/mcp_resource_catalog.js';
import type { McpResource } from '../mcp/resource/mcp_resource.types.js';
import { ClientIdMetadataResolver } from './clients/client_id_metadata_resolver.js';
import type { OAuthConfig } from './config/oauth_config.js';
import { OAuthProtocolError } from './oauth_errors.js';
import { OAuthPkce } from './oauth_pkce.js';
import { OAuthRedirects } from './oauth_redirects.js';
import { OAuthStoresLoader, type OAuthStores } from './oauth_stores.js';
import { OAuthTokenFamilies } from './oauth_token_families.js';
import type { OAuthClient, OAuthTokenRecord, OAuthTokenResponse } from './types/oauth.types.js';

const CONSENT_PATH = '/connect';

/** Request parameters as they arrive (query string or form body): all optional strings. */
export type OAuthParams = Record<string, string | undefined>;

export type AuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  revocation_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  client_id_metadata_document_supported: boolean;
  authorization_response_iss_parameter_supported: boolean;
};

type OAuthAuthorizationServerDeps = {
  stores: () => Promise<OAuthStores>;
  clients: ClientIdMetadataResolver;
  config: OAuthConfig;
  /** The MCP resources tokens may be issued for; anything else is `invalid_target`. */
  resources: McpResourceCatalog;
  now?: () => Date;
};

/**
 * The authorization-server half of the public MCP: discovery metadata, `/authorize`,
 * `/token` and `/revoke`, with no knowledge of MCP requests. Clients are identified only
 * by Client ID Metadata Documents; there is no dynamic registration.
 */
export class OAuthAuthorizationServer {
  constructor(private readonly deps: OAuthAuthorizationServerDeps) {}

  static fromConfig(config: OAuthConfig, resources: McpResourceCatalog): OAuthAuthorizationServer {
    return new OAuthAuthorizationServer({
      stores: () => OAuthStoresLoader.getStores(),
      clients: new ClientIdMetadataResolver(),
      config,
      resources
    });
  }

  /** The issuer identifier, spelled exactly as metadata and every `iss` parameter spell it. */
  static getIssuerUrl(config: OAuthConfig): string {
    return CanonicalUrl.of(config.issuer_url);
  }

  /** Where RFC 8414 puts the metadata for this issuer: the well-known prefix ahead of the issuer's path. */
  static getMetadataEndpointPath(config: OAuthConfig): string {
    const path = config.issuer_url.pathname.replace(/\/+$/, '');
    return `/.well-known/oauth-authorization-server${path}`;
  }

  static getOAuthEndpointPath(config: OAuthConfig, endpoint: 'authorize' | 'token' | 'revoke'): string {
    return `${config.issuer_url.pathname.replace(/\/+$/, '')}/${endpoint}`;
  }

  getAuthorizationServerMetadata(): AuthorizationServerMetadata {
    const issuer = OAuthAuthorizationServer.getIssuerUrl(this.deps.config);
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      revocation_endpoint: `${issuer}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: this.deps.resources.listSupportedScopes(),
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true
    };
  }

  /**
   * Returns where to send the browser: the consent page, or the client's redirect_uri
   * carrying an error. Throws only when the client or its redirect_uri cannot be
   * trusted, in which case the error must be shown here and never redirected.
   */
  async beginAuthorizationRequest(params: OAuthParams): Promise<string> {
    if (!params.client_id) throw new OAuthProtocolError('invalid_request', 'client_id is required');
    const client = await this.deps.clients.resolveClientMetadata(params.client_id);
    const redirect_uri = OAuthAuthorizationServer.resolveRedirectUri(client, params.redirect_uri);

    const issuer = OAuthAuthorizationServer.getIssuerUrl(this.deps.config);
    const fail = (error: string, description: string) =>
      OAuthRedirects.buildAuthorizationResponseRedirect({
        redirect_uri,
        issuer,
        state: params.state,
        params: { error, error_description: description }
      });

    if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported');
    if (params.code_challenge_method !== 'S256' || !params.code_challenge || !OAuthPkce.isValidCodeChallenge(params.code_challenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    // MCP clients must name the resource (RFC 8707); with several MCP servers, a missing
    // one would be a guess.
    const resource = params.resource ? this.deps.resources.findResourceByUrl(params.resource) : null;
    if (!resource) return fail('invalid_target', 'resource must name one of this server\'s MCP endpoints');

    const { requests } = await this.deps.stores();
    const request_id = await requests.createAuthorizationRequest({
      client_id: client.client_id,
      client_name: client.client_name,
      client_host: client.client_host,
      redirect_uri,
      code_challenge: params.code_challenge,
      state: params.state,
      requested_scopes: McpResourceCatalog.resolveRequestedResourceScopes(resource, params.scope?.split(' ').filter(Boolean) ?? []),
      resource: resource.url,
      now: this.getCurrentTime()
    });

    logger.info({ client_id: client.client_id }, 'oauth authorization started');
    const consent = new URL(CONSENT_PATH, this.deps.config.app_public_url);
    consent.searchParams.set('request', request_id);
    return consent.toString();
  }

  async exchangeTokenGrant(params: OAuthParams): Promise<OAuthTokenResponse> {
    if (params.grant_type === 'authorization_code') return this.exchangeAuthorizationCode(params);
    if (params.grant_type === 'refresh_token') return this.rotateRefreshToken(params);
    throw new OAuthProtocolError('unsupported_grant_type', 'Supported grant types are authorization_code and refresh_token');
  }

  /** RFC 7009: the answer is the same whether or not the token existed. */
  async revokeTokenFamilyForToken(params: OAuthParams): Promise<void> {
    if (!params.token || !params.client_id) throw new OAuthProtocolError('invalid_request', 'token and client_id are required');
    const { tokens } = await this.deps.stores();
    const revoked = await tokens.revokeTokenFamilyForToken({ token: params.token, client_id: params.client_id, now: this.getCurrentTime() });
    logger.info({ client_id: params.client_id, revoked }, 'oauth token revoked');
  }

  private async exchangeAuthorizationCode(params: OAuthParams): Promise<OAuthTokenResponse> {
    if (!params.code || !params.code_verifier || !params.client_id) {
      throw new OAuthProtocolError('invalid_request', 'code, code_verifier and client_id are required');
    }
    const client = await this.deps.clients.resolveClientMetadata(params.client_id);
    const now = this.getCurrentTime();
    const stores = await this.deps.stores();

    const code = await stores.codes.findAuthorizationCode(params.code);
    if (!code || code.client_id !== client.client_id) throw new OAuthProtocolError('invalid_grant', 'Invalid authorization code');
    if (code.consumed_at) {
      // OAuth 2.1 §4.1.2: a code used twice may have been stolen, so its tokens go too.
      if (code.family_id) await stores.tokens.revokeTokenFamily({ family_id: code.family_id, now });
      logger.warn({ client_id: client.client_id, grant_id: code.grant_id }, 'oauth authorization code replay detected');
      throw new OAuthProtocolError('invalid_grant', 'Authorization code was already used');
    }
    if (code.expires_at <= now) throw new OAuthProtocolError('invalid_grant', 'Authorization code has expired');
    if (params.redirect_uri !== undefined && params.redirect_uri !== code.redirect_uri) {
      throw new OAuthProtocolError('invalid_grant', 'redirect_uri does not match the authorization request');
    }
    if (params.resource !== undefined && CanonicalUrl.parse(params.resource) !== code.resource) {
      throw new OAuthProtocolError('invalid_target', 'resource does not match the authorization request');
    }
    if (!OAuthPkce.verifyCodeVerifier({ code_verifier: params.code_verifier, code_challenge: code.code_challenge })) {
      throw new OAuthProtocolError('invalid_grant', 'code_verifier does not match the code_challenge');
    }

    const grant = await stores.grants.findGrantById(code.grant_id);
    if (!grant) throw new OAuthProtocolError('invalid_grant', 'The connection was revoked');

    const family_id = OAuthTokenFamilies.createTokenFamilyId();
    const consumed = await stores.codes.consumeAuthorizationCode({ code: params.code, client_id: client.client_id, now, family_id });
    if (!consumed) throw new OAuthProtocolError('invalid_grant', 'Authorization code was already used');

    const issued = await stores.tokens.issueTokensInExistingFamily({
      grant,
      family_id,
      scopes: code.scopes,
      now,
      with_refresh: client.allows_refresh
    });
    logger.info({ user_id: grant.user_id, client_id: client.client_id, grant_id: grant.grant_id, scopes: issued.scopes }, 'oauth tokens issued');
    return OAuthTokenFamilies.toOAuthTokenResponse(issued);
  }

  private async rotateRefreshToken(params: OAuthParams): Promise<OAuthTokenResponse> {
    if (!params.refresh_token || !params.client_id) {
      throw new OAuthProtocolError('invalid_request', 'refresh_token and client_id are required');
    }
    const client = await this.deps.clients.resolveClientMetadata(params.client_id);
    const now = this.getCurrentTime();
    const stores = await this.deps.stores();

    const consumed = await stores.tokens.consumeRefreshTokenForRotation({ refresh_token: params.refresh_token, client_id: client.client_id, now });
    if (!consumed) throw new OAuthProtocolError('invalid_grant', 'Invalid, expired or already used refresh token');

    const grant = await stores.grants.findGrantById(consumed.grant_id);
    if (!grant) throw new OAuthProtocolError('invalid_grant', 'The connection was revoked');
    if (params.resource !== undefined && CanonicalUrl.parse(params.resource) !== consumed.resource) {
      throw new OAuthProtocolError('invalid_target', 'resource does not match the grant');
    }
    const resource = this.deps.resources.findResourceByUrl(consumed.resource);
    if (!resource) throw new OAuthProtocolError('invalid_target', 'This MCP endpoint is no longer served');

    const issued = await stores.tokens.issueTokensInExistingFamily({
      grant,
      family_id: consumed.family_id,
      scopes: OAuthAuthorizationServer.resolveRefreshTokenScopes({ token: consumed, grant_scopes: grant.scopes, resource, requested: params.scope }),
      now,
      with_refresh: true
    });
    logger.debug({ client_id: client.client_id, grant_id: grant.grant_id }, 'oauth tokens refreshed');
    return OAuthTokenFamilies.toOAuthTokenResponse(issued);
  }

  /** A refresh may ask for less than it holds, never more (RFC 6749 §6); the grant caps it too. */
  private static resolveRefreshTokenScopes(input: {
    token: OAuthTokenRecord;
    grant_scopes: string[];
    resource: McpResource;
    requested: string | undefined;
  }): string[] {
    const held = input.token.scopes.filter((scope) => input.grant_scopes.includes(scope));
    const asked = input.requested?.split(' ').filter(Boolean);
    if (!asked || asked.length === 0) return held;
    if (asked.some((scope) => !held.includes(scope))) {
      throw new OAuthProtocolError('invalid_scope', 'Requested scope exceeds what was granted');
    }
    return McpResourceCatalog.resolveRequestedResourceScopes(input.resource, asked);
  }

  /** The registered redirect_uri to use, or a non-redirectable error: never send a code to an unregistered place. */
  private static resolveRedirectUri(client: OAuthClient, requested: string | undefined): string {
    if (requested === undefined) {
      if (client.redirect_uris.length === 1) return client.redirect_uris[0];
      throw new OAuthProtocolError('invalid_request', 'redirect_uri is required for a client with several redirect URIs');
    }
    if (!OAuthRedirects.matchesRegisteredRedirectUri(requested, client.redirect_uris)) {
      throw new OAuthProtocolError('invalid_request', 'redirect_uri is not registered for this client');
    }
    return requested;
  }

  private getCurrentTime(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
