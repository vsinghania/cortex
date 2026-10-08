import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient, ApiError } from '../../lib/api_client';
import { AppRoutes } from '../../lib/app_routes';
import { Icon } from '../icon';

type SendState = 'idle' | 'sending' | 'sent' | 'error';

type CheckInboxProps = {
  email: string;
  heading: string;
  /** Whether a link has just gone out, which the wording then acknowledges. */
  just_sent: boolean;
  /** Where sign-in should land afterwards, such as a consent page the user started from. */
  return_to?: string | null;
  onBackToSignIn?: () => void;
};

/** Shown while a new account waits on its confirmation link; sign-in stays closed until then. */
export function CheckInbox({ email, heading, just_sent, return_to, onBackToSignIn }: CheckInboxProps) {
  const [state, set_state] = useState<SendState>(just_sent ? 'sent' : 'idle');
  const [error, set_error] = useState<string | null>(null);

  async function resend() {
    set_state('sending');
    set_error(null);
    try {
      await ApiClient.requestVerification(email);
      set_state('sent');
    } catch (err) {
      set_error(
        err instanceof ApiError && err.status === 429
          ? 'Too many requests. Try again in a few minutes.'
          : "Couldn't send the email. Try again in a moment.",
      );
      set_state('error');
    }
  }

  return (
    <div className="auth-form">
      <span className="status-circle" aria-hidden="true">
        <Icon name="check" size={22} />
      </span>
      <div className="auth-heading">
        <h1>{heading}</h1>
        <p>
          {state === 'sent' ? 'We sent a confirmation link to ' : 'Confirm your address with the link we sent to '}
          <strong>{email}</strong>. Open it to finish setting up your account, then sign in.
        </p>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button
        type="button"
        className="btn btn-outline btn-block btn-lg"
        onClick={() => void resend()}
        disabled={state === 'sending'}
        aria-busy={state === 'sending'}
      >
        {state === 'sending' ? 'Sending…' : 'Send the link again'}
      </button>
      <p className="auth-alt">
        Already confirmed?{' '}
        <Link
          to={AppRoutes.login()}
          state={return_to ? { from: return_to } : null}
          onClick={onBackToSignIn}
          className="text-link text-link-strong"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
