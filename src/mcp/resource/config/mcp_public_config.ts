import { z } from 'zod';
import type { McpPublicConfig } from '../mcp_resource.types.js';

/** Compose interpolates an unset `${VAR:-}` to '', which has to mean "not configured". */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const EnvSchema = z
  .object({
    MCP_PUBLIC_BASE_URL: optionalEnv(z.string().url().optional()),
    OAUTH_ISSUER_URL: optionalEnv(z.string().url().optional())
  })
  .refine((env) => !env.MCP_PUBLIC_BASE_URL || Boolean(env.OAUTH_ISSUER_URL), {
    message: 'OAUTH_ISSUER_URL is required when MCP_PUBLIC_BASE_URL is set; it names the authorization server the MCP resources trust',
    path: ['OAUTH_ISSUER_URL']
  });

export class McpPublicConfigLoader {
  private constructor() {}

  /** Null when MCP_PUBLIC_BASE_URL is unset, which leaves the public MCP resources unserved. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): McpPublicConfig | null {
    const parsed = EnvSchema.parse(env);
    if (!parsed.MCP_PUBLIC_BASE_URL || !parsed.OAUTH_ISSUER_URL) return null;
    return {
      base_url: new URL(parsed.MCP_PUBLIC_BASE_URL),
      authorization_server_url: new URL(parsed.OAUTH_ISSUER_URL)
    };
  }
}
