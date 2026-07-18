// The AudioContext / source owner and master clock for the preview
// (docs/DESIGN.md → Chart preview → Playback, clock & audio sync). The Scheduler
// class touches Web Audio and is manual-verified; computeAudioStart, chartTimeAt,
// and beatCtxTime are pure and unit-tested.

export interface AudioStart {
  whenDelaySeconds: number; // added to ctx.currentTime for AudioBufferSourceNode.start(when)
  sourceOffsetSeconds: number; // the start(when, offset) offset into the buffer
}

// Resolve the two start(when, offset) arguments. Audio position for chart time t
// is t + offsetSeconds: if that is >= 0 the source starts immediately at that
// offset; if negative, the source start is deferred by its magnitude with offset 0.
export function computeAudioStart(t0: number, offsetSeconds: number): AudioStart {
  const audioPos = t0 + offsetSeconds;
  if (audioPos >= 0) return { whenDelaySeconds: 0, sourceOffsetSeconds: audioPos };
  return { whenDelaySeconds: -audioPos, sourceOffsetSeconds: 0 };
}

// Rate-aware master clock: chart seconds elapsed since the play/seek anchor.
export function chartTimeAt(
  anchorChart: number,
  anchorCtx: number,
  nowCtx: number,
  rate: number,
): number {
  return anchorChart + (nowCtx - anchorCtx) * rate;
}

// The AudioContext time at which a beat at chart-second `beatSeconds` occurs,
// given the current play/seek anchor and rate. Inverse of chartTimeAt.
export function beatCtxTime(
  beatSeconds: number,
  anchorChart: number,
  anchorCtx: number,
  rate: number,
): number {
  return anchorCtx + (beatSeconds - anchorChart) / rate;
}

export interface MetronomeBeat {
  seconds: number;
  accent: boolean;
}

const METRO_INTERVAL_MS = 25; // look-ahead scheduler tick
const METRO_HORIZON = 0.1; // schedule clicks up to 100ms ahead (seconds)
const METRO_CLICK_DUR = 0.03; // click length (seconds)

export class Scheduler {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null; // preview-volume node; song source routes through it
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private anchorCtxTime = 0; // ctx.currentTime captured on play/seek
  private anchorChartTime = 0; // chart seconds captured on play/seek
  private offsetSeconds = 0; // last audio offset, so seek can restart the source
  private rate = 1; // playback speed multiplier
  private volume = 1; // preview gain (1 = 100%)
  private playing = false;

  private beats: MetronomeBeat[] = []; // chart-second beat positions
  private metronomeOn = false;
  private metronomeVolume = 1; // click level, 1 = 100% (view-only, own gain)
  private metroTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeatIndex = 0;
  private metroNodes: OscillatorNode[] = []; // scheduled clicks awaiting teardown

