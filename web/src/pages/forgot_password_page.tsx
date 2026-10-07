import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthLayout } from '../components/auth/auth_layout';
import { AuthField } from '../components/auth/auth_field';
import { SubmitButton } from '../components/auth/submit_button';
import { Icon } from '../components/icon';
import { AppRoutes } from '../lib/app_routes';
import { FormValidation } from '../lib/form_validation';

export function ForgotPasswordPage() {
  const [email, set_email] = useState('');
  const [email_error, set_email_error] = useState<string | undefined>();
  const [form_error, set_form_error] = useState<string | null>(null);
  const [submitting, set_submitting] = useState(false);
  const [sent, set_sent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = FormValidation.emailError(email);
    set_email_error(error ?? undefined);
    set_form_error(null);
    if (error) return;

    set_submitting(true);
    try {
      await ApiClient.forgotPassword(email);
      set_sent(true);
    } catch (err) {
      set_form_error(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      set_submitting(false);
    }
  }

  if (sent) {
    // Worded for both cases on purpose: the API does not reveal whether the account
    // exists, so neither does this page.
    return (
      <AuthLayout>
        <div className="auth-form">
          <span className="status-circle" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <div className="auth-heading">
            <h1>Check your inbox</h1>
            <p>
              If <strong>{email}</strong> has an account, we've sent it a link to reset the password. The link works
              once and expires soon.
            </p>
          </div>
          <Link to={AppRoutes.login()} className="btn btn-outline btn-block btn-lg">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div>
          <Link to={AppRoutes.login()} className="back-link">← Back to sign in</Link>
          <div className="auth-heading">
            <h1>Reset password</h1>
            <p>Enter your email and we'll send a reset link if an account exists.</p>
          </div>
        </div>
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={(value) => {
            set_email(value);
            set_email_error(undefined);
          }}
          placeholder="you@company.com"
          autoComplete="email"
          autoFocus
          error={email_error}
        />
        {form_error && <div className="form-error" role="alert">{form_error}</div>}
        <SubmitButton busy={submitting} label="Send reset link" />
      </form>
    </AuthLayout>
  );
}
