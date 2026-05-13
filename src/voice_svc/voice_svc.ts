import { logger } from '../common/logger.js';
import { logExecTime } from '../lib/decorators/logging_decorators.js';
import { OpenAiRealtimeClient } from './lib/openai_realtime_client.js';
import { VoiceCaptureInstructions } from './prompts/voice_capture_instructions.js';
import {
  MintTokenRequest,
  MintTokenResponse,
  RealtimeMcpAttachment,
  RealtimeSessionConfig,
} from './types/voice.types.js';
import { VoiceSvcInterface } from './voice_svc_interface.js';

const DEFAULT_MODEL = 'gpt-realtime';
const DEFAULT_VOICE = 'alloy';
const MCP_SERVER_LABEL = 'cortex-notes';
const MCP_ALLOWED_TOOLS = ['notes.create', 'notes.update', 'notes.search_semantic'];
const SLOW_MINT_THRESHOLD_MS = 2000;

export class VoiceSvc implements VoiceSvcInterface {

  private static instance: VoiceSvc | null = null;
  private static in_flight: Promise<VoiceSvc> | null = null;

  private readonly realtime_client: OpenAiRealtimeClient;
  private readonly model: string;
  private readonly voice: string;
  private readonly mcp_public_url: string | undefined;
  private readonly mcp_auth_token: string | undefined;

  private constructor(opts: {
    realtime_client: OpenAiRealtimeClient;
    model: string;
    voice: string;
    mcp_public_url: string | undefined;
    mcp_auth_token: string | undefined;
  }) {
    this.realtime_client = opts.realtime_client;
    this.model = opts.model;
    this.voice = opts.voice;
    this.mcp_public_url = opts.mcp_public_url;
    this.mcp_auth_token = opts.mcp_auth_token;
  }

  public static async getInstance(): Promise<VoiceSvc> {
    if (VoiceSvc.instance) return VoiceSvc.instance;
    if (VoiceSvc.in_flight) return VoiceSvc.in_flight;
    VoiceSvc.in_flight = VoiceSvc.loadInstance();
    return VoiceSvc.in_flight;
  }

  private static async loadInstance(): Promise<VoiceSvc> {
    try {
      const inst = new VoiceSvc({
        realtime_client: OpenAiRealtimeClient.create(),
        model: process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_MODEL,
        voice: process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_VOICE,
        mcp_public_url: process.env.VOICE_MCP_PUBLIC_URL,
        mcp_auth_token: process.env.MCP_NOTES_AUTH_TOKEN,
      });
      VoiceSvc.instance = inst;
      logger.info(
        { model: inst.model, voice: inst.voice, mcp_attached: Boolean(inst.mcp_public_url) },
        'VoiceSvc initialized'
      );
      return inst;
    } finally {
      VoiceSvc.in_flight = null;
    }
  }

  @logExecTime({ threshold_in_ms: SLOW_MINT_THRESHOLD_MS })
  public async mintEphemeralToken(req: MintTokenRequest): Promise<MintTokenResponse> {
    const config = this.buildSessionConfig(req.user_id);
    const session = await this.realtime_client.createSession(config);
    logger.info(
      {
        session_id: session.id,
        model: session.model,
        expires_at: session.client_secret.expires_at,
        mcp_attached: Boolean(config.tools && config.tools.length > 0),
      },
      'voice session minted'
    );
    return {
      session_id: session.id,
      client_secret: session.client_secret.value,
      expires_at: session.client_secret.expires_at,
      model: session.model,
    };
  }

  private buildSessionConfig(user_id: string): RealtimeSessionConfig {
    const config: RealtimeSessionConfig = {
      model: this.model,
      voice: this.voice,
      instructions: VoiceCaptureInstructions.build(),
    };
    const mcp = this.buildMcpAttachment(user_id);
    if (mcp) {
      config.tools = [mcp];
    }
    return config;
  }

  private buildMcpAttachment(user_id: string): RealtimeMcpAttachment | null {
    if (!this.mcp_public_url) {
      logger.warn(
        'VOICE_MCP_PUBLIC_URL not set; minting voice session without MCP tools'
      );
      return null;
    }
    if (!this.mcp_auth_token) {
      logger.warn(
        'MCP_NOTES_AUTH_TOKEN not set; minting voice session without MCP tools'
      );
      return null;
    }
    return {
      type: 'mcp',
      server_label: MCP_SERVER_LABEL,
      server_url: this.mcp_public_url,
      authorization: `Bearer ${this.mcp_auth_token}`,
      headers: { 'X-User-Id': user_id },
      allowed_tools: MCP_ALLOWED_TOOLS,
      require_approval: 'never',
    };
  }
}
