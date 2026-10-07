import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceSession } from '../../lib/voice_session';
import type { VoiceSessionStatus, VoiceTranscriptEvent } from '../../lib/voice.types';
import { Icon } from '../icon';
import type { VoiceLine, VoicePhase } from '../../lib/assistant.types';
import { AudioLevelMeter } from '../../lib/audio_level_meter';
import { useHotkey } from '../../lib/use_hotkey';
import { useIsMobile } from '../../lib/use_is_mobile';
import { VoiceLaunch } from '../../lib/voice_launch';

const BAR_COUNT = 44;
/** Fewer bars on a phone: 44 of them read as noise at that width. */
const MOBILE_BAR_COUNT = 32;
const TIMER_TICK_MS = 1000;
const SECONDS_PER_MINUTE = 60;

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Tap to speak',
  connecting: 'Connecting…',
  listening: 'Listening…',
  speaking: 'Speaking',
  error: 'Voice stopped',
};

type Props = {
  /** Start listening on mount instead of waiting for a tap. */
  autostart?: boolean;
};

export function VoiceView({ autostart = false }: Props) {
  const [status, set_status] = useState<VoiceSessionStatus>('idle');
  const [speaking, set_speaking] = useState(false);
  const [muted, set_muted] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [lines, set_lines] = useState<VoiceLine[]>([]);
  const [elapsed_sec, set_elapsed_sec] = useState(0);
  const session_ref = useRef<VoiceSession | null>(null);
  const start_generation_ref = useRef(0);
  const line_id_ref = useRef(0);
  const streaming_line_ref = useRef<number | null>(null);
  const speaking_ref = useRef(speaking);
  speaking_ref.current = speaking;
  const muted_ref = useRef(muted);
  muted_ref.current = muted;
  const bar_refs = useRef<(HTMLSpanElement | null)[]>([]);
  const is_mobile = useIsMobile();
  const bar_count = is_mobile ? MOBILE_BAR_COUNT : BAR_COUNT;
  const orb_ref = useRef<HTMLButtonElement>(null);
  const captions_ref = useRef<HTMLDivElement>(null);

  const is_active = status === 'connecting' || status === 'listening';
  const phase: VoicePhase =
    status === 'error' ? 'error' : status === 'connecting' ? 'connecting' : status === 'listening' ? (speaking ? 'speaking' : 'listening') : 'idle';
  const label = phase === 'listening' && muted ? 'Muted' : PHASE_LABEL[phase];

  const handleTranscript = useCallback((event: VoiceTranscriptEvent) => {
    if (event.role === 'user') {
      const id = ++line_id_ref.current;
      set_lines((current) => [...current, { id, role: 'user', text: event.text, streaming: false }]);
      return;
    }
    set_speaking(!event.is_final);
    const streaming_id = streaming_line_ref.current;
    if (streaming_id !== null) {
      if (event.is_final) streaming_line_ref.current = null;
      set_lines((current) => current.map((l) => (l.id === streaming_id ? { ...l, text: event.text, streaming: !event.is_final } : l)));
      return;
    }
    const id = ++line_id_ref.current;
    if (!event.is_final) streaming_line_ref.current = id;
    set_lines((current) => [...current, { id, role: 'assistant', text: event.text, streaming: !event.is_final }]);
  }, []);

  const stop = useCallback(() => {
    start_generation_ref.current++;
    session_ref.current?.stop();
    session_ref.current = null;
    set_speaking(false);
  }, []);

  async function start() {
    stop();
    const generation = start_generation_ref.current;
    set_error(null);
    set_lines([]);
    set_muted(false);
    set_elapsed_sec(0);
    streaming_line_ref.current = null;
    try {
      const session = await VoiceSession.start({
        onStatus: set_status,
        onTranscript: handleTranscript,
        onError: set_error,
      });
      // Ended (or restarted) while still connecting: don't keep a session nobody wants.
      if (generation !== start_generation_ref.current) {
        session.stop();
        return;
      }
      session_ref.current = session;
    } catch (err) {
      if (generation === start_generation_ref.current) {
        set_error(err instanceof Error ? err.message : 'Failed to start voice.');
        set_status('error');
      }
    }
  }

  function toggleMute() {
    const next = !muted;
    session_ref.current?.setMuted(next);
    set_muted(next);
  }

  useEffect(() => stop, [stop]);
  useHotkey({ key: 'Escape' }, stop, is_active);
  useHotkey(VoiceLaunch.HOTKEY, () => (is_active ? stop() : void start()));

  useEffect(() => {
    if (autostart) void start();
    // Only the arrival matters; start() is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart]);

  useEffect(() => {
    if (status !== 'listening') return;
    const id = window.setInterval(() => set_elapsed_sec((s) => s + 1), TIMER_TICK_MS);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    captions_ref.current?.scrollTo({ top: captions_ref.current.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  // Levels are painted straight onto the DOM each frame; routing 44 bars through state
  // would re-render the whole view sixty times a second.
  useEffect(() => {
    if (!is_active) {
      Waveform.paint(bar_refs.current, null);
      orb_ref.current?.style.setProperty('--amp', '0');
      return;
    }
    let mic_meter: AudioLevelMeter | null = null;
    let remote_meter: AudioLevelMeter | null = null;
    let frame = 0;

    const tick = () => {
      const session = session_ref.current;
      const mic_stream = session?.getMicStream();
      const remote_stream = session?.getRemoteStream();
      if (!mic_meter && mic_stream) mic_meter = AudioLevelMeter.tryCreate(mic_stream);
      if (!remote_meter && remote_stream) remote_meter = AudioLevelMeter.tryCreate(remote_stream);

      const meter = speaking_ref.current ? remote_meter : muted_ref.current ? null : mic_meter;
      Waveform.paint(bar_refs.current, meter ? meter.bands(bar_count / 2) : null);
      orb_ref.current?.style.setProperty('--amp', meter ? meter.level().toFixed(3) : '0');
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      mic_meter?.close();
      remote_meter?.close();
    };
  }, [is_active, bar_count]);

  // Waveform.paint reads the array's length to find its centre, so stale tail slots
  // (nulled by React when the count shrinks) would push the mirror off-centre.
  useEffect(() => {
    bar_refs.current.length = bar_count;
  }, [bar_count]);

  return (
    <div className="voice">
      <div className={`voice-glow${is_active ? ' voice-glow-active' : ''}`} aria-hidden="true" />
      <div className="voice-scroll">
        <div className="voice-stage">
          <button
            ref={orb_ref}
            type="button"
            className={`orb orb-${phase}`}
            onClick={() => (is_active ? stop() : void start())}
            aria-label={is_active ? 'End voice session' : 'Start voice session'}
          >
            {is_active && <span className="orb-ring" aria-hidden="true" />}
            {is_active && <span className="orb-ring orb-ring-2" aria-hidden="true" />}
            {is_active && <span className="orb-ring orb-ring-3" aria-hidden="true" />}
            <span className="orb-core" aria-hidden="true" />
            <Icon name={phase === 'listening' && muted ? 'mic_off' : phase === 'listening' ? 'mic' : 'hexagon'} size={28} className="orb-icon" />
          </button>

          <div className={`waveform${is_active ? ' waveform-active' : ''}`} aria-hidden="true">
            {Array.from({ length: bar_count }, (_, i) => (
              <span
                key={i}
                ref={(el) => {
                  bar_refs.current[i] = el;
                }}
              />
            ))}
          </div>

          <div className="voice-status" role="status" aria-live="polite">
            <span className={`voice-label${is_active ? ' voice-label-active' : ''}`}>{label}</span>
            {status === 'listening' && <span className="pill mono-meta">{Duration.clock(elapsed_sec)}</span>}
          </div>

          {error && <div className="form-error voice-error" role="alert">{error}</div>}

          <div className="captions" ref={captions_ref}>
            {lines.length === 0 ? (
              <p className="captions-empty">
                Tap the orb and talk. Cortex can search and save your notes while you speak.
              </p>
            ) : (
              lines.map((line) => (
                <div key={line.id} className="caption">
                  <span className={`caption-role${line.role === 'assistant' ? ' caption-role-assistant' : ''}`}>
                    {line.role === 'user' ? 'You' : 'Ctx'}
                  </span>
                  <p className={line.role === 'user' ? 'caption-text' : 'caption-text caption-text-assistant'}>
                    {line.text}
                    {line.streaming && <span className="caret" aria-hidden="true">▍</span>}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="voice-controls">
            <button
              type="button"
              className={`round-btn${muted ? ' round-btn-accent' : ''}`}
              onClick={toggleMute}
              disabled={status !== 'listening'}
              aria-pressed={muted}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              title={muted ? 'Unmute' : 'Mute'}
            >
              <Icon name={muted ? 'mic_off' : 'mic'} size={16} />
            </button>
            <button type="button" className={`pill-btn${is_active ? ' pill-btn-muted' : ''}`} onClick={() => (is_active ? stop() : void start())}>
              <Icon name={is_active ? 'stop' : 'mic'} size={13} />
              {is_active ? 'End session' : status === 'error' ? 'Try again' : 'Start talking'}
            </button>
          </div>
          <p className="voice-hint">
            {VoiceHint.shortcuts({ is_active, is_mobile })}The conversation isn't kept; notes you save are.
          </p>
        </div>
      </div>
    </div>
  );
}

class Waveform {
  private static readonly MIN_HEIGHT_PX = 3;
  private static readonly MAX_HEIGHT_PX = 34;
  private static readonly REST_LEVEL = 0.05;

  /** Mirrors the bands out from the centre, so low frequencies sit in the middle. */
  static paint(bars: (HTMLSpanElement | null)[], bands: number[] | null): void {
    const centre = (bars.length - 1) / 2;
    bars.forEach((bar, i) => {
      if (!bar) return;
      const distance = Math.abs(i - centre) / (centre + 1);
      const value = bands ? bands[Math.min(bands.length - 1, Math.floor(distance * bands.length))] : Waveform.REST_LEVEL;
      const height = Waveform.MIN_HEIGHT_PX + value * (Waveform.MAX_HEIGHT_PX - Waveform.MIN_HEIGHT_PX);
      bar.style.height = `${height.toFixed(1)}px`;
    });
  }
}

class VoiceHint {
  static shortcuts(params: { is_active: boolean; is_mobile: boolean }): string {
    if (params.is_mobile) return '';
    return params.is_active ? 'esc to end · ' : `${VoiceLaunch.hotkeyLabel()} to start · `;
  }
}

class Duration {
  /** Seconds as "m:ss". */
  static clock(total_sec: number): string {
    const minutes = Math.floor(total_sec / SECONDS_PER_MINUTE);
    const seconds = total_sec % SECONDS_PER_MINUTE;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}
