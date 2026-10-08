const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OAuthRedirects {
  private constructor() {}

  /**
   * Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3):
   * native apps and CLIs bind whatever port the OS hands them.
   */
  static matchesRegistered(requested: string, registered: readonly string[]): boolean {
    return registered.some((candidate) => candidate === requested || OAuthRedirects.sameLoopbackTarget(requested, candidate));
  }

  /**
   * The authorization response back to the client. Always carries `iss` (RFC 9207), so a
   * client talking to several authorization servers can tell which one answered.
   */
  static authorizationResponse(input: {
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

  private static sameLoopbackTarget(requested: string, registered: string): boolean {
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
