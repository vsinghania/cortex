import { z } from 'zod';

const BaseUrlSchema = z.string().url();

/** Links into the SPA that are handed out beyond it, in emails. */
export class AppLinks {
  private constructor(private readonly base_url: string) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AppLinks {
    const parsed = BaseUrlSchema.safeParse(env.APP_PUBLIC_URL);
    if (!parsed.success) {
      throw new Error('APP_PUBLIC_URL must be set to the SPA origin, e.g. https://cortexapp.me');
    }
    return new AppLinks(parsed.data);
  }

  /**
   * The token rides in the fragment, which browsers never send to a server - so it
   * stays out of CDN and load-balancer logs, and out of Referer headers.
   */
  passwordReset(token: string): string {
    return this.build('/reset-password', { token });
  }

  verifyEmail(token: string): string {
    return this.build('/verify-email', { token });
  }

  /** `path` must already be a sanitized same-origin path. */
  appPath(path: string): string {
    return new URL(path, this.base_url).toString();
  }

  loginError(error: string): string {
    return this.build('/login', { error });
  }

  /**
   * Where an integration's OAuth callback lands. The outcome rides in the fragment
   * for the same reason tokens do: it never reaches a server log.
   */
  settings(fragment: Record<string, string> = {}): string {
    return Object.keys(fragment).length > 0 ? this.build('/settings', fragment) : this.appPath('/settings');
  }

  private build(path: string, fragment: Record<string, string>): string {
    const url = new URL(path, this.base_url);
    url.hash = new URLSearchParams(fragment).toString();
    return url.toString();
  }
}
