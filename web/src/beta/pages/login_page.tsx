import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiClient } from '../../lib/api_client';
import { AuthLayout } from '../components/auth/auth_layout';
import { AuthField } from '../components/auth/auth_field';
import { SubmitButton } from '../components/auth/submit_button';
import { BetaRoutes } from '../lib/beta_routes';
import { FormValidation } from '../lib/form_validation';

type LocationState = { from?: string; notice?: string } | null;
type LoginErrors = Partial<Record<'email' | 'password', string>>;

export function BetaLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [errors, set_errors] = useState<LoginErrors>({});
  const [form_error, set_form_error] = useState<string | null>(null);
  const [submitting, set_submitting] = useState(false);

  // A field's error goes away as soon as the user edits it, not on the next submit.
  function editField(key: keyof LoginErrors, setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      set_errors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = FormValidation.collect({
      email: FormValidation.emailError(email),
      password: password ? null : 'Enter your password.',
    });
    set_errors(found);
    set_form_error(null);
    if (Object.keys(found).length > 0) return;

    set_submitting(true);
    try {
      await ApiClient.login(email, password);
      const redirect_to = state?.from && BetaRoutes.isBetaPath(state.from) && state.from !== BetaRoutes.login()
        ? state.from
        : BetaRoutes.notes();
      navigate(redirect_to, { replace: true });
    } catch (err) {
      set_form_error(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      set_submitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-heading">
          <h1>Welcome back</h1>
          <p>Sign in to your Cortex workspace</p>
        </div>
        {state?.notice && <div className="form-notice" role="status">{state.notice}</div>}
        <div className="auth-fields">
          <AuthField
            label="Email"
            type="email"
            value={email}
            onChange={editField('email', set_email)}
            placeholder="you@company.com"
            autoComplete="email"
            autoFocus
            error={errors.email}
          />
          <AuthField
            label="Password"
            type="password"
            value={password}
            onChange={editField('password', set_password)}
            placeholder="••••••••"
            autoComplete="current-password"
            error={errors.password}
            aside={<Link to={BetaRoutes.forgotPassword()} className="text-link">Forgot password?</Link>}
          />
        </div>
        {form_error && <div className="form-error" role="alert">{form_error}</div>}
        <SubmitButton busy={submitting} label="Sign in" />
        <p className="auth-alt">
          Don't have an account? <Link to={BetaRoutes.register()} className="text-link text-link-strong">Join now</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
