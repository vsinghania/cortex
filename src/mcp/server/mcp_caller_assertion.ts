import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Id } from '../../lib/id.js';
import type { McpGatewayCaller } from './types/mcp_server.types.js';

const ISSUER = 'cortex-mcp-gateway';
/** Minted per proxied request, so it only has to outlive the hop to the notes server. */
const ASSERTION_TTL_SEC = 60;

const ClaimsSchema = z.object({
  sub: z.string().min(1),
  client_id: z.string().min(1),
  scope: z.string(),
  kind: z.enum(['external', 'first_party'])
});

/**
 * How the public gateway tells an MCP server who a request is for. It is signed with a
 * secret only the gateway and the MCP servers hold, and addressed to one server by its
 * audience, so a server never has to trust a header: an unsigned, expired or
 * misaddressed assertion is simply not a caller.
 */
export class McpCallerAssertion {
  private constructor() {}

  static signGatewayCallerAssertion(input: { secret: string; audience: string; caller: McpGatewayCaller }): string {
    return jwt.sign(
      {
        client_id: input.caller.client_id,
        scope: [...input.caller.scopes].join(' '),
        kind: input.caller.kind
      },
      input.secret,
      {
        algorithm: 'HS256',
        subject: input.caller.user_id,
        issuer: ISSUER,
        audience: input.audience,
        expiresIn: ASSERTION_TTL_SEC,
        jwtid: Id.generateRandom()
      }
    );
  }

  static verifyGatewayCallerAssertion(input: { secret: string; audience: string; token: string }): McpGatewayCaller | null {
    try {
      const decoded = jwt.verify(input.token, input.secret, { algorithms: ['HS256'], issuer: ISSUER, audience: input.audience });
      const claims = ClaimsSchema.safeParse(decoded);
      if (!claims.success) return null;
      return {
        kind: claims.data.kind,
        user_id: claims.data.sub,
        client_id: claims.data.client_id,
        scopes: new Set(claims.data.scope.split(' ').filter(Boolean))
      };
    } catch {
      return null;
    }
  }
}
