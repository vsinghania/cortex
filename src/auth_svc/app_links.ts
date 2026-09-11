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

  private build(path: string, fragment: Record<string, string>): string {
    const url = new URL(path, this.base_url);
    url.hash = new URLSearchParams(fragment).toString();
    return url.toString();
  }
}
