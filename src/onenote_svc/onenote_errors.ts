/**
 * The grant is gone - revoked by the user, expired, or consented for a different
 * account. Distinct from a transient failure because no amount of retrying fixes
 * it: the connection is parked as needs_reauth and the user is asked to reconnect.
 */
export class OneNoteReauthRequiredError extends Error {
  constructor(message = 'The Microsoft connection needs to be authorized again') {
    super(message);
    this.name = 'OneNoteReauthRequiredError';
  }
}
