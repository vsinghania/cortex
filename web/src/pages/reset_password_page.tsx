import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthStore } from '../lib/auth_store';
import { AuthLayout } from '../components/auth/auth_layout';
import { AuthField } from '../components/auth/auth_field';
import { SubmitButton } from '../components/auth/submit_button';
import { AppRoutes } from '../lib/app_routes';
import { FormValidation } from '../lib/form_validation';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  // The token arrives in the fragment (#token=...), which never reaches a server.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  const [password, set_password] = useState('');
  const [confirm, set_confirm] = useState('');
  const [errors, set_errors] = useState<Partial<Record<'password' | 'confirm', string>>>({});
  const [form_error, set_form_error] = useState<string | null>(null);
  const [submitting, set_submitting] = useState(false);

  // Once read, take the token out of the address bar and the history entry.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = FormValidation.collect({
      password: FormValidation.passwordError(password),
      confirm: FormValidation.confirmError(password, confirm),
    });
    set_errors(found);
    set_form_error(null);
    if (Object.keys(found).length > 0) return;

    set_submitting(true);
    try {
      await ApiClient.resetPassword(token!, password);
      // The reset revoked every session, so any session in this tab is dead too.
      AuthStore.instance().clear();
      navigate(AppRoutes.login(), {
        replace: true,
        state: { notice: 'Your password was changed. Sign in with the new one.' },
      });
    } catch (err) {
      set_form_error(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      set_submitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="auth-form">
          <div className="auth-heading">
            <h1>Link incomplete</h1>
            <p>This reset link is missing its token. Open the link from the email again, or request a new one.</p>
          </div>
          <Link to={AppRoutes.forgotPassword()} className="btn btn-outline btn-block btn-lg">
            Request a new link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-heading">
          <h1>Choose a new password</h1>
          <p>This signs you out everywhere else.</p>
        </div>
        <AuthField
          label="New password"
          type="password"
          value={password}
          onChange={(value) => {
            set_password(value);
            set_errors((current) => ({ ...current, password: undefined }));
          }}
          placeholder="••••••••"
          autoComplete="new-password"
          autoFocus
          error={errors.password}
          hint={`At least ${FormValidation.MIN_PASSWORD_LENGTH} characters.`}
        />
        <AuthField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(value) => {
            set_confirm(value);
            set_errors((current) => ({ ...current, confirm: undefined }));
          }}
          placeholder="Repeat password"
          autoComplete="new-password"
          error={errors.confirm}
        />
        {form_error && (
          <div className="form-error" role="alert">
            {form_error} <Link to={AppRoutes.forgotPassword()}>Request a new link</Link>
          </div>
        )}
        <SubmitButton busy={submitting} label="Set new password" />
      </form>
    </AuthLayout>
  );
}
