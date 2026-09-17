import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import type { GoogleOAuthAdapterInterface } from './google_oauth_adapter_interface.js';
import type { GoogleIdentity, GoogleOAuthConfig } from '../types/google_auth.types.js';
import { UnauthorizedError } from '../../common/errors.js';

const SCOPES = ['openid', 'email', 'profile'];

const IdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().default(false),
  name: z.string().optional()
});

export class GoogleOAuthAdapter implements GoogleOAuthAdapterInterface {
  private constructor(
    private readonly client: OAuth2Client,
    private readonly client_id: string
  ) {}

  static create(config: GoogleOAuthConfig): GoogleOAuthAdapter {
    const client = new OAuth2Client({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      redirectUri: config.redirect_uri
    });
    return new GoogleOAuthAdapter(client, config.client_id);
  }

  buildAuthorizationUrl(params: { state: string; code_challenge: string }): string {
    return this.client.generateAuthUrl({
      scope: SCOPES,
      state: params.state,
      code_challenge: params.code_challenge,
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account'
    });
  }

  async exchangeCode(params: { code: string; code_verifier: string }): Promise<GoogleIdentity> {
    const { tokens } = await this.client.getToken({ code: params.code, codeVerifier: params.code_verifier });
    if (!tokens.id_token) {
      throw new UnauthorizedError('Google did not return an ID token');
    }

    const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.client_id });
    const parsed = IdTokenClaimsSchema.safeParse(ticket.getPayload());
    if (!parsed.success) {
      throw new UnauthorizedError('Google ID token is missing required claims');
    }
    return parsed.data;
  }
}
