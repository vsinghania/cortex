import { useVerifyEmailNudge } from '../lib/use_verify_email_nudge';
import { Icon } from './icon';

export function VerifyBanner() {
  const { user, state, error, resend, dismiss } = useVerifyEmailNudge();
  if (!user) return null;

  return (
    <div className="verify-banner" role="status">
      <span className="verify-banner-dot" aria-hidden="true" />
      <p className="verify-banner-text">
        {state === 'sent'
          ? `Confirmation link sent to ${user.email}. Check your inbox.`
          : "Your email address isn't confirmed yet."}
        {error && <span className="verify-banner-error"> {error}</span>}
      </p>
      {state !== 'sent' && (
        <button type="button" className="link-btn" onClick={() => void resend()} disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send me a link'}
        </button>
      )}
      <button type="button" className="icon-btn" onClick={dismiss} aria-label="Dismiss until the next page load" title="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
