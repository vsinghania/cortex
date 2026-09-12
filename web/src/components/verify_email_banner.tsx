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
          ? 'Too many requests. Wait a few minutes and try again.'
          : 'Could not send the email. Try again in a moment.',
      );
      set_state('error');
    }
  }

  return (
    <div className="verify-banner" role="status">
      <p className="verify-banner-text">
        {state === 'sent'
          ? `Verification email sent to ${user.email}. Check your inbox.`
          : 'Verify your email address so we can reach you about your account.'}
        {error && <span className="verify-banner-error"> {error}</span>}
      </p>
      {state !== 'sent' && (
        <button type="button" className="ghost small" onClick={handleResend} disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Resend email'}
        </button>
      )}
    </div>
  );
}
