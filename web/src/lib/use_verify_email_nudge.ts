import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiClient, ApiError } from './api_client';
import { useAuth } from './use_auth';
import type { User } from './auth.types';

export type VerifyNudgeSendState = 'idle' | 'sending' | 'sent' | 'error';
type BannerLocationState = { verification_sent?: boolean } | null;

export type VerifyEmailNudge = {
  /** Null when there is nothing to nudge about: logged out, verified, or dismissed. */
  user: User | null;
  state: VerifyNudgeSendState;
  error: string | null;
  resend: () => Promise<void>;
  dismiss: () => void;
};

/** Drives the verify-email banner's resend and dismiss rules. */
export function useVerifyEmailNudge(): VerifyEmailNudge {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, set_state] = useState<VerifyNudgeSendState>('idle');
  const [error, set_error] = useState<string | null>(null);
  // Deliberately not persisted: dismissing quiets the nudge for this visit, and a
  // reload brings it back until the address is actually confirmed.
  const [dismissed, set_dismissed] = useState(false);

  // Registration hands this over on its way to the notes page. It cannot be read in a
  // useState initializer: the banner can already be mounted, back on the register
  // page, before the flag existed. Consumed once, so a reload does not replay "we
  // just sent it" days later.
  useEffect(() => {
    if ((location.state as BannerLocationState)?.verification_sent) {
      set_state('sent');
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
    }
  }, [location, navigate]);

  async function resend() {
    set_state('sending');
    set_error(null);
    try {
      await ApiClient.resendVerification();
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

  const show = !!user && !user.email_verified_at && !dismissed;
  return { user: show ? user : null, state, error, resend, dismiss: () => set_dismissed(true) };
}
