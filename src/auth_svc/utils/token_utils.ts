import jwt from 'jsonwebtoken';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import type { JwtClaims, IssueTokenParams } from '../types/auth.types.js';
import { Time } from '../../lib/time.js';

const ACCESS_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC ?? Time.minutesToSec(15));
const REFRESH_TTL_SEC = Number(process.env.REFRESH_TOKEN_TTL_SEC ?? Time.daysToSec(7));
/* project: cortex */
// const ISSUER = process.env.JWT_ISSUER ?? "cortex.com";
/* project: cortex */
// const AUDIENCE = process.env.JWT_AUDIENCE ?? "cortex";

export const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME ?? 'rt';

export class TokenUtils {
  private constructor() {}

  private static getAccessSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new Error('missing_env:JWT_ACCESS_SECRET');
    }
    return secret;
  }

  // RFC7519 numeric date (seconds since epoch)
  private static nowSeconds(): number {
    return Time.msToSec(Date.now());
  }

  // Base64url without padding
  private static base64url(input: Buffer): string {
    return input
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  public static sha256Base64Url(input: string): string {
    const hash = createHash('sha256').update(input, 'utf8').digest();
    return TokenUtils.base64url(hash);
  }

  public static constantTimeEquals(a: string, b: string): boolean {
    const a_buf = Buffer.from(a, 'utf8');
    const b_buf = Buffer.from(b, 'utf8');
    return a_buf.length === b_buf.length && timingSafeEqual(a_buf, b_buf);
  }

  public static generateOpaqueToken(bytes = 48): string {
    // 48 bytes -> 64 char base64url string approx
    return TokenUtils.base64url(randomBytes(bytes));
  }

  public static accessTokenTtlSec(): number {
    return ACCESS_TTL_SEC;
  }

  public static refreshTokenTtlSec(): number {
    return REFRESH_TTL_SEC;
  }

  public static signAccessToken(params: IssueTokenParams): { token: string; claims: JwtClaims } {
    const iat = TokenUtils.nowSeconds();
    const exp = iat + ACCESS_TTL_SEC;

    const claims: JwtClaims = {
      sub: params.user_id,
      roles: params.roles,
      iat,
      exp,
      // ...(ISSUER ? { iss: ISSUER } : {}),
      // ...(AUDIENCE ? { aud: AUDIENCE } : {})
    };

    const token = jwt.sign(claims, TokenUtils.getAccessSecret(), {
      algorithm: 'HS256',
      // issuer: ISSUER,
      // audience: AUDIENCE
    });

    return { token, claims };
  }

  public static verifyAccessToken(token: string): JwtClaims | null {
    try {
      const decoded = jwt.verify(token, TokenUtils.getAccessSecret(), {
        algorithms: ['HS256'],
        // issuer: ISSUER,
        // audience: AUDIENCE
      }) as JwtClaims;
      return decoded;
    } catch {
      return null;
    }
  }

  // Helpers for refresh tokens (opaque string, store only hash = sha256Base64Url)
  // - controller stores opaque in HttpOnly cookie
  // - DB stores only hash for lookup and revocation
  public static issueRefreshToken(): { token: string; token_hash: string; expires_at: Date } {
    const token = TokenUtils.generateOpaqueToken();
    const token_hash = TokenUtils.sha256Base64Url(token);
    const expires_at = new Date(Date.now() + Time.secondsToMs(TokenUtils.refreshTokenTtlSec()));
    return { token, token_hash, expires_at };
  }
}
