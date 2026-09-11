import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthLayout } from '../components/auth_layout';

export function ForgotPasswordPage() {
  const [email, set_email] = useState('');
  const [submitting, set_submitting] = useState(false);
  const [sent, set_sent] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    set_submitting(true);
    set_error(null);
    try {
      await ApiClient.forgotPassword(email);
      set_sent(true);
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      set_submitting(false);
    }
  }

  if (sent) {
    // Worded for both cases on purpose: the API does not reveal whether the
    // account exists, so neither does this page.
    return (
      <AuthLayout>
        <div className="auth-form">
          <div className="auth-heading">
            <h1>Check your email</h1>
          </div>
          <p className="auth-note">
            If an account exists for <strong>{email}</strong>, we've sent it a link to reset the
            password. The link works once and expires soon.
          </p>
          <p className="auth-alt">
            <Link to="/login">Back to log in</Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-heading">
          <h1>Reset your password</h1>
          <p className="auth-subtitle">
            Enter your account's email and we'll send you a link to choose a new password.
          </p>
        </div>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => set_email(e.target.value)}
            autoComplete="email"
            autoFocus
            required
          />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
        <p className="auth-alt">
          Remembered it? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
