import { z } from 'zod';
import { Env } from '../../lib/env.js';
import type { GoogleOAuthConfig } from '../types/google_auth.types.js';

const EnvSchema = z
  .object({
    GOOGLE_OAUTH_CLIENT_ID: Env.normalizeEmptyStringAsUndefined(z.string().trim().min(1).optional()),
    GOOGLE_OAUTH_CLIENT_SECRET: Env.normalizeEmptyStringAsUndefined(z.string().trim().min(1).optional()),
    GOOGLE_OAUTH_REDIRECT_URI: Env.normalizeEmptyStringAsUndefined(z.string().url().optional())
  })
  .refine((env) => Boolean(env.GOOGLE_OAUTH_CLIENT_ID) === Boolean(env.GOOGLE_OAUTH_CLIENT_SECRET), {
    message: 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together',
    path: ['GOOGLE_OAUTH_CLIENT_ID']
  })
  .refine((env) => !env.GOOGLE_OAUTH_CLIENT_ID || Boolean(env.GOOGLE_OAUTH_REDIRECT_URI), {
    message: 'GOOGLE_OAUTH_REDIRECT_URI is required when Google sign-in is configured',
    path: ['GOOGLE_OAUTH_REDIRECT_URI']
  });

export class GoogleOAuthConfigLoader {
  private constructor() {}

  /**
   * Returns null when the client credentials are unset, which disables Google sign-in.
   * The redirect URI alone does not enable it, so deploys can carry it as a literal.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig | null {
    const parsed = EnvSchema.parse(env);
    if (!parsed.GOOGLE_OAUTH_CLIENT_ID || !parsed.GOOGLE_OAUTH_CLIENT_SECRET || !parsed.GOOGLE_OAUTH_REDIRECT_URI) {
      return null;
    }
    return {
      client_id: parsed.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: parsed.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: parsed.GOOGLE_OAUTH_REDIRECT_URI
    };
  }
}
