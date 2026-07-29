/**
 * Procedural audio: an artistic sonification of the black hole, synthesized
 * entirely with the Web Audio API (no samples).
 *
 * Honesty note — what real black holes "sound" like: the Perseus-cluster
 * black hole drives pressure waves through the cluster gas at a B-flat some
 * 57 octaves below middle C; NASA's sonification transposes it up into a
 * deep, slowly-breathing drone. LIGO's gravitational-wave detections land in
 * the audio band as a rising chirp that ends in a thump plus a fast-decaying
 * ringdown. This engine renders both artistically: a breathing low drone
 * (Perseus), filtered noise for matter rushing into the disc, a rising sine
 * tracking the binary's orbital rate (the inspiral chirp), and a one-shot
 * thump + ringdown at merger. None of it is the literal signal; all of it is
 * shaped by the same physics-driven quantities the visuals use.
 *
 * Node graph (all lazy, built on the first user gesture via unlock()):
 *
 *   drone oscA (sine 36 Hz)  -> mixA -\
 *   drone oscB (tri 55.5 Hz) -> mixB --> droneBus --\
 *        lfo (0.07 Hz) -> lfoDepth ----^ (gain AM)   \
 *   noise loop -> lowpass -> discGain -----------------> gate -> volume -> out
 *   chirp osc  -> chirpGain --------------------------/
 *   one-shots (merger thump/slap/ringdown, shred swell) -> gate (self-cleaning)
 */

/** Accretion-disc boost is clamped to this before driving the rush voice. */
const DISC_BOOST_MAX = 2;
/** Disc-rush lowpass: cutoff = DISC_CUTOFF_BASE_HZ + DISC_CUTOFF_SPAN_HZ * boost. */
const DISC_CUTOFF_BASE_HZ = 180;
const DISC_CUTOFF_SPAN_HZ = 700;
const DISC_GAIN_PER_BOOST = 0.18;

const DRONE_A_HZ = 36;
const DRONE_B_HZ = 55.5;
/** Drone bed sits ~-18 dB under the master. */
const DRONE_LEVEL = 0.125;
const DRONE_LFO_HZ = 0.07;
/** The Perseus "breathing": LFO modulates the drone bed +/-30%. */
const DRONE_LFO_DEPTH = 0.3;

/**
 * Chirp frequency: 40 + 110 * omegaWall Hz. The 110 folds in the factor of 2
 * (gravitational-wave frequency is twice the orbital frequency) over a base
 * 55 Hz-per-rad/s mapping.
 */
const CHIRP_HZ_PER_OMEGA = 110;
const CHIRP_HZ_MIN = 40;
const CHIRP_HZ_MAX = 1200;
const CHIRP_GAIN_MAX = 0.22;
/** Chirp gain reaches full CHIRP_GAIN_MAX as separation shrinks below this. */
const CHIRP_SEP_FAR = 10;
const CHIRP_SEP_RANGE = 9;
/** Fade-out when the binary vanishes without a merger event. */
const CHIRP_RELEASE_S = 0.3;

const MERGER_THUMP_HZ = 42;
const MERGER_THUMP_DECAY_S = 1.2;
/** Ringdown pitch at reference Rs = 1; real ringdown frequency scales ~1/M. */
const RINGDOWN_HZ = 175;
const RINGDOWN_TAU_S = 0.7;

const SHRED_CENTER_HZ = 300;
const SHRED_Q = 1.5;
const SHRED_DURATION_S = 0.8;

const NOISE_BUFFER_S = 2;
const GATE_RAMP_S = 0.08;

export interface AudioFrameState {
  /** Accretion-disc feeding boost, 0..2 — drives the "matter rushing in" noise. */
  discBoost: number;
  /** GW inspiral state, or null when no secondary black hole is present. */
  binary: { separation: number; omegaWall: number } | null; // omegaWall = orbital angular velocity, wall-clock rad/s
  primaryRs: number;
}

/** Every persistent node, created together on unlock() and torn down together. */
interface EngineGraph {
  ctx: AudioContext;
  gate: GainNode;
  volume: GainNode;
  droneOscA: OscillatorNode;
  droneOscB: OscillatorNode;
  droneLfo: OscillatorNode;
  droneBus: GainNode;
  noiseSource: AudioBufferSourceNode;
  noiseBuffer: AudioBuffer;
  discFilter: BiquadFilterNode;
  discGain: GainNode;
  chirpOsc: OscillatorNode;
  chirpGain: GainNode;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 2 s of brown-ish noise: integrated white noise (leaky, so it stays
 * bounded), normalized, with a short equal-power crossfade at the loop seam
 * so the 2 s loop doesn't click.
 */
function createBrownNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_S);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let last = 0;
  let peak = 1e-6;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last;
    peak = Math.max(peak, Math.abs(last));
  }
  for (let i = 0; i < length; i++) {
    data[i] = data[i]! / peak;
  }
  const fade = Math.min(2048, length >> 2);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    data[i] = data[i]! * w + data[length - fade + i]! * (1 - w);
  }
  return buffer;
}

