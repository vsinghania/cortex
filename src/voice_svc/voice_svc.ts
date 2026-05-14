import { logger } from '../common/logger.js';
import { logExecTime } from '../lib/decorators/logging_decorators.js';
import { DEFAULT_VOICE_PROVIDER, VoiceAdapterRegistry } from './adapters/voice_adapter_registry.js';
import { McpAttachmentSpec, RealtimeVoiceAdapter } from './adapters/realtime_voice_adapter.js';
import { VoiceCaptureInstructions } from './prompts/voice_capture_instructions.js';
import {
  MintTokenRequest,
  MintTokenResponse,
  VoiceProvider,
  VoiceProviderSchema,
} from './types/voice.types.js';
import { VoiceSvcInterface } from './voice_svc_interface.js';

const MCP_SERVER_LABEL = 'cortex-notes';
const SLOW_MINT_THRESHOLD_MS = 2000;

export class VoiceSvc implements VoiceSvcInterface {

  private static instance: VoiceSvc | null = null;
  private static in_flight: Promise<VoiceSvc> | null = null;

  private readonly registry: VoiceAdapterRegistry;
  private readonly provider: VoiceProvider;
  private readonly mcp_public_url: string | undefined;
  private readonly mcp_auth_token: string | undefined;

  private constructor(opts: {
    registry: VoiceAdapterRegistry;
    provider: VoiceProvider;
    mcp_public_url: string | undefined;
    mcp_auth_token: string | undefined;
  }) {
    this.registry = opts.registry;
    this.provider = opts.provider;
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
        registry: VoiceAdapterRegistry.getInstance(),
        provider: VoiceSvc.resolveProvider(),
        mcp_public_url: process.env.VOICE_MCP_PUBLIC_URL,
        mcp_auth_token: process.env.MCP_NOTES_AUTH_TOKEN,
      });
      VoiceSvc.instance = inst;
      logger.info(
        { provider: inst.provider, mcp_attached: Boolean(inst.mcp_public_url && inst.mcp_auth_token) },
        'VoiceSvc initialized'
      );
      return inst;
    } finally {
      VoiceSvc.in_flight = null;
    }
  }

  @logExecTime({ threshold_in_ms: SLOW_MINT_THRESHOLD_MS })
  public async mintEphemeralToken(req: MintTokenRequest): Promise<MintTokenResponse> {
    const adapter = this.resolveAdapter();
    const mcp_attachment = this.buildMcpAttachment(req.user_id);
    const session = await adapter.mintEphemeralSession({
      user_id: req.user_id,
      instructions: VoiceCaptureInstructions.build(),
      mcp_attachment,
    });
    logger.info(
      {
        provider: this.provider,
        session_id: session.session_id,
        model: session.model,
        expires_at: session.expires_at,
        mcp_attached: Boolean(mcp_attachment),
      },
      'voice session minted'
    );
    return {
      session_id: session.session_id,
      client_secret: session.client_secret,
      expires_at: session.expires_at,
      model: session.model,
      provider: this.provider,
    };
  }

  private resolveAdapter(): RealtimeVoiceAdapter {
    return this.registry.getAdapter(this.provider);
  }

  private buildMcpAttachment(user_id: string): McpAttachmentSpec | undefined {
    if (!this.mcp_public_url) {
      logger.warn('VOICE_MCP_PUBLIC_URL not set; minting voice session without MCP tools');
      return undefined;
    }
    if (!this.mcp_auth_token) {
      logger.warn('MCP_NOTES_AUTH_TOKEN not set; minting voice session without MCP tools');
      return undefined;
    }
    return {
      server_label: MCP_SERVER_LABEL,
      server_url: this.mcp_public_url,
      bearer_token: this.mcp_auth_token,
      headers: { 'X-User-Id': user_id },
      require_approval: 'never',
    };
  }

  private static resolveProvider(): VoiceProvider {
    const raw = process.env.VOICE_PROVIDER;
    if (!raw) return DEFAULT_VOICE_PROVIDER;
    const parsed = VoiceProviderSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Unsupported VOICE_PROVIDER: ${raw}`);
    }
    return parsed.data;
  }
}
