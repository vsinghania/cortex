import { z } from 'zod';

export const VoiceProviderSchema = z.enum(['openai']);
export type VoiceProvider = z.infer<typeof VoiceProviderSchema>;

export type MintTokenRequest = {
  user_id: string;
};

export const MintTokenResponseSchema = z.object({
  session_id: z.string().min(1),
  client_secret: z.string().min(1),
  expires_at: z.number().int().positive(),
  model: z.string().min(1),
  provider: VoiceProviderSchema,
});

export type MintTokenResponse = z.infer<typeof MintTokenResponseSchema>;
