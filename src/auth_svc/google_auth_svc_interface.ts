import type { AuthContext } from './types/auth.types.js';
import type {
  CompleteGoogleAuthorizationInput,
  GoogleAuthorization,
  GoogleAuthResult
} from './types/google_auth.types.js';

export interface GoogleAuthSvcInterface {
  startAuthorization(return_to?: string): GoogleAuthorization;
  completeAuthorization(input: CompleteGoogleAuthorizationInput, ctx?: AuthContext): Promise<GoogleAuthResult>;
}
