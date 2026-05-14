import { z } from 'zod';
import { logger } from '../../common/logger.js';
import { VoiceProvider } from '../types/voice.types.js';
import {
  AdapterMintRequest,
  AdapterMintResponse,
  McpAttachmentSpec,
  RealtimeVoiceAdapter,
} from './realtime_voice_adapter.js';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const CLIENT_SECRETS_PATH = '/v1/realtime/client_secrets';
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_MODEL = 'gpt-realtime';
const DEFAULT_VOICE = 'alloy';
const PROVIDER: VoiceProvider = 'openai';

const OpenAiClientSecretResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number().int().positive(),
  session: z.object({
    id: z.string().min(1),
    model: z.string().min(1),
  }),
});

type OpenAiMcpAttachment = {
  type: 'mcp';
  server_label: string;
  server_url: string;
  headers: Record<string, string>;
  require_approval: 'never' | 'always';
};

type OpenAiSessionShape = {
  type: 'realtime';
  model: string;
  audio: { output: { voice: string } };
  instructions: string;
  tools?: OpenAiMcpAttachment[];
};

type OpenAiClientSecretsRequest = {
  session: OpenAiSessionShape;
};

export class OpenAiRealtimeAdapter implements RealtimeVoiceAdapter {

  private readonly api_key: string;
  private readonly base_url: string;
  private readonly model: string;
  private readonly voice: string;

  private constructor(opts: { api_key: string; base_url: string; model: string; voice: string }) {
    this.api_key = opts.api_key;
    this.base_url = opts.base_url;
    this.model = opts.model;
    this.voice = opts.voice;
  }

  public static create(): OpenAiRealtimeAdapter {
    const api_key = process.env.OPENAI_API_KEY;
    if (!api_key) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    return new OpenAiRealtimeAdapter({
      api_key,
      base_url: process.env.OPENAI_API_BASE_URL ?? DEFAULT_BASE_URL,
      model: process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_MODEL,
      voice: process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_VOICE,
    });
  }

  public getProvider(): VoiceProvider {
    return PROVIDER;
  }

  public async mintEphemeralSession(req: AdapterMintRequest): Promise<AdapterMintResponse> {
    const body = this.buildClientSecretsRequest(req);
    const result = await this.postClientSecrets(body);
    return {
      session_id: result.session.id,
      client_secret: result.value,
      expires_at: result.expires_at,
      model: result.session.model,
    };
  }

  private buildClientSecretsRequest(req: AdapterMintRequest): OpenAiClientSecretsRequest {
    const session: OpenAiSessionShape = {
      type: 'realtime',
      model: this.model,
      audio: { output: { voice: this.voice } },
      instructions: req.instructions,
    };
    if (req.mcp_attachment) {
      session.tools = [OpenAiRealtimeAdapter.toOpenAiMcpAttachment(req.mcp_attachment)];
    }
    return { session };
  }

  private static toOpenAiMcpAttachment(spec: McpAttachmentSpec): OpenAiMcpAttachment {
    return {
      type: 'mcp',
      server_label: spec.server_label,
      server_url: spec.server_url,
      headers: {
        Authorization: `Bearer ${spec.bearer_token}`,
        ...spec.headers,
      },
      require_approval: spec.require_approval,
    };
  }

  private async postClientSecrets(
    body: OpenAiClientSecretsRequest
  ): Promise<z.infer<typeof OpenAiClientSecretResponseSchema>> {
    const url = `${this.base_url}${CLIENT_SECRETS_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        logger.warn(
          { status: resp.status, body_excerpt: text.slice(0, 500) },
          'OpenAI realtime session mint failed'
        );
        throw new Error(`OpenAI realtime session mint failed: HTTP ${resp.status}`);
      }
      const json = JSON.parse(text) as unknown;
      return OpenAiClientSecretResponseSchema.parse(json);
    } finally {
      clearTimeout(timer);
    }
  }
}
