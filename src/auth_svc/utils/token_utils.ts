import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import type { JwtClaims, IssueTokenParams } from '../types/auth.types.js';

const ACCESS_TTL_SEC = Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 900); // 15m default
const REFRESH_TTL_SEC = Number(process.env.REFRESH_TOKEN_TTL_SEC ?? 7 * 24 * 60 * 60); // 7d default
/* project: cortex */
// const ISSUER = process.env.JWT_ISSUER ?? "cortex.com";
/* project: cortex */
// const AUDIENCE = process.env.JWT_AUDIENCE ?? "cortex";

export const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME ?? 'rt';

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('missing_env:JWT_ACCESS_SECRET');
  }
  return secret;
}

// RFC7519 numeric date (seconds since epoch)
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Base64url without padding
function base64url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function sha256Base64Url(input: string): string {
  const hash = createHash('sha256').update(input, 'utf8').digest();
  return base64url(hash);
}

export function generateOpaqueToken(bytes = 48): string {
  // 48 bytes -> 64 char base64url string approx
  return base64url(randomBytes(bytes));
}

export function accessTokenTtlSec(): number {
  return ACCESS_TTL_SEC;
}

export function refreshTokenTtlSec(): number {
  return REFRESH_TTL_SEC;
}

export function signAccessToken(params: IssueTokenParams): { token: string; claims: JwtClaims } {
  const iat = nowSeconds();
  const exp = iat + ACCESS_TTL_SEC;

  const claims: JwtClaims = {
    sub: params.user_id,
    roles: params.roles,
    iat,
    exp,
    // ...(ISSUER ? { iss: ISSUER } : {}),
    // ...(AUDIENCE ? { aud: AUDIENCE } : {})
  };

  const token = jwt.sign(claims, getAccessSecret(), {
    algorithm: 'HS256',
    // issuer: ISSUER,
    // audience: AUDIENCE
  });

  return { token, claims };
}

export function verifyAccessToken(token: string): JwtClaims | null {
  try {
    const decoded = jwt.verify(token, getAccessSecret(), {
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
export function issueRefreshToken(): { token: string; token_hash: string; expires_at: Date } {
  const token = generateOpaqueToken();
  const token_hash = sha256Base64Url(token);
  const expires_at = new Date(Date.now() + refreshTokenTtlSec() * 1000);
  return { token, token_hash, expires_at };
}
