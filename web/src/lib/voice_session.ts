import { ApiClient } from './api_client';
import { RealtimeFollowUpTracker } from './realtime_follow_up_tracker';
import type {
  MintTokenResponse,
  VoiceSessionStatus,
  VoiceToolEvent,
  VoiceTranscriptEvent,
} from './voice.types';

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export type VoiceSessionCallbacks = {
  onStatus?: (status: VoiceSessionStatus) => void;
  onTranscript?: (event: VoiceTranscriptEvent) => void;
  onTool?: (event: VoiceToolEvent) => void;
  onError?: (message: string) => void;
};

type RealtimeServerEvent = {
  type: string;
  [key: string]: unknown;
};

export class VoiceSession {

  private readonly callbacks: VoiceSessionCallbacks;
  private peer_connection: RTCPeerConnection | null = null;
  private data_channel: RTCDataChannel | null = null;
  private mic_stream: MediaStream | null = null;
  private audio_element: HTMLAudioElement | null = null;
  private remote_stream: MediaStream | null = null;
  private status: VoiceSessionStatus = 'idle';
  private assistant_transcript_buffer = '';
  private readonly follow_up_tracker = new RealtimeFollowUpTracker();

  private constructor(callbacks: VoiceSessionCallbacks) {
    this.callbacks = callbacks;
  }

  public static async start(callbacks: VoiceSessionCallbacks): Promise<VoiceSession> {
    const session = new VoiceSession(callbacks);
    await session.connect();
    return session;
  }

