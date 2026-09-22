import { z } from 'zod';
import type { OneNoteOAuthConfig } from '../types/onenote_connection.types.js';

/**
 * Compose interpolates an unset `${VAR:-}` to an empty string, so '' has to mean
 * "not configured" rather than a value to validate.
 */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** Both personal and work/school accounts, which is what `common` buys. */
const DEFAULT_AUTHORITY = 'https://login.microsoftonline.com/common';

const EnvSchema = z
  .object({
    MS_OAUTH_CLIENT_ID: optionalEnv(z.string().trim().min(1).optional()),
    MS_OAUTH_CLIENT_SECRET: optionalEnv(z.string().trim().min(1).optional()),
    MS_OAUTH_REDIRECT_URI: optionalEnv(z.string().url().optional()),
    MS_OAUTH_AUTHORITY: optionalEnv(z.string().url().optional())
  })
  .refine((env) => Boolean(env.MS_OAUTH_CLIENT_ID) === Boolean(env.MS_OAUTH_CLIENT_SECRET), {
    message: 'MS_OAUTH_CLIENT_ID and MS_OAUTH_CLIENT_SECRET must be set together',
    path: ['MS_OAUTH_CLIENT_ID']
  })
  .refine((env) => !env.MS_OAUTH_CLIENT_ID || Boolean(env.MS_OAUTH_REDIRECT_URI), {
    message: 'MS_OAUTH_REDIRECT_URI is required when OneNote is configured',
    path: ['MS_OAUTH_REDIRECT_URI']
  });

export class OneNoteConfigLoader {
  private constructor() {}

  /**
   * Returns null when the client credentials are unset, which disables OneNote.
   * The redirect URI alone does not enable it, so deploys can carry it as a literal.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): OneNoteOAuthConfig | null {
    const parsed = EnvSchema.parse(env);
    if (!parsed.MS_OAUTH_CLIENT_ID || !parsed.MS_OAUTH_CLIENT_SECRET || !parsed.MS_OAUTH_REDIRECT_URI) {
      return null;
    }
    return {
      client_id: parsed.MS_OAUTH_CLIENT_ID,
      client_secret: parsed.MS_OAUTH_CLIENT_SECRET,
      redirect_uri: parsed.MS_OAUTH_REDIRECT_URI,
      authority: parsed.MS_OAUTH_AUTHORITY ?? DEFAULT_AUTHORITY
    };
  }
}
