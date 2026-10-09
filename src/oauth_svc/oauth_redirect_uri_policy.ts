const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Schemes that run or read something locally instead of handing the code to an app. */
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);

/**
 * Which redirect URIs a dynamically registered client may claim. Web apps (ChatGPT,
 * claude.ai) use https; CLIs and desktop apps (Claude Code, Claude Desktop) listen on a
 * loopback port; some editors use a private-use scheme (RFC 8252 §7.1). Plain http to
 * anywhere else would send the authorization code across the network in the clear.
 */
export class OAuthRedirectUriPolicy {
  private constructor() {}

  static isAllowedRedirectUri(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
    return !FORBIDDEN_SCHEMES.has(url.protocol);
  }
}
