import { z } from 'zod';

/** Compose interpolates an unset `${VAR:-}` to '', which has to mean "not configured". */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const EnvSchema = z
  .object({
    OAUTH_ISSUER_URL: optionalEnv(z.string().url().optional()),
    MCP_PUBLIC_URL: optionalEnv(z.string().url().optional()),
    APP_PUBLIC_URL: optionalEnv(z.string().url().optional())
  })
  .refine((env) => Boolean(env.OAUTH_ISSUER_URL) === Boolean(env.MCP_PUBLIC_URL), {
    message: 'OAUTH_ISSUER_URL and MCP_PUBLIC_URL must be set together',
    path: ['OAUTH_ISSUER_URL']
  })
  .refine((env) => !env.OAUTH_ISSUER_URL || Boolean(env.APP_PUBLIC_URL), {
    message: 'APP_PUBLIC_URL is required when the public MCP is configured; the consent page lives there',
    path: ['APP_PUBLIC_URL']
  });

export type OAuthConfig = {
  /** This authorization server's identifier; its metadata lives under its origin. */
  issuer_url: URL;
  /** The canonical URL of the public MCP endpoint, which tokens are bound to (RFC 8707). */
  mcp_resource_url: URL;
  /** The SPA origin, where the consent page is. */
  app_public_url: URL;
};

export class OAuthConfigLoader {
  private constructor() {}

  /** Null when unset, which leaves the public MCP and its authorization server unmounted. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
    const parsed = EnvSchema.parse(env);
    if (!parsed.OAUTH_ISSUER_URL || !parsed.MCP_PUBLIC_URL || !parsed.APP_PUBLIC_URL) {
      return null;
    }
    return {
      issuer_url: new URL(parsed.OAUTH_ISSUER_URL),
      mcp_resource_url: new URL(parsed.MCP_PUBLIC_URL),
      app_public_url: new URL(parsed.APP_PUBLIC_URL)
    };
  }
}
