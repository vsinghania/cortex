export class BearerToken {
  private constructor() {}

  static parseAuthorizationHeader(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return /^Bearer$/i.test(scheme ?? '') && token ? token : null;
  }
}
