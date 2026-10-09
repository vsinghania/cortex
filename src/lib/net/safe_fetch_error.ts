export class SafeFetchError extends Error {
  constructor(
    readonly reason:
      | 'invalid_url'
      | 'not_https'
      | 'port_not_allowed'
      | 'credentials_in_url'
      | 'unresolvable'
      | 'blocked_address'
      | 'redirect_not_allowed'
      | 'bad_status'
      | 'not_json'
      | 'too_large'
      | 'timeout'
      | 'network',
    message: string
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}
