import { z } from 'zod';

export const MintTokenResponseSchema = z.object({
  session_id: z.string().min(1),
  client_secret: z.string().min(1),
  expires_at: z.number().int().positive(),
  model: z.string().min(1),
});

export type MintTokenRequest = {
  user_id: string;
};

export type MintTokenResponse = z.infer<typeof MintTokenResponseSchema>;

export type RealtimeMcpAttachment = {
  type: 'mcp';
  server_label: string;
  server_url: string;
  authorization: string;
  headers: Record<string, string>;
  allowed_tools: string[];
  require_approval: 'never' | 'always';
};

export type RealtimeSessionConfig = {
  model: string;
  voice: string;
  instructions: string;
  tools?: RealtimeMcpAttachment[];
};

export const OpenAiSessionResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  client_secret: z.object({
    value: z.string().min(1),
    expires_at: z.number().int().positive(),
  }),
});

export type OpenAiSessionResponse = z.infer<typeof OpenAiSessionResponseSchema>;
