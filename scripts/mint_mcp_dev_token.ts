/*
 * Mints an access token for the public /mcp gateway, for exercising the resource server
 * by hand before (or without) the OAuth flow. Writes a grant and a token to the auth
 * database the environment points at. Refuses to run with NODE_ENV=production.
 *
 *   npx tsx scripts/mint_mcp_dev_token.ts <user_id> [read|read_write] [ttl_minutes] [resource_id]
 *
 * Then: curl -H "Authorization: Bearer <token>" $MCP_PUBLIC_BASE_URL/notes ...
 */
import 'dotenv/config';
import { DatastoreBootstrap } from '../src/bootstrap/datastore_bootstrap.js';
import { McpResourceCatalog } from '../src/mcp/resource/mcp_resource_catalog.js';
import type { McpResourceId } from '../src/mcp/resource/mcp_resource.types.js';
import { OAuthStoresLoader } from '../src/oauth_svc/oauth_stores.js';
import { Time } from '../src/lib/time.js';

const DEV_CLIENT_ID = 'cortex-dev-cli';
const DEFAULT_TTL_MINUTES = 60;

class MintMcpDevToken {
  private constructor() {}

  static async main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to mint a dev token with NODE_ENV=production.');
    const [user_id, access = 'read_write', ttl = String(DEFAULT_TTL_MINUTES), resource_id = 'notes'] = process.argv.slice(2);
    if (!user_id || (access !== 'read' && access !== 'read_write')) {
      throw new Error('Usage: mint_mcp_dev_token.ts <user_id> [read|read_write] [ttl_minutes] [resource_id]');
    }
    const resource = McpResourceCatalog.fromEnv().findResourceById(resource_id as McpResourceId);
    if (!resource) throw new Error(`No enabled MCP resource "${resource_id}"; are MCP_PUBLIC_BASE_URL and its internal URL set?`);

    await DatastoreBootstrap.connectMongo();
    try {
      const stores = await OAuthStoresLoader.getStores();
      const scopes = access === 'read_write' ? McpResourceCatalog.listResourceScopes(resource) : [resource.scopes.read];
      const grant = await stores.grants.upsertGrant({
        user_id,
        client_id: DEV_CLIENT_ID,
        client_name: 'Cortex dev token',
        kind: 'external',
        scopes,
        resource: resource.url
      });
      const issued = await stores.tokens.issueTokens({
        grant,
        scopes,
        now: new Date(),
        with_refresh: false,
        access_ttl_sec: Time.minutesToSec(Number(ttl))
      });
      console.log(JSON.stringify({ access_token: issued.access.value, scopes, expires_at: issued.access.expires_at, resource: grant.resource }, null, 2));
    } finally {
      await DatastoreBootstrap.disconnectMongo();
    }
  }
}

MintMcpDevToken.main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
