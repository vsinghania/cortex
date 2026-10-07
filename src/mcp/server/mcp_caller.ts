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
    return {
      token: McpCallers.VERIFIED_TOKEN_PLACEHOLDER,
      clientId: caller.kind === 'internal' ? McpCallers.INTERNAL_CLIENT_ID : caller.client_id,
      scopes: caller.kind === 'internal' ? [] : [...caller.scopes],
      extra
    };
  }

  /** Null for anything this server did not authenticate itself: such a request is refused. */
  static fromAuthInfo(auth_info: AuthInfo | undefined): McpCaller | null {
    const extra = auth_info?.extra as CallerExtra | undefined;
    if (!auth_info || !extra) return null;
    if (extra.caller_kind === 'internal') return { kind: 'internal', user_id: extra.user_id };
    if ((extra.caller_kind === 'external' || extra.caller_kind === 'first_party') && extra.user_id) {
      return { kind: extra.caller_kind, user_id: extra.user_id, client_id: auth_info.clientId, scopes: new Set(auth_info.scopes) };
    }
    return null;
  }

  /** Internal callers hold the service credential, and that alone is what grants them everything. */
  static allows(caller: McpCaller, scope: string): boolean {
    return caller.kind === 'internal' || caller.scopes.has(scope);
  }

  /** Only third-party assistants get the trimmed, linked view and the server guide. */
  static isExternal(caller: McpCaller): boolean {
    return caller.kind === 'external';
  }

  // Worded for any caller: external assistants can see this text too.
  static requireUserId(caller: McpCaller): string {
    if (!caller.user_id) throw new Error('This request is not signed in as a Cortex user.');
    return caller.user_id;
  }
}
