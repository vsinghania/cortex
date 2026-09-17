const ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_unavailable: 'Google sign-in is not available right now.',
  google_failed: "We couldn't sign you in with Google. Try again, or use your email and password.",
};

export class GoogleSignIn {
  /** The API sends failed Google sign-ins back to the login page with the reason in the fragment. */
  static takeRedirectError(): string | null {
    const error = new URLSearchParams(window.location.hash.slice(1)).get('error');
    if (!error) return null;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    return ERROR_MESSAGES[error] ?? ERROR_MESSAGES.google_failed;
  }
}
