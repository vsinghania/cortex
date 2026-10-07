/*
 * Mints an access token for the public /mcp gateway, for exercising the resource server
 * by hand before (or without) the OAuth flow. Writes a grant and a token to the auth
 * database the environment points at. Refuses to run with NODE_ENV=production.
 *
 *   npx tsx scripts/mint_mcp_dev_token.ts <user_id> [read|read_write] [ttl_minutes]
 *
 * Then: curl -H "Authorization: Bearer <token>" $MCP_PUBLIC_URL ...
 */
import 'dotenv/config';
import { DatastoreBootstrap } from '../src/bootstrap/datastore_bootstrap.js';
import { OAuthConfigLoader } from '../src/oauth_svc/config/oauth_config.js';
import { OAuthResource } from '../src/oauth_svc/oauth_resource.js';
import { OAuthStoresLoader } from '../src/oauth_svc/oauth_stores.js';
import { OAuthTokenFamilies } from '../src/oauth_svc/oauth_token_families.js';
import { NotesScope } from '../src/mcp/server/notes/notes_scope.js';
import { Id } from '../src/lib/id.js';
import { Time } from '../src/lib/time.js';

const DEV_CLIENT_ID = 'cortex-dev-cli';
const DEFAULT_TTL_MINUTES = 60;

class MintMcpDevToken {
  private constructor() {}

  static async main(): Promise<void> {
    if (process.env.NODE_ENV === 'production') throw new Error('Refusing to mint a dev token with NODE_ENV=production.');
    const [user_id, access = 'read_write', ttl = String(DEFAULT_TTL_MINUTES)] = process.argv.slice(2);
    if (!user_id || (access !== 'read' && access !== 'read_write')) {
      throw new Error('Usage: mint_mcp_dev_token.ts <user_id> [read|read_write] [ttl_minutes]');
    }
    const config = OAuthConfigLoader.fromEnv();
    if (!config) throw new Error('OAUTH_ISSUER_URL, MCP_PUBLIC_URL and APP_PUBLIC_URL must be set.');

    await DatastoreBootstrap.connectMongo();
    try {
      const stores = await OAuthStoresLoader.get();
      const scopes = access === 'read_write' ? [...NotesScope.ALL] : [NotesScope.READ];
      const grant = await stores.grants.upsert({
        grant_id: Id.generateUuidV7(),
        user_id,
        client_id: DEV_CLIENT_ID,
        client_name: 'Cortex dev token',
        kind: 'external',
        scopes,
        resource: OAuthResource.canonicalize(config.mcp_resource_url)
      });
      const issued = await new OAuthTokenFamilies(stores.tokens).start({
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
