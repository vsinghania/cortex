export type VoiceProvider = 'openai';

export type MintTokenResponse = {
  session_id: string;
  client_secret: string;
  expires_at: number;
  model: string;
  provider: VoiceProvider;
};

export type VoiceSessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'closed'
  | 'error';

export type VoiceTranscriptEvent = {
  role: 'user' | 'assistant';
  text: string;
  is_final: boolean;
};
