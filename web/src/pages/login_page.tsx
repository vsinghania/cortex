import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';

type LocationState = { from?: string; notice?: string } | null;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const notice = (location.state as LocationState)?.notice;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    set_submitting(true);
    set_error(null);
    try {
      await ApiClient.login(email, password);
      const state = location.state as LocationState;
      const redirect_to = state?.from && state.from !== '/login' ? state.from : '/notes';
      navigate(redirect_to, { replace: true });
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      set_submitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Log in</h1>
        {notice && <div className="form-notice">{notice}</div>}
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
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        <p className="auth-alt">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p className="auth-alt">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}
