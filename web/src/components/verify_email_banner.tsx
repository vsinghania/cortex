import { useState } from 'react';
import { ApiClient, ApiError } from '../lib/api_client';
import { useAuth } from '../lib/use_auth';

type SendState = 'idle' | 'sending' | 'sent' | 'error';

export function VerifyEmailBanner() {
  const { user } = useAuth();
  const [state, set_state] = useState<SendState>('idle');
  const [error, set_error] = useState<string | null>(null);

  // Logged out, or already verified: nothing to nudge about.
  if (!user || user.email_verified_at) return null;

  async function handleResend() {
    set_state('sending');
    set_error(null);
    try {
      await ApiClient.resendVerification();
      set_state('sent');
    } catch (err) {
      set_error(
        err instanceof ApiError && err.status === 429
          ? 'That is a few too many requests in a row — give it a couple of minutes, then try again.'
          : 'The email could not go out just now. Try again in a moment.',
      );
      set_state('error');
    }
  }

  return (
    <div className="verify-banner" role="status">
      <p className="verify-banner-text">
        {state === 'sent'
          ? `A confirmation link is on its way to ${user.email}. It can take a minute to land — check your spam folder if it doesn't.`
          : "Your email address isn't confirmed yet — it's where a password reset link would go if you ever lose your way in."}
        {error && <span className="verify-banner-error"> {error}</span>}
      </p>
      {state !== 'sent' && (
        <button type="button" className="ghost small" onClick={handleResend} disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send me a link'}
        </button>
      )}
    </div>
  );
}
