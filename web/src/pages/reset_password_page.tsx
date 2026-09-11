import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthStore } from '../lib/auth_store';

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  // The token arrives in the fragment (#token=...), which never reaches a server.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  const [password, set_password] = useState('');
  const [confirm, set_confirm] = useState('');
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  // Once read, take the token out of the address bar and the history entry.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      set_error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      set_error("Passwords don't match.");
      return;
    }
    set_submitting(true);
    set_error(null);
    try {
      await ApiClient.resetPassword(token!, password);
      // The reset revoked every session, so any session in this tab is dead too.
      AuthStore.instance().clear();
      navigate('/login', {
        replace: true,
        state: { notice: 'Your password was changed. Log in with the new one.' },
      });
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      set_submitting(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-form">
          <h1>Link incomplete</h1>
          <p className="auth-note">
            This reset link is missing its token. Open the link from the email again, or request a new one.
          </p>
          <p className="auth-alt">
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Choose a new password</h1>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => set_password(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirm}
            onChange={(e) => set_confirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        {error && (
          <div className="form-error">
            {error} <Link to="/forgot-password">Request a new link</Link>
          </div>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}
