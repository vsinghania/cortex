import { logger } from '../../common/logger.js';
import {
  OpenAiSessionResponse,
  OpenAiSessionResponseSchema,
  RealtimeSessionConfig,
} from '../types/voice.types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const SESSIONS_PATH = '/v1/realtime/sessions';
const REQUEST_TIMEOUT_MS = 10000;

export class OpenAiRealtimeClient {

  private readonly api_key: string;
  private readonly base_url: string;

  private constructor(api_key: string, base_url: string) {
    this.api_key = api_key;
    this.base_url = base_url;
  }

  public static create(): OpenAiRealtimeClient {
    const api_key = process.env.OPENAI_API_KEY;
    if (!api_key) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    const base_url = process.env.OPENAI_API_BASE_URL ?? DEFAULT_BASE_URL;
    return new OpenAiRealtimeClient(api_key, base_url);
  }

  public async createSession(config: RealtimeSessionConfig): Promise<OpenAiSessionResponse> {
    const url = `${this.base_url}${SESSIONS_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.api_key}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: JSON.stringify(config),
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
      return OpenAiSessionResponseSchema.parse(json);
    } finally {
      clearTimeout(timer);
    }
  }
}
