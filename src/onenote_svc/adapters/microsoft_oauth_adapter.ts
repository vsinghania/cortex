import { ConfidentialClientApplication, CryptoProvider, InteractionRequiredAuthError } from '@azure/msal-node';
import { z } from 'zod';
import { UnauthorizedError } from '../../common/errors.js';
import { OneNoteReauthRequiredError } from '../onenote_errors.js';
import type { MicrosoftOAuthAdapterInterface } from './microsoft_oauth_adapter_interface.js';
import type {
  MicrosoftAccessToken,
  MicrosoftSession,
  OneNoteOAuthConfig
} from '../types/onenote_connection.types.js';

/**
 * `offline_access` buys the refresh token that makes background sync possible;
 * `Notes.Read` is the narrowest OneNote scope and is read-only. MSAL strips
 * offline_access when searching its cache, so passing it explicitly is safe.
 */
const SCOPES = ['offline_access', 'Notes.Read', 'User.Read'];

/** MSAL has already validated the id token; this only guards what we then store. */
const AccountSchema = z.object({
  homeAccountId: z.string().min(1),
  username: z.string().min(1),
  name: z.string().min(1).optional()
});

export class MicrosoftOAuthAdapter implements MicrosoftOAuthAdapterInterface {
  private readonly crypto = new CryptoProvider();

  private constructor(private readonly config: OneNoteOAuthConfig) {}

  static create(config: OneNoteOAuthConfig): MicrosoftOAuthAdapter {
    return new MicrosoftOAuthAdapter(config);
  }

  async buildAuthorizationUrl(params: { state: string }): Promise<{ url: string; code_verifier: string }> {
    const { verifier, challenge } = await this.crypto.generatePkceCodes();

    const url = await this.createClient().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: this.config.redirect_uri,
      state: params.state,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      // Someone with two Microsoft accounts should be able to pick which one syncs.
      prompt: 'select_account'
    });

    return { url, code_verifier: verifier };
  }

  async exchangeAuthorizationCode(params: { code: string; code_verifier: string }): Promise<MicrosoftSession> {
    const client = this.createClient();
    const result = await client.acquireTokenByCode({
      code: params.code,
      codeVerifier: params.code_verifier,
      scopes: SCOPES,
      redirectUri: this.config.redirect_uri
    });

    const account = AccountSchema.safeParse(result.account);
    if (!account.success) {
      throw new UnauthorizedError('Microsoft did not return a usable account');
    }

    return {
      access_token: result.accessToken,
      identity: {
        home_account_id: account.data.homeAccountId,
        email: account.data.username,
        name: account.data.name
      },
      scopes: result.scopes,
      token_cache: client.getTokenCache().serialize()
    };
  }

  /**
   * A fresh client per call, seeded from the stored cache: MSAL's cache lives on the
   * instance, so sharing one across users would mix their tokens together.
   */
  async acquireAccessToken(params: { token_cache: string; home_account_id: string }): Promise<MicrosoftAccessToken> {
    const client = this.createClient();
    const cache = client.getTokenCache();
    cache.deserialize(params.token_cache);

    const account = await cache.getAccountByHomeId(params.home_account_id);
    if (!account) {
      throw new OneNoteReauthRequiredError('The stored Microsoft account is no longer in the token cache');
    }

    try {
      const result = await client.acquireTokenSilent({ account, scopes: SCOPES });
      // Most calls hit a still-valid access token and change nothing, so only a real
      // refresh costs a write.
      return { access_token: result.accessToken, token_cache: cache.hasChanged() ? cache.serialize() : null };
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        throw new OneNoteReauthRequiredError();
      }
      throw err;
    }
  }

  private createClient(): ConfidentialClientApplication {
    return new ConfidentialClientApplication({
      auth: {
        clientId: this.config.client_id,
        clientSecret: this.config.client_secret,
        authority: this.config.authority
      }
    });
  }
}