  // Create the context + persistent volume gain together, returning both non-null.
  private audio(): { ctx: AudioContext; gain: GainNode } {
    if (this.ctx === null || this.gain === null) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = this.volume;
      gain.connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      return { ctx, gain };
    }
    return { ctx: this.ctx, gain: this.gain };
  }

  setBuffer(buffer: AudioBuffer | null): void {
    if (buffer === this.buffer) return;
    this.buffer = buffer;
    // Resync a live source with the new buffer: adding or replacing audio mid-playback
    // starts it at the current position; removing it (null) silences playback.
    if (this.playing) this.startSource(this.currentChartTime(), this.offsetSeconds);
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.audio().ctx.decodeAudioData(data);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // Preview audio volume (song only; the metronome has its own fixed gain).
  setVolume(v: number): void {
    this.volume = v;
    if (this.gain !== null) this.gain.gain.value = v;
  }

  // Metronome click level, independent of the song preview volume. Applies to
  // clicks scheduled after this call (clicks are short and frequent, so no reschedule).
  setMetronomeVolume(v: number): void {
    this.metronomeVolume = v;
  }

  // Change playback speed. While playing, re-anchor the clock (capture the current
  // chart time at the OLD rate) then apply the new rate live and resync the
  // metronome, so slider drags stay smooth with no source restart.
  setRate(r: number): void {
    if (this.playing) {
      this.anchorChartTime = this.currentChartTime();
      this.anchorCtxTime = this.audio().ctx.currentTime;
      this.rate = r;
      if (this.source !== null) this.source.playbackRate.value = r;
      this.restartMetronome();
    } else {
      this.rate = r;
    }
  }

  setBeats(beats: MetronomeBeat[]): void {
    this.beats = beats;
    if (this.playing && this.metronomeOn) this.restartMetronome();
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on;
    if (!this.playing) return;
    if (on) this.startMetronome();
    else this.stopMetronome();
  }

  currentChartTime(): number {
    if (!this.playing || this.ctx === null) return this.anchorChartTime;
    return chartTimeAt(this.anchorChartTime, this.anchorCtxTime, this.ctx.currentTime, this.rate);
  }

  play(t0: number, offsetSeconds: number): void {
    const { ctx } = this.audio();
    this.anchorChartTime = t0;
    this.anchorCtxTime = ctx.currentTime;
    this.offsetSeconds = offsetSeconds;
    this.playing = true;
    // A context created off a user gesture (during decode) can be suspended; starting
    // the source before resume() resolves drops the first play. Defer the start until
    // the context is running, then re-anchor to its live clock.
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => this.begin(t0, offsetSeconds));
    } else {
      this.begin(t0, offsetSeconds);
    }
  }

  // Start the audio source and metronome for a play() once the context is running.
  private begin(t0: number, offsetSeconds: number): void {
    if (!this.playing) return; // stopped during the async resume
    this.anchorCtxTime = this.audio().ctx.currentTime;
    this.startSource(t0, offsetSeconds);
    if (this.metronomeOn) this.startMetronome();
  }

  // Re-anchor the running audio to a new offset without moving the chart clock
  // (editing Audio Offset while playing). Metronome is chart-synced, so it is
  // untouched here.
  reanchor(offsetSeconds: number): void {
    if (!this.playing) return;
    const t = this.currentChartTime();
    this.anchorChartTime = t;
    this.anchorCtxTime = this.audio().ctx.currentTime;
    this.offsetSeconds = offsetSeconds;
    this.startSource(t, offsetSeconds);
  }

  // Jump the chart clock (and audio + metronome) to a new time while playing.
  // Restart/section-jump use this; a stopped seek is a plain setViewTime in the view.
  seek(chartTime: number): void {
    if (!this.playing) return;
    this.anchorChartTime = chartTime;
    this.anchorCtxTime = this.audio().ctx.currentTime;
    this.startSource(chartTime, this.offsetSeconds);
    this.restartMetronome();
  }

  stop(): void {
    this.anchorChartTime = this.currentChartTime();
    this.playing = false;
    this.stopSource();
    this.stopMetronome();
  }

  dispose(): void {
    this.stopSource();
    this.stopMetronome();
    if (this.ctx !== null) {
      void this.ctx.close();
      this.ctx = null;
      this.gain = null;
    }
  }

  private startSource(t0: number, offsetSeconds: number): void {
    this.stopSource();
    if (this.buffer === null) return;
    const { ctx, gain } = this.audio();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(gain);
    const { whenDelaySeconds, sourceOffsetSeconds } = computeAudioStart(t0, offsetSeconds);
    src.start(ctx.currentTime + whenDelaySeconds, sourceOffsetSeconds);
    this.source = src;
  }

  private stopSource(): void {
    if (this.source === null) return;
    try {
      this.source.stop();
    } catch {
      // already stopped or never started
    }
    this.source.disconnect();
    this.source = null;
  }

  private restartMetronome(): void {
    if (!this.metronomeOn) return;
    this.stopMetronome();
    this.startMetronome();
  }

  // Begin the look-ahead loop from the first beat at or after the current time.
  private startMetronome(): void {
    this.stopMetronome();
    const t = this.currentChartTime();
    const idx = this.beats.findIndex((b) => b.seconds >= t);
    this.nextBeatIndex = idx === -1 ? this.beats.length : idx;
    this.metroTimer = setInterval(() => this.scheduleDueBeats(), METRO_INTERVAL_MS);
  }

  // Schedule every not-yet-scheduled beat that falls within the look-ahead horizon.
  private scheduleDueBeats(): void {
    if (this.ctx === null) return;
    const now = this.ctx.currentTime;
    const horizon = now + METRO_HORIZON;
    while (this.nextBeatIndex < this.beats.length) {
      const b = this.beats[this.nextBeatIndex];
      const when = beatCtxTime(b.seconds, this.anchorChartTime, this.anchorCtxTime, this.rate);
      if (when >= horizon) break;
      this.scheduleClick(Math.max(when, now), b.accent);
      this.nextBeatIndex++;
    }
  }

  private scheduleClick(when: number, accent: boolean): void {
    const peak = (accent ? 0.5 : 0.35) * this.metronomeVolume;
    if (peak <= 0) return; // metronome volume 0 — no click
    const { ctx } = this.audio();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    osc.connect(g);
    g.connect(ctx.destination); // fixed path, independent of the preview volume
    g.gain.setValueAtTime(peak, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + METRO_CLICK_DUR);
    osc.start(when);
    osc.stop(when + METRO_CLICK_DUR);
    this.metroNodes.push(osc);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      this.metroNodes = this.metroNodes.filter((n) => n !== osc);
    };
  }

  private stopMetronome(): void {
    if (this.metroTimer !== null) {
      clearInterval(this.metroTimer);
      this.metroTimer = null;
    }
    for (const osc of this.metroNodes) {
      try {
        osc.stop();
      } catch {
        // already stopped
      }
      osc.disconnect();
    }
    this.metroNodes = [];
  }
}
