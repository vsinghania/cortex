import { MintTokenRequest, MintTokenResponse } from './types/voice.types.js';

export interface VoiceSvcInterface {
  mintEphemeralToken(req: MintTokenRequest): Promise<MintTokenResponse>;
}
