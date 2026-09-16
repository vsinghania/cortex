import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient } from '../lib/api_client';
import { AuthLayout } from '../components/auth/auth_layout';
import { AuthField } from '../components/auth/auth_field';
import { SubmitButton } from '../components/auth/submit_button';
import { AppRoutes } from '../lib/app_routes';
import { FormValidation } from '../lib/form_validation';

type RegisterErrors = Partial<Record<'name' | 'email' | 'password' | 'confirm', string>>;

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, set_name] = useState('');
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [confirm, set_confirm] = useState('');
  const [errors, set_errors] = useState<RegisterErrors>({});
  const [form_error, set_form_error] = useState<string | null>(null);
  const [submitting, set_submitting] = useState(false);

  // A field's error goes away as soon as the user edits it, not on the next submit.
  function editField(key: keyof RegisterErrors, setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      set_errors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = FormValidation.collect({
      name: FormValidation.nameError(name),
      email: FormValidation.emailError(email),
      password: FormValidation.passwordError(password),
      confirm: FormValidation.confirmError(password, confirm),
    });
    set_errors(found);
    set_form_error(null);
    if (Object.keys(found).length > 0) return;

    set_submitting(true);
    try {
      await ApiClient.register(email, name.trim(), password);
      // The server enqueues a confirmation email on register; the banner says so
      // rather than inviting a resend of the link already on its way.
      navigate(AppRoutes.notes(), { replace: true, state: { verification_sent: true } });
    } catch (err) {
      set_form_error(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      set_submitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div>
          <Link to={AppRoutes.login()} className="back-link">← Back to sign in</Link>
          <div className="auth-heading">
            <h1>Create your account</h1>
            <p>Capture notes you can search, and talk them through with the assistant.</p>
          </div>
        </div>
        <div className="auth-fields">
          <AuthField label="Full name" value={name} onChange={editField('name', set_name)} placeholder="Ada Lovelace" autoComplete="name" autoFocus error={errors.name} />
          <AuthField label="Email" type="email" value={email} onChange={editField('email', set_email)} placeholder="you@company.com" autoComplete="email" error={errors.email} />
          <AuthField
            label="Password"
            type="password"
            value={password}
            onChange={editField('password', set_password)}
            placeholder={`Min. ${FormValidation.MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            error={errors.password}
          />
          <AuthField
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={editField('confirm', set_confirm)}
            placeholder="Repeat password"
            autoComplete="new-password"
            error={errors.confirm}
          />
        </div>
        {form_error && <div className="form-error" role="alert">{form_error}</div>}
        <SubmitButton busy={submitting} label="Create account" />
        <p className="auth-alt">
          Already have an account? <Link to={AppRoutes.login()} className="text-link text-link-strong">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
