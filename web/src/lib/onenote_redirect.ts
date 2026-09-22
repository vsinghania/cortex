const ERROR_MESSAGES: Record<string, string> = {
  onenote_cancelled: 'Connecting OneNote was cancelled.',
  onenote_failed: "We couldn't connect your Microsoft account. Try again.",
};

export type OneNoteRedirectOutcome = {
  connected: boolean;
  error: string | null;
};

export class OneNoteRedirect {
  /**
   * The API sends the callback back to this page with the outcome in the fragment,
   * which browsers never send to a server. Reading it clears it, so a reload does
   * not show the same banner again.
   */
  static take(): OneNoteRedirectOutcome {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const error = params.get('error');
    const connected = params.get('connected') === 'onenote';

    if (!error && !connected) return { connected: false, error: null };

    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    return { connected, error: error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.onenote_failed) : null };
  }
}
