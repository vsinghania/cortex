import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';

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
      <div className="auth-page">
        <div className="auth-form">
          <h1>Check your email</h1>
          <p className="auth-note">
            If an account exists for <strong>{email}</strong>, we've sent it a link to reset the
            password. The link works once and expires soon.
          </p>
          <p className="auth-alt">
            <Link to="/login">Back to log in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Reset your password</h1>
        <p className="auth-note">Enter your account's email and we'll send you a link to choose a new password.</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => set_email(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
        <p className="auth-alt">
          Remembered it? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
