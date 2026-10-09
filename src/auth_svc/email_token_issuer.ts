import type { EmailTokenPurpose } from './types/email_token.types.js';
import type { EmailTokenRepository } from './repositories/email_token_repository_interface.js';
import { MongooseEmailTokenRepository } from './repositories/mongoose_email_token_repository.js';
import { TokenUtils } from './utils/token_utils.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';
import { Time } from '../lib/time.js';

const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  password_reset: Time.minutesToMs(30),
  // Longer than a reset link: verification is not urgent, and the mail may sit
  // unread for a while before anyone acts on it.
  email_verification: Time.hoursToMs(24)
};

/**
 * Single-use tokens that prove control of an email address. Only the hash is
 * stored, the same way refresh tokens are, so a database leak yields no usable links.
 */
export class EmailTokenIssuer {
  private constructor(private readonly repo: EmailTokenRepository) {}

  static async create(params?: { repo?: EmailTokenRepository }): Promise<EmailTokenIssuer> {
    const repo = params?.repo ?? (await MongooseEmailTokenRepository.create({ db: DbNameResolver.resolve('auth') }));
    return new EmailTokenIssuer(repo);
  }

  static getTokenTtlMs(purpose: EmailTokenPurpose): number {
    return TOKEN_TTL_MS[purpose];
  }

  /** Replaces any earlier token for the same user and purpose. */
  async issueEmailToken(params: { user_id: string; purpose: EmailTokenPurpose; now?: Date }): Promise<{ token: string; expires_at: Date }> {
    const now = params.now ?? new Date();
    const token = TokenUtils.generateOpaqueToken();
    const expires_at = new Date(now.getTime() + EmailTokenIssuer.getTokenTtlMs(params.purpose));

    await this.repo.replaceEmailTokenForUser({
      user_id: params.user_id,
      purpose: params.purpose,
      token_hash: TokenUtils.sha256Base64Url(token),
      expires_at
    });
    return { token, expires_at };
  }

  /** The owning user_id if the token is valid for this purpose; it cannot be used again. */
  async consumeEmailToken(params: { token: string; purpose: EmailTokenPurpose; now?: Date }): Promise<string | null> {
    const consumed = await this.repo.consumeEmailToken({
      token_hash: TokenUtils.sha256Base64Url(params.token),
      purpose: params.purpose,
      now: params.now ?? new Date()
    });
    return consumed?.user_id ?? null;
  }
}
