/**
 * The whole contract between the MCP resource servers (the public MCP gateway) and the
 * authorization server that issued the token. The gateway knows nothing about how
 * tokens are stored; the authorization server knows nothing about MCP requests.
 */
export type VerifiedMcpToken = {
  user_id: string;
  client_id: string;
  grant_id: string;
  scopes: string[];
  /** The resource the token was issued for (RFC 8707); the gateway checks it is this one. */
  resource: string;
  /** `first_party` is Cortex's own caller (a voice session); `external` is a third-party assistant. */
  kind: 'external' | 'first_party';
};

export interface McpTokenVerifier {
  /** Null for a token that is unknown, expired or revoked. Throws only when verification itself cannot run. */
  verify(access_token: string): Promise<VerifiedMcpToken | null>;
}