export class AudioEngine {
  private graph: EngineGraph | null = null;
  private disposed = false;
  private enabled = false;
  private masterVolume = 0.8;
  /** Whether the chirp voice was live last frame (to release it exactly once). */
  private chirpActive = false;
  /** Latest primary Schwarzschild radius seen; scales the ringdown pitch. */
  private lastPrimaryRs = 1;

  /** Call from a user-gesture handler (pointerdown); idempotent; creates/resumes the AudioContext. */
  unlock(): void {
    if (this.disposed) return;
    if (this.graph) {
      if (this.graph.ctx.state === 'suspended') {
        void this.graph.ctx.resume().catch(() => undefined);
      }
      return;
    }
    if (typeof AudioContext === 'undefined') return;

    const ctx = new AudioContext();
    this.graph = this.buildGraph(ctx);
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
  }

  /** Master gate: smooth ramp to full/silent, no clicks. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    const g = this.graph;
    if (!g) return;
    g.gate.gain.setTargetAtTime(on ? 1 : 0, g.ctx.currentTime, GATE_RAMP_S);
  }

  setVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1);
    const g = this.graph;
    if (!g) return;
    g.volume.gain.setTargetAtTime(this.masterVolume, g.ctx.currentTime, GATE_RAMP_S);
  }

  /** Drive the continuous voices from this frame's simulation state. */
  update(dt: number, state: AudioFrameState): void {
    const g = this.graph;
    if (!g || g.ctx.state !== 'running') return;

    this.lastPrimaryRs = Math.max(state.primaryRs, 1e-3);
    const now = g.ctx.currentTime;
    // Track roughly at frame rate: parameters settle over a few frames.
    const tau = clamp(dt * 2, 0.02, 0.12);

    const boost = clamp(state.discBoost, 0, DISC_BOOST_MAX);
    g.discFilter.frequency.setTargetAtTime(
      DISC_CUTOFF_BASE_HZ + DISC_CUTOFF_SPAN_HZ * boost,
      now,
      tau,
    );
    g.discGain.gain.setTargetAtTime(boost * DISC_GAIN_PER_BOOST, now, tau);

    const binary = state.binary;
    if (binary) {
      if (!this.chirpActive) {
        // Cancel any pending release ramp before resuming continuous tracking.
        g.chirpGain.gain.cancelScheduledValues(now);
        this.chirpActive = true;
      }
      const hz = clamp(
        CHIRP_HZ_MIN + CHIRP_HZ_PER_OMEGA * binary.omegaWall,
        CHIRP_HZ_MIN,
        CHIRP_HZ_MAX,
      );
      const closeness = clamp((CHIRP_SEP_FAR - binary.separation) / CHIRP_SEP_RANGE, 0.05, 1);
      g.chirpOsc.frequency.setTargetAtTime(hz, now, tau * 0.5);
      g.chirpGain.gain.setTargetAtTime(CHIRP_GAIN_MAX * closeness, now, tau);
      return;
    }
    if (!this.chirpActive) return;
    // Binary vanished without a merger event: release the chirp gently.
    this.chirpActive = false;
    const gain = g.chirpGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + CHIRP_RELEASE_S);
  }

  /** The LIGO moment: duck the chirp, then thump + noise slap + ringdown. */
  onMerger(): void {
    const g = this.graph;
    if (!g || g.ctx.state !== 'running') return;

    const now = g.ctx.currentTime;
    this.chirpActive = false;
    g.chirpGain.gain.cancelScheduledValues(now);
    g.chirpGain.gain.setTargetAtTime(0, now, 0.005);

    // The thump: 42 Hz sine, ~1.2 s exponential decay.
    this.playTone(g, MERGER_THUMP_HZ, 'sine', 0.9, MERGER_THUMP_DECAY_S);

    // A short filtered-noise slap for the impact texture.
    this.playNoiseBurst(g, (filter) => {
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      filter.Q.value = 0.8;
    }, (env, t) => {
      env.gain.setValueAtTime(0.5, t);
      env.gain.exponentialRampToValueAtTime(1e-4, t + 0.2);
    }, 0.25);

    // Ringdown: deeper for a bigger hole (real ringdown frequency ~ 1/M).
    const ringHz = clamp(RINGDOWN_HZ / this.lastPrimaryRs, 60, 400);
    this.playTone(g, ringHz, 'sine', 0.3, RINGDOWN_TAU_S * 4, RINGDOWN_TAU_S);
  }

  /** Tidal-disruption debris burst: a bandpass noise swell, up then down. */
  onShred(): void {
    const g = this.graph;
    if (!g || g.ctx.state !== 'running') return;

    this.playNoiseBurst(g, (filter) => {
      filter.type = 'bandpass';
      filter.frequency.value = SHRED_CENTER_HZ;
      filter.Q.value = SHRED_Q;
    }, (env, t) => {
      env.gain.setValueAtTime(1e-4, t);
      env.gain.linearRampToValueAtTime(0.35, t + SHRED_DURATION_S * 0.35);
      env.gain.linearRampToValueAtTime(0, t + SHRED_DURATION_S);
    }, SHRED_DURATION_S);
  }

  dispose(): void {
    this.disposed = true;
    const g = this.graph;
    this.graph = null;
    if (!g) return;
    for (const source of [g.droneOscA, g.droneOscB, g.droneLfo, g.noiseSource, g.chirpOsc]) {
      try {
        source.stop();
      } catch {
        // Never started (shouldn't happen) — disconnect below still applies.
      }
    }
    g.gate.disconnect();
    g.volume.disconnect();
    void g.ctx.close().catch(() => undefined);
  }

  private buildGraph(ctx: AudioContext): EngineGraph {
    const volume = ctx.createGain();
    volume.gain.value = this.masterVolume;
    volume.connect(ctx.destination);

    const gate = ctx.createGain();
    gate.gain.value = this.enabled ? 1 : 0;
    gate.connect(volume);

    // Drone: two detuned lows, gain-modulated by a very slow LFO.
    const droneBus = ctx.createGain();
    droneBus.gain.value = DRONE_LEVEL;
    droneBus.connect(gate);

    const droneOscA = ctx.createOscillator();
    droneOscA.type = 'sine';
    droneOscA.frequency.value = DRONE_A_HZ;
    const mixA = ctx.createGain();
    mixA.gain.value = 0.6;
    droneOscA.connect(mixA);
    mixA.connect(droneBus);

    const droneOscB = ctx.createOscillator();
    droneOscB.type = 'triangle';
    droneOscB.frequency.value = DRONE_B_HZ;
    const mixB = ctx.createGain();
    mixB.gain.value = 0.4;
    droneOscB.connect(mixB);
    mixB.connect(droneBus);

    const droneLfo = ctx.createOscillator();
    droneLfo.type = 'sine';
    droneLfo.frequency.value = DRONE_LFO_HZ;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = DRONE_LEVEL * DRONE_LFO_DEPTH;
    droneLfo.connect(lfoDepth);
    lfoDepth.connect(droneBus.gain);

    // Disc rush: looped brown noise through a boost-driven lowpass.
    const noiseBuffer = createBrownNoiseBuffer(ctx);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const discFilter = ctx.createBiquadFilter();
    discFilter.type = 'lowpass';
    discFilter.frequency.value = DISC_CUTOFF_BASE_HZ;
    const discGain = ctx.createGain();
    discGain.gain.value = 0;
    noiseSource.connect(discFilter);
    discFilter.connect(discGain);
    discGain.connect(gate);

    // GW chirp: one sine, silent until a binary appears.
    const chirpOsc = ctx.createOscillator();
    chirpOsc.type = 'sine';
    chirpOsc.frequency.value = CHIRP_HZ_MIN;
    const chirpGain = ctx.createGain();
    chirpGain.gain.value = 0;
    chirpOsc.connect(chirpGain);
    chirpGain.connect(gate);

    droneOscA.start();
    droneOscB.start();
    droneLfo.start();
    noiseSource.start();
    chirpOsc.start();

    return {
      ctx,
      gate,
      volume,
      droneOscA,
      droneOscB,
      droneLfo,
      droneBus,
      noiseSource,
      noiseBuffer,
      discFilter,
      discGain,
      chirpOsc,
      chirpGain,
    };
  }

  /**
   * One-shot decaying tone. Starts at `peakGain` and decays with time
   * constant `tau` (defaults to duration/4, i.e. an exponential ramp shape),
   * stopping and self-disconnecting after `duration`.
   */
  private playTone(
    g: EngineGraph,
    hz: number,
    type: OscillatorType,
    peakGain: number,
    duration: number,
    tau?: number,
  ): void {
    const now = g.ctx.currentTime;
    const osc = g.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const env = g.ctx.createGain();
    env.gain.setValueAtTime(peakGain, now);
    if (tau !== undefined) {
      env.gain.setTargetAtTime(0, now, tau);
    } else {
      env.gain.exponentialRampToValueAtTime(1e-4, now + duration);
    }
    osc.connect(env);
    env.connect(g.gate);
    osc.start(now);
    osc.stop(now + duration + 0.05);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  /** One-shot filtered noise burst (shares the persistent brown-noise buffer). */
  private playNoiseBurst(
    g: EngineGraph,
    configureFilter: (filter: BiquadFilterNode) => void,
    shapeEnvelope: (env: GainNode, startTime: number) => void,
    duration: number,
  ): void {
    const now = g.ctx.currentTime;
    const source = g.ctx.createBufferSource();
    source.buffer = g.noiseBuffer;
    const filter = g.ctx.createBiquadFilter();
    configureFilter(filter);
    const env = g.ctx.createGain();
    shapeEnvelope(env, now);
    source.connect(filter);
    filter.connect(env);
    env.connect(g.gate);
    source.start(now);
    source.stop(now + duration + 0.05);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }
}
