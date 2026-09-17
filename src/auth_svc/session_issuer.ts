import type { AuthContext, AuthResult, PublicUser } from './types/auth.types.js';
import type { User } from '../user/types/user.types.js';
import type { RefreshTokenRepository } from './repositories/refresh_token_repository_interface.js';
import { MongooseRefreshTokenRepository } from './repositories/refresh_token_repository.js';
import { TokenUtils } from './utils/token_utils.js';
import { DbNameResolver } from '../db/mongo/db_name_resolver.js';

/** Starts a signed-in session for a user, whichever way they proved who they are. */
export class SessionIssuer {
  private constructor(private readonly rt_repo: RefreshTokenRepository) {}

  static async create(rt_repo?: RefreshTokenRepository): Promise<SessionIssuer> {
    return new SessionIssuer(
      rt_repo ?? (await MongooseRefreshTokenRepository.create({ db: DbNameResolver.resolve('auth') }))
    );
  }

  static toPublicUser(user: User): PublicUser {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, google_sub, ...rest } = user;
    return rest;
  }

  async issue(user: User, ctx?: AuthContext): Promise<AuthResult> {
    const { token: access_token } = TokenUtils.signAccessToken({ user_id: user.user_id, roles: user.roles });
    const { token: refresh_token, token_hash, expires_at } = TokenUtils.issueRefreshToken();
    await this.rt_repo.createSession({
      user_id: user.user_id,
      token_hash,
      user_agent: ctx?.user_agent ?? null,
      ip: ctx?.ip ?? null,
      expires_at
    });

    return {
      user: SessionIssuer.toPublicUser(user),
      tokens: {
        access_token,
        refresh_token,
        access_token_expires_in_sec: TokenUtils.accessTokenTtlSec(),
        refresh_token_expires_in_sec: TokenUtils.refreshTokenTtlSec()
      }
    };
  }
}
