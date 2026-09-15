export class FormValidation {
  static readonly MIN_PASSWORD_LENGTH = 8;
  private static readonly EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  static emailError(email: string): string | null {
    return FormValidation.EMAIL_PATTERN.test(email.trim()) ? null : 'Enter a valid email address.';
  }

  static passwordError(password: string): string | null {
    return password.length >= FormValidation.MIN_PASSWORD_LENGTH
      ? null
      : `Password must be at least ${FormValidation.MIN_PASSWORD_LENGTH} characters.`;
  }

  static confirmError(password: string, confirm: string): string | null {
    return password === confirm ? null : "Passwords don't match.";
  }

  static nameError(name: string): string | null {
    return name.trim().length > 0 ? null : 'Enter your name.';
  }

  /** Drops the fields that passed, so an empty object means the form is valid. */
  static collect<K extends string>(checks: Record<K, string | null>): Partial<Record<K, string>> {
    const errors: Partial<Record<K, string>> = {};
    for (const key of Object.keys(checks) as K[]) {
      const message = checks[key];
      if (message) errors[key] = message;
    }
    return errors;
  }
}
