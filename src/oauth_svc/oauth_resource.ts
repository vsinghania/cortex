/** RFC 8707 resource indicators: which server a token may be spent at. */
export class OAuthResource {
  private constructor() {}

  /**
   * A client that sends no resource predates RFC 8707 and gets the one resource we
   * have. One that names a different resource is asking for a token meant elsewhere.
   */
  static resolve(requested: URL | undefined, canonical: URL): string | null {
    if (!requested) return OAuthResource.canonicalize(canonical);
    return OAuthResource.canonicalize(requested) === OAuthResource.canonicalize(canonical)
      ? OAuthResource.canonicalize(canonical)
      : null;
  }

  /** Trailing slashes and fragments do not change which resource is meant. */
  static canonicalize(url: URL): string {
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}${url.search}`;
  }
}
