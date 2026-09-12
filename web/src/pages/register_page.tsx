import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthLayout } from '../components/auth_layout';

const MIN_PASSWORD_LENGTH = 8;

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, set_email] = useState('');
  const [name, set_name] = useState('');
  const [password, set_password] = useState('');
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      set_error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    set_submitting(true);
    set_error(null);
    try {
      await ApiClient.register(email, name, password);
      // The server enqueues a confirmation email on register; tell the banner so it
      // says so, rather than inviting a resend of the link already on its way.
      navigate('/notes', { replace: true, state: { verification_sent: true } });
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      set_submitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-heading">
          <h1>Create your account</h1>
          <p className="auth-subtitle">Capture notes you can search and chat with.</p>
        </div>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => set_name(e.target.value)}
            autoComplete="name"
            autoFocus
            required
          />
        </label>
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
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => set_password(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <span className="field-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="auth-alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
