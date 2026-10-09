import { logger } from '../common/logger.js';
import { logExecTime } from '../lib/decorators/logging_decorators.js';
import { Time } from '../lib/time.js';
import { OAuthSvc } from '../oauth_svc/oauth_svc.js';
import { McpResourceCatalog } from '../mcp/resource/mcp_resource_catalog.js';
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
const VOICE_MCP_CLIENT_ID = 'cortex-voice';
const VOICE_MCP_CLIENT_NAME = 'Cortex voice';
/** Outlives the longest Realtime session, so tools never stop working mid-call. */
const VOICE_MCP_TOKEN_TTL_SEC = Time.hoursToSec(1);

/** Mints a token that lets one voice session reach the public MCP as one user. */
type VoiceMcpAccessTokenIssuer = (user_id: string) => Promise<string>;

export class VoiceSvc implements VoiceSvcInterface {

  private static instance: VoiceSvc | null = null;

  private readonly registry: VoiceAdapterRegistry;
  private readonly provider: VoiceProvider;
  private readonly mcp_public_url: string | undefined;
  private readonly issue_mcp_access_token: VoiceMcpAccessTokenIssuer | undefined;

  private constructor(opts: {
    registry: VoiceAdapterRegistry;
    provider: VoiceProvider;
    mcp_public_url: string | undefined;
    issue_mcp_access_token: VoiceMcpAccessTokenIssuer | undefined;
  }) {
    this.registry = opts.registry;
    this.provider = opts.provider;
    this.mcp_public_url = opts.mcp_public_url;
    this.issue_mcp_access_token = opts.issue_mcp_access_token;
  }

  public static async getInstance(): Promise<VoiceSvc> {
    VoiceSvc.instance ??= VoiceSvc.createVoiceSvcInstance();
    return VoiceSvc.instance;
  }

  private static createVoiceSvcInstance(): VoiceSvc {
    const instance = new VoiceSvc({
      registry: VoiceAdapterRegistry.getInstance(),
      provider: VoiceSvc.resolveVoiceProvider(),
      // A local tunnel can stand in for the public URL OpenAI must reach.
      mcp_public_url: process.env.VOICE_MCP_PUBLIC_URL || VoiceSvc.getNotesMcpResourceUrl(),
      issue_mcp_access_token: OAuthSvc.isConfigured() ? VoiceSvc.issueVoiceMcpAccessToken : undefined,
    });
    logger.info(
      { provider: instance.provider, mcp_attached: Boolean(instance.mcp_public_url && instance.issue_mcp_access_token) },
      'VoiceSvc initialized'
    );
    return instance;
  }

  @logExecTime({ threshold_in_ms: SLOW_MINT_THRESHOLD_MS })
  public async mintEphemeralVoiceToken(req: MintTokenRequest): Promise<MintTokenResponse> {
    const adapter = this.resolveVoiceAdapter();
    const mcp_attachment = await this.buildVoiceMcpAttachment(req.user_id);
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

  private resolveVoiceAdapter(): RealtimeVoiceAdapter {
    return this.registry.getAdapter(this.provider);
  }

  /**
   * OpenAI hosts the MCP client for voice, so whatever goes in here leaves our network.
   * A per-user token scoped to the public MCP means a leaked one reaches one user's
   * notes for an hour, not every user's notes for as long as the service token lives.
   */
  private async buildVoiceMcpAttachment(user_id: string): Promise<McpAttachmentSpec | undefined> {
    if (!this.mcp_public_url || !this.issue_mcp_access_token) {
      logger.warn('Public notes MCP or OAuth not configured; minting voice session without MCP tools');
      return undefined;
    }

    try {
      return {
        server_label: MCP_SERVER_LABEL,
        server_url: this.mcp_public_url,
        bearer_token: await this.issue_mcp_access_token(user_id),
        headers: {},
        require_approval: 'never',
      };
    } catch (err) {
      // A session that can talk but not save beats no session at all.
      logger.error({ err }, 'voice MCP token issue failed; minting voice session without MCP tools');
      return undefined;
    }
  }

  private static async issueVoiceMcpAccessToken(user_id: string): Promise<string> {
    const oauth_svc = await OAuthSvc.create();
    const { access_token } = await oauth_svc.issueFirstPartyAccessToken({
      user_id,
      resource_id: 'notes',
      client_id: VOICE_MCP_CLIENT_ID,
      client_name: VOICE_MCP_CLIENT_NAME,
      ttl_sec: VOICE_MCP_TOKEN_TTL_SEC,
    });
    return access_token;
  }

  /** The public notes MCP (`https://mcp.cortexapp.me/notes`), when it is served. */
  private static getNotesMcpResourceUrl(): string | undefined {
    return McpResourceCatalog.fromEnv().findResourceById('notes')?.url;
  }

  private static resolveVoiceProvider(): VoiceProvider {
    const raw = process.env.VOICE_PROVIDER;
    if (!raw) return DEFAULT_VOICE_PROVIDER;
    const parsed = VoiceProviderSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Unsupported VOICE_PROVIDER: ${raw}`);
    }
    return parsed.data;
  }
}
