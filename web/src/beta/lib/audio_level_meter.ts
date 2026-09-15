/** Reads live loudness off a MediaStream for the voice orb and waveform. */
export class AudioLevelMeter {
  private static readonly FFT_SIZE = 256;
  private static readonly SMOOTHING = 0.75;
  /** Speech RMS rarely passes ~0.3 of full scale; this spreads it across the 0..1 range. */
  private static readonly LEVEL_GAIN = 3.2;
  /** The top of the spectrum is mostly empty for voice, so bands sample the lower part. */
  private static readonly VOICE_BAND_FRACTION = 0.6;

  private constructor(
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly analyser: AnalyserNode,
    private readonly time_data: Uint8Array<ArrayBuffer>,
    private readonly frequency_data: Uint8Array<ArrayBuffer>,
  ) {}

  static create(stream: MediaStream): AudioLevelMeter {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = AudioLevelMeter.FFT_SIZE;
    analyser.smoothingTimeConstant = AudioLevelMeter.SMOOTHING;
    source.connect(analyser);
    return new AudioLevelMeter(
      context,
      source,
      analyser,
      new Uint8Array(analyser.fftSize),
      new Uint8Array(analyser.frequencyBinCount),
    );
  }

  /** Null when the browser can't meter this stream (no Web Audio, or the context is refused). */
  static tryCreate(stream: MediaStream): AudioLevelMeter | null {
    try {
      return AudioLevelMeter.create(stream);
    } catch {
      return null;
    }
  }

  /** Overall loudness, 0..1. */
  level(): number {
    this.analyser.getByteTimeDomainData(this.time_data);
    let sum_squares = 0;
    for (const sample of this.time_data) {
      const centered = (sample - 128) / 128;
      sum_squares += centered * centered;
    }
    const rms = Math.sqrt(sum_squares / this.time_data.length);
    return Math.min(1, rms * AudioLevelMeter.LEVEL_GAIN);
  }

  /** `count` frequency bands, low to high, each 0..1. */
  bands(count: number): number[] {
    this.analyser.getByteFrequencyData(this.frequency_data);
    const usable = Math.floor(this.frequency_data.length * AudioLevelMeter.VOICE_BAND_FRACTION);
    const bucket = Math.max(1, Math.floor(usable / count));
    return Array.from({ length: count }, (_, i) => {
      let sum = 0;
      for (let j = i * bucket; j < (i + 1) * bucket; j++) sum += this.frequency_data[j] ?? 0;
      return sum / bucket / 255;
    });
  }

  close(): void {
    this.source.disconnect();
    void this.context.close();
  }
}
