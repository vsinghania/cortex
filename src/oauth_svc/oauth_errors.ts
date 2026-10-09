export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'server_error';

/** An error the OAuth endpoints answer with as `{ error, error_description }` (RFC 6749 §5.2). */
export class OAuthProtocolError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    readonly description: string,
    /** invalid_client answers 401; everything else defaults to 400. */
    readonly status: number = code === 'invalid_client' ? 401 : 400
  ) {
    super(description);
    this.name = 'OAuthProtocolError';
  }

  toOAuthErrorResponse(): { error: OAuthErrorCode; error_description: string } {
    return { error: this.code, error_description: this.description };
  }
}
