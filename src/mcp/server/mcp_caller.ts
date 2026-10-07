import type { AuthInfo } from '@modelcontextprotocol/server';
import type { McpCaller } from './types/mcp_server.types.js';

type CallerExtra = { caller_kind: McpCaller['kind']; user_id?: string };

/**
 * Carries an authenticated McpCaller through the SDK, which only passes `authInfo`
 * from the HTTP layer to the per-request server factory.
 */
export class McpCallers {
  static readonly INTERNAL_CLIENT_ID = 'cortex-internal';
  /** Stands in for the credential in `authInfo`, so the real token never travels past authentication. */
  private static readonly VERIFIED_TOKEN_PLACEHOLDER = 'verified';

  private constructor() {}

  static toAuthInfo(caller: McpCaller): AuthInfo {
    const extra: CallerExtra = { caller_kind: caller.kind, user_id: caller.user_id };
    return { token: McpCallers.VERIFIED_TOKEN_PLACEHOLDER, clientId: McpCallers.INTERNAL_CLIENT_ID, scopes: [], extra };
  }

  /** Null for anything this server did not authenticate itself: such a request is refused. */
  static fromAuthInfo(auth_info: AuthInfo | undefined): McpCaller | null {
    const extra = auth_info?.extra as CallerExtra | undefined;
    if (!auth_info || !extra) return null;
    if (extra.caller_kind === 'internal') return { kind: 'internal', user_id: extra.user_id };
    return null;
  }

  // Worded for any caller: an MCP client can see this text.
  static requireUserId(caller: McpCaller): string {
    if (!caller.user_id) throw new Error('This request is not signed in as a Cortex user.');
    return caller.user_id;
  }
}