  /** Silences the outgoing mic track without tearing down the session. */
  public setMuted(muted: boolean): void {
    this.mic_stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  public getMicStream(): MediaStream | null {
    return this.mic_stream;
  }

  /** The assistant's audio; null until the peer connection delivers its track. */
  public getRemoteStream(): MediaStream | null {
    return this.remote_stream;
  }

  public stop(): void {
    if (this.status === 'closed') return;
    this.setStatus('closed');
    this.data_channel?.close();
    this.data_channel = null;
    this.mic_stream?.getTracks().forEach((t) => t.stop());
    this.mic_stream = null;
    this.remote_stream = null;
    this.peer_connection?.close();
    this.peer_connection = null;
    if (this.audio_element) {
      this.audio_element.srcObject = null;
      this.audio_element.remove();
      this.audio_element = null;
    }
  }

  private async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      const minted = await ApiClient.mintVoiceToken();
      this.assertSupportedProvider(minted);

      const pc = new RTCPeerConnection();
      this.peer_connection = pc;

      this.audio_element = VoiceSession.createAudioElement();
      pc.ontrack = (event) => {
        if (event.streams[0]) this.remote_stream = event.streams[0];
        if (this.audio_element && event.streams[0]) {
          this.audio_element.srcObject = event.streams[0];
        }
      };
      pc.onconnectionstatechange = () => this.handleConnectionStateChange(pc.connectionState);

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mic_stream = mic;
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      const dc = pc.createDataChannel('oai-events');
      this.data_channel = dc;
      dc.addEventListener('message', (e) => this.handleDataChannelMessage(e));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer_sdp = await this.exchangeSdp(minted, offer.sdp ?? '');
      await pc.setRemoteDescription({ type: 'answer', sdp: answer_sdp });

      this.setStatus('listening');
    } catch (err) {
      this.fail(err);
      throw err;
    }
  }

  private assertSupportedProvider(minted: MintTokenResponse): void {
    if (minted.provider !== 'openai') {
      throw new Error(`Unsupported voice provider in browser: ${minted.provider}`);
    }
  }

  private async exchangeSdp(minted: MintTokenResponse, offer_sdp: string): Promise<string> {
    const url = `${OPENAI_REALTIME_CALLS_URL}?model=${encodeURIComponent(minted.model)}`;
    const resp = await fetch(url, {
      method: 'POST',
      body: offer_sdp,
      headers: {
        'Authorization': `Bearer ${minted.client_secret}`,
        'Content-Type': 'application/sdp',
      },
    });
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(`OpenAI Realtime SDP exchange failed: HTTP ${resp.status} ${detail.slice(0, 200)}`);
    }
    return resp.text();
  }

  private handleDataChannelMessage(e: MessageEvent): void {
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(e.data as string) as RealtimeServerEvent;
    } catch {
      return;
    }
    this.routeEvent(event);
    if (this.follow_up_tracker.observe(event)) {
      this.sendEvent({ type: 'response.create' });
    }
  }

  private sendEvent(event: RealtimeServerEvent): void {
    if (this.data_channel?.readyState !== 'open') return;
    this.data_channel.send(JSON.stringify(event));
  }

  private routeEvent(event: RealtimeServerEvent): void {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed': {
        const text = typeof event.transcript === 'string' ? event.transcript : '';
        if (text) this.callbacks.onTranscript?.({ role: 'user', text, is_final: true });
        return;
      }
      case 'response.audio_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (!delta) return;
        this.assistant_transcript_buffer += delta;
        this.callbacks.onTranscript?.({
          role: 'assistant',
          text: this.assistant_transcript_buffer,
          is_final: false,
        });
        return;
      }
      case 'response.audio_transcript.done': {
        const text = typeof event.transcript === 'string' ? event.transcript : this.assistant_transcript_buffer;
        this.assistant_transcript_buffer = '';
        this.callbacks.onTranscript?.({ role: 'assistant', text, is_final: true });
        return;
      }
      case 'response.mcp_call_arguments.done':
      case 'response.output_item.added': {
        const tool = VoiceSession.extractToolName(event);
        if (tool) this.callbacks.onTool?.({ tool_name: tool, status: 'started' });
        return;
      }
      case 'response.output_item.done': {
        const tool_event = VoiceSession.toMcpCallOutcome(event);
        if (tool_event) this.callbacks.onTool?.(tool_event);
        return;
      }
      case 'response.mcp_call.completed': {
        const tool = VoiceSession.extractToolName(event);
        this.callbacks.onTool?.({ tool_name: tool ?? 'mcp', status: 'completed' });
        return;
      }
      case 'response.mcp_call.failed': {
        const tool = VoiceSession.extractToolName(event);
        const detail = typeof event.error === 'string' ? event.error : undefined;
        this.callbacks.onTool?.({ tool_name: tool ?? 'mcp', status: 'failed', detail });
        return;
      }
      case 'error': {
        const detail = VoiceSession.extractErrorDetail(event);
        this.callbacks.onError?.(detail);
        return;
      }
      default:
        return;
    }
  }

  private static extractToolName(event: RealtimeServerEvent): string | null {
    const item = event.item;
    if (item && typeof item === 'object') {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
    if (typeof event.name === 'string') return event.name;
    return null;
  }

  private static toMcpCallOutcome(event: RealtimeServerEvent): VoiceToolEvent | null {
    const item = event.item;
    if (!item || typeof item !== 'object') return null;
    const { type, name, error } = item as Record<string, unknown>;
    if (type !== 'mcp_call') return null;
    const tool_name = typeof name === 'string' ? name : 'mcp';
    if (error) {
      return { tool_name, status: 'failed', detail: typeof error === 'string' ? error : undefined };
    }
    return { tool_name, status: 'completed' };
  }

  private static extractErrorDetail(event: RealtimeServerEvent): string {
    const err = event.error;
    if (err && typeof err === 'object') {
      const message = (err as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
    return 'Realtime error';
  }

  private handleConnectionStateChange(state: RTCPeerConnectionState): void {
    if (state === 'failed' || state === 'disconnected') {
      this.fail(new Error(`WebRTC connection ${state}`));
    }
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : 'Voice session failed';
    this.callbacks.onError?.(message);
    this.setStatus('error');
  }

  private setStatus(next: VoiceSessionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.callbacks.onStatus?.(next);
  }

  private static createAudioElement(): HTMLAudioElement {
    const el = document.createElement('audio');
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }
}
