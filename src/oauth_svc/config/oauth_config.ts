import { z } from 'zod';
import { Env } from '../../lib/env.js';

const EnvSchema = z
  .object({
    OAUTH_ISSUER_URL: Env.normalizeEmptyStringAsUndefined(z.string().url().optional()),
    APP_PUBLIC_URL: Env.normalizeEmptyStringAsUndefined(z.string().url().optional())
  })
  .refine((env) => !env.OAUTH_ISSUER_URL || Boolean(env.APP_PUBLIC_URL), {
    message: 'APP_PUBLIC_URL is required when OAUTH_ISSUER_URL is set; the consent page lives there',
    path: ['APP_PUBLIC_URL']
  });

/**
 * The authorization server's own settings. Which resources it issues tokens for comes
 * from the MCP resource catalog, which is configured separately.
 */
export type OAuthConfig = {
  /** This authorization server's identifier; its metadata lives under its origin. */
  issuer_url: URL;
  /** The SPA origin, where the consent page is. */
  app_public_url: URL;
};

export class OAuthConfigLoader {
  private constructor() {}

  /** Null when OAUTH_ISSUER_URL is unset, which leaves the authorization server unmounted. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
    const parsed = EnvSchema.parse(env);
    if (!parsed.OAUTH_ISSUER_URL || !parsed.APP_PUBLIC_URL) return null;
    return {
      issuer_url: new URL(parsed.OAUTH_ISSUER_URL),
      app_public_url: new URL(parsed.APP_PUBLIC_URL)
    };
  }
}
