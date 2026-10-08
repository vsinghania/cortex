import { TokenUtils } from '../auth_svc/utils/token_utils.js';
import { Time } from '../lib/time.js';

export const OAUTH_ACCESS_TOKEN_TTL_SEC = Time.hoursToSec(1);
export const OAUTH_REFRESH_TOKEN_TTL_SEC = Time.daysToSec(90);
export const OAUTH_AUTHORIZATION_CODE_TTL_SEC = Time.minutesToSec(1);
/** Long enough to sign in (or sign up) on the way to the consent screen. */
export const OAUTH_AUTHORIZATION_REQUEST_TTL_SEC = Time.minutesToSec(15);

/** Prefixes make a leaked token recognisable to secret scanners and to whoever finds it. */
const ACCESS_TOKEN_PREFIX = 'cx_at_';
const REFRESH_TOKEN_PREFIX = 'cx_rt_';
const AUTHORIZATION_CODE_PREFIX = 'cx_ac_';

export type IssuedSecret = {
  /** The raw value: handed to the client once, never stored. */
  value: string;
  hash: string;
  expires_at: Date;
};

export class OAuthTokenIssuer {
  private constructor() {}

  static accessToken(now: Date, ttl_sec: number = OAUTH_ACCESS_TOKEN_TTL_SEC): IssuedSecret {
    return OAuthTokenIssuer.issue(ACCESS_TOKEN_PREFIX, now, ttl_sec);
  }

  static refreshToken(now: Date): IssuedSecret {
    return OAuthTokenIssuer.issue(REFRESH_TOKEN_PREFIX, now, OAUTH_REFRESH_TOKEN_TTL_SEC);
  }

  static authorizationCode(now: Date): IssuedSecret {
    return OAuthTokenIssuer.issue(AUTHORIZATION_CODE_PREFIX, now, OAUTH_AUTHORIZATION_CODE_TTL_SEC);
  }

  static hash(value: string): string {
    return TokenUtils.sha256Base64Url(value);
  }

  static expiresAfter(now: Date, ttl_sec: number): Date {
    return new Date(now.getTime() + Time.secondsToMs(ttl_sec));
  }

  private static issue(prefix: string, now: Date, ttl_sec: number): IssuedSecret {
    const value = `${prefix}${TokenUtils.generateOpaqueToken(32)}`;
    return { value, hash: OAuthTokenIssuer.hash(value), expires_at: OAuthTokenIssuer.expiresAfter(now, ttl_sec) };
  }
}
