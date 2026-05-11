import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';

export function RegisterPage() {
  const navigate = useNavigate();
  const [email, set_email] = useState('');
  const [name, set_name] = useState('');
  const [password, set_password] = useState('');
  const [submitting, set_submitting] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      set_error('Password must be at least 8 characters.');
      return;
    }
    set_submitting(true);
    set_error(null);
    try {
      await ApiClient.register(email, name, password);
      navigate('/notes', { replace: true });
    } catch (err) {
      set_error(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      set_submitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Create account</h1>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => set_name(e.target.value)}
            autoComplete="name"
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
            minLength={8}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="auth-alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
