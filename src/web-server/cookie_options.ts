import { TokenUtils } from '../auth_svc/utils/token_utils.js';
import { Time } from '../lib/time.js';

/**
 * One place for the cookie flags, so a deploy that sets COOKIE_DOMAIN or
 * COOKIE_SECURE cannot have it apply to some of our cookies and not others.
 */
export class CookieOptions {
  private constructor() {}

  private static base() {
    const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
    const domain = process.env.COOKIE_DOMAIN || undefined;
    const sameSite = (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none' | undefined) ?? 'lax';
    return { httpOnly: true, secure, domain, sameSite } as const;
  }

  static refresh() {
    return {
      ...CookieOptions.base(),
      path: '/',
      maxAge: Time.secondsToMs(TokenUtils.refreshTokenTtlSec())
    } as const;
  }

  /**
   * An OAuth callback is a cross-site top-level navigation from the provider, which
   * a strict cookie would not ride along on, whatever COOKIE_SAMESITE says. Scoped
   * to the callback's own path so it is not sent anywhere else.
   */
  static oauthState(params: { path: string; max_age_ms: number }) {
    return {
      ...CookieOptions.base(),
      sameSite: 'lax',
      path: params.path,
      maxAge: params.max_age_ms
    } as const;
  }
}
