import { z } from 'zod';
import { logger } from '../../common/logger.js';
import { LruCache } from '../../lib/cache/lru_cache.js';
import { SafeFetchError, SafeFetcher } from '../../lib/net/safe_fetcher.js';
import { Time } from '../../lib/time.js';
import { OAuthRedirectUriPolicy } from '../oauth_redirect_uri_policy.js';
import { OAuthProtocolError } from '../oauth_errors.js';
import type { OAuthClient } from '../types/oauth.types.js';

const MIN_CACHE_TTL_MS = Time.minutesToMs(1);
const DEFAULT_CACHE_TTL_MS = Time.minutesToMs(5);
const MAX_CACHE_TTL_MS = Time.hoursToMs(24);
const MAX_CACHED_CLIENTS = 500;

/** Only what we use, validated at the boundary; unknown fields are ignored. */
const MetadataDocumentSchema = z.object({
  client_id: z.string().min(1),
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z.array(z.string().min(1)).min(1).max(20),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  /** Not a registered metadata field, but how a client such as ChatGPT says it can also act as a public client. */
  token_endpoint_auth_methods_supported: z.array(z.string()).optional()
});

/**
 * OAuth Client ID Metadata Documents: a client's id is an https URL, and the document
 * there is its registration. Cortex registers no clients of its own; every client is
 * resolved this way (the MCP 2026-07-28 spec's SHOULD; Dynamic Client Registration is
 * deprecated and deliberately not offered).
 */
export class ClientIdMetadataResolver {
  private readonly cache = new LruCache<string, OAuthClient>({ max: MAX_CACHED_CLIENTS, default_ttl_ms: DEFAULT_CACHE_TTL_MS });

  constructor(private readonly fetcher: SafeFetcher = new SafeFetcher()) {}

  /** Throws invalid_client for anything that is not a usable, valid metadata document. */
  async resolve(client_id: string): Promise<OAuthClient> {
    const url = ClientIdMetadataResolver.validClientIdUrl(client_id);
    const cached = this.cache.get(client_id);
    if (cached) return cached;

    const { json, cache_control } = await this.fetch(client_id);
    const client = ClientIdMetadataResolver.toClient(client_id, url, json);
    const ttl_ms = ClientIdMetadataResolver.cacheTtlMs(cache_control);
    if (ttl_ms > 0) this.cache.set(client_id, client, ttl_ms);

    logger.info({ client_id, client_name: client.client_name, redirect_count: client.redirect_uris.length }, 'oauth client metadata resolved');
    return client;
  }

  /**
   * draft-ietf-oauth-client-id-metadata-document §3: https, a path, and nothing that
   * would make two spellings name one client (fragments, credentials, dot segments).
   */
  private static validClientIdUrl(client_id: string): URL {
    let url: URL;
    try {
      url = new URL(client_id);
    } catch {
      throw new OAuthProtocolError('invalid_client', 'client_id must be the https URL of a client metadata document');
    }
    const has_path = url.pathname.length > 1;
    const has_dot_segments = /(^|\/)\.\.?(\/|$)/.test(client_id.replace(/^https:\/\/[^/]+/, ''));
    if (url.protocol !== 'https:' || !has_path || url.hash || url.username || url.password || has_dot_segments) {
      throw new OAuthProtocolError('invalid_client', 'client_id must be the https URL of a client metadata document');
    }
    return url;
  }

  private async fetch(client_id: string): Promise<{ json: unknown; cache_control?: string }> {
    try {
      return await this.fetcher.getJson(client_id);
    } catch (err) {
      const reason = err instanceof SafeFetchError ? err.reason : 'unknown';
      logger.warn({ client_id, reason }, 'oauth client metadata fetch refused');
      throw new OAuthProtocolError('invalid_client', 'The client metadata document could not be fetched');
    }
  }

  private static toClient(client_id: string, url: URL, json: unknown): OAuthClient {
    const parsed = MetadataDocumentSchema.safeParse(json);
    if (!parsed.success) throw new OAuthProtocolError('invalid_client', 'The client metadata document is missing required fields');
    const doc = parsed.data;

    if (doc.client_id !== client_id) {
      throw new OAuthProtocolError('invalid_client', 'The client metadata document names a different client_id');
    }
    if (!ClientIdMetadataResolver.canActAsPublicClient(doc)) {
      throw new OAuthProtocolError('invalid_client', 'Only public clients (token_endpoint_auth_method "none") are supported');
    }
    if (doc.grant_types && !doc.grant_types.includes('authorization_code')) {
      throw new OAuthProtocolError('invalid_client', 'The client does not use the authorization_code grant');
    }
    if (doc.redirect_uris.some((uri) => !OAuthRedirectUriPolicy.isAllowed(uri))) {
      throw new OAuthProtocolError('invalid_client', 'The client declares a redirect_uri that is not allowed');
    }

    return {
      client_id,
      client_name: doc.client_name,
      client_host: url.host,
      redirect_uris: doc.redirect_uris,
      allows_refresh: !doc.grant_types || doc.grant_types.includes('refresh_token')
    };
  }

  /**
   * The token endpoint authenticates no one yet (metadata advertises only "none"), so a
   * client must be able to work without authenticating. ChatGPT prefers private_key_jwt
   * but lists "none" among the methods it supports, and then uses it.
   */
  private static canActAsPublicClient(doc: z.infer<typeof MetadataDocumentSchema>): boolean {
    if (!doc.token_endpoint_auth_method || doc.token_endpoint_auth_method === 'none') return true;
    return doc.token_endpoint_auth_methods_supported?.includes('none') ?? false;
  }

  /** Respects the document's own Cache-Control, within bounds that keep both abuse and staleness in check. */
  private static cacheTtlMs(cache_control: string | undefined): number {
    if (!cache_control) return DEFAULT_CACHE_TTL_MS;
    if (/\b(no-store|no-cache)\b/i.test(cache_control)) return 0;
    const max_age = /\bmax-age=(\d+)/i.exec(cache_control);
    if (!max_age) return DEFAULT_CACHE_TTL_MS;
    return Math.min(MAX_CACHE_TTL_MS, Math.max(MIN_CACHE_TTL_MS, Time.secondsToMs(Number(max_age[1]))));
  }
}
