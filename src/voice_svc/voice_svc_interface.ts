import { MintTokenRequest, MintTokenResponse } from './types/voice.types.js';

export interface VoiceSvcInterface {
  mintEphemeralVoiceToken(req: MintTokenRequest): Promise<MintTokenResponse>;
}
