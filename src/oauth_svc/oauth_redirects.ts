const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Schemes that run or read something locally instead of handing the code to an app. */
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);

export class OAuthRedirects {
  private constructor() {}

  /** Web redirects use HTTPS; native apps may use loopback HTTP or a private-use scheme. */
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

  /**
   * Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3):
   * native apps and CLIs bind whatever port the OS hands them.
   */
  static matchesRegisteredRedirectUri(requested: string, registered: readonly string[]): boolean {
    return registered.some((candidate) => candidate === requested || OAuthRedirects.matchesLoopbackRedirectTarget(requested, candidate));
  }

  /**
   * The authorization response back to the client. Always carries `iss` (RFC 9207), so a
   * client talking to several authorization servers can tell which one answered.
   */
  static buildAuthorizationResponseRedirect(input: {
    redirect_uri: string;
    issuer: string;
    state?: string;
    params: Record<string, string>;
  }): string {
    const url = new URL(input.redirect_uri);
    for (const [key, value] of Object.entries(input.params)) url.searchParams.set(key, value);
    if (input.state !== undefined) url.searchParams.set('state', input.state);
    url.searchParams.set('iss', input.issuer);
    return url.toString();
  }

  private static matchesLoopbackRedirectTarget(requested: string, registered: string): boolean {
    let req: URL;
    let reg: URL;
    try {
      req = new URL(requested);
      reg = new URL(registered);
    } catch {
      return false;
    }
    if (!LOOPBACK_HOSTS.has(req.hostname) || !LOOPBACK_HOSTS.has(reg.hostname)) return false;
    return req.protocol === reg.protocol && req.hostname === reg.hostname && req.pathname === reg.pathname && req.search === reg.search;
  }
}
