import { TokenUtils } from '../auth_svc/utils/token_utils.js';

/** RFC 7636 §4.1: 43-128 characters from the unreserved set. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url SHA-256 digest is always 43 characters. */
const S256_CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

/** PKCE with S256 only; `plain` is never accepted. */
export class OAuthPkce {
  private constructor() {}

  static isValidCodeChallenge(code_challenge: string): boolean {
    return S256_CHALLENGE_PATTERN.test(code_challenge);
  }

  static verifyCodeVerifier(input: { code_verifier: string; code_challenge: string }): boolean {
    if (!VERIFIER_PATTERN.test(input.code_verifier)) return false;
    return TokenUtils.constantTimeEquals(TokenUtils.sha256Base64Url(input.code_verifier), input.code_challenge);
  }
}
