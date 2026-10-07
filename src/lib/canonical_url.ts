/**
 * One spelling per URL where URLs are identifiers: OAuth resources (RFC 8707) and
 * issuers, compared as strings. Trailing slashes and fragments do not change which
 * resource or issuer is meant.
 */
export class CanonicalUrl {
  private constructor() {}

  static of(url: URL): string {
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}${url.search}`;
  }

  static parse(raw: string): string | null {
    try {
      return CanonicalUrl.of(new URL(raw));
    } catch {
      return null;
    }
  }
}
