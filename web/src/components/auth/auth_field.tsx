import { useId, useState } from 'react';
import type { ReactNode } from 'react';

type Props = {
  label: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  error?: string;
  hint?: string;
  /** Rendered on the label row, right-aligned (e.g. "Forgot password?"). */
  aside?: ReactNode;
};

export function AuthField({ label, type = 'text', value, onChange, placeholder, autoComplete, autoFocus, error, hint, aside }: Props) {
  const id = useId();
  const [revealed, set_revealed] = useState(false);
  const is_password = type === 'password';
  const describedby = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor={id} className="field-label">{label}</label>
        {aside}
      </div>
      <div className={`field-control${error ? ' field-control-error' : ''}`}>
        <input
          id={id}
          type={is_password && revealed ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          aria-describedby={describedby}
          className={is_password ? 'field-input field-input-password' : 'field-input'}
        />
        {is_password && (
          <button
            type="button"
            className="field-reveal"
            onClick={() => set_revealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="field-error">{error}</p>
      ) : (
        hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>
      )}
    </div>
  );
}
