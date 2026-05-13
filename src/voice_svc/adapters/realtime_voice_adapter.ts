import { VoiceProvider } from '../types/voice.types.js';

export type McpAttachmentSpec = {
  server_label: string;
  server_url: string;
  bearer_token: string;
  headers: Record<string, string>;
  allowed_tools: string[];
  require_approval: 'never' | 'always';
};

export type AdapterMintRequest = {
  user_id: string;
  instructions: string;
  mcp_attachment?: McpAttachmentSpec;
};

export type AdapterMintResponse = {
  session_id: string;
  client_secret: string;
  expires_at: number;
  model: string;
};

export interface RealtimeVoiceAdapter {
  getProvider(): VoiceProvider;
  mintEphemeralSession(req: AdapterMintRequest): Promise<AdapterMintResponse>;
}
