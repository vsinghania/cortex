import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthLayout } from '../components/auth_layout';
import { useAuth } from '../lib/use_auth';

type Status = 'verifying' | 'verified' | 'failed';

export function VerifyEmailPage() {
  const { is_authenticated } = useAuth();
  // The token arrives in the fragment (#token=...), which never reaches a server.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  const [status, set_status] = useState<Status>('verifying');
  const [error, set_error] = useState<string | null>(null);

  // Once read, take the token out of the address bar and the history entry.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;

    async function verify() {
      try {
        await ApiClient.verifyEmail(token!);
        if (!active) return;
        set_status('verified');
        // The banner reads email_verified_at off the stored user, so refresh it.
        if (is_authenticated) {
          await ApiClient.refreshUser();
        }
      } catch (err) {
        if (!active) return;
        set_error(err instanceof Error ? err.message : 'Could not verify this email address.');
        set_status('failed');
      }
    }

    void verify();
    return () => {
      active = false;
    };
    // Runs once: the token never changes, and re-posting a consumed token would fail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <AuthLayout>
        <div className="auth-form">
          <div className="auth-heading">
            <h1>Link incomplete</h1>
          </div>
          <p className="auth-note">
            This link is missing its token. Open the link from the email again, or log in and send yourself a
            new one.
          </p>
          <p className="auth-alt">
            <Link to="/login">Go to login</Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="auth-form">
        <div className="auth-heading">
          <h1>
            {status === 'verifying' && 'Confirming your address…'}
            {status === 'verified' && 'Email confirmed'}
            {status === 'failed' && "That link didn't work"}
          </h1>
        </div>

        {status === 'verifying' && <p className="auth-note">One moment while we check your link.</p>}

        {status === 'verified' && (
          <>
            <p className="auth-note">Your email address is confirmed.</p>
            <p className="auth-alt">
              {is_authenticated ? <Link to="/notes">Back to your notes</Link> : <Link to="/login">Log in</Link>}
            </p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="form-error" role="alert">
              {error}
            </div>
            <p className="auth-alt">
              {is_authenticated ? (
                <Link to="/notes">Back to your notes</Link>
              ) : (
                <Link to="/login">Log in to request a new link</Link>
              )}
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
