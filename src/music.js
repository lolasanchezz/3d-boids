// Scales, flock-size-to-note mapping, and a small Web Audio synth.

export const SCALES = {
  // C major pentatonic: every combination is consonant, so any number of
  // flocks can sing at once without clashing.
  pentatonic: {
    id: 'pentatonic',
    label: 'Pentatonic',
    kind: 'major pentatonic', // shown after the key, e.g. "C major pentatonic"
    intervals: [0, 2, 4, 7, 9],
    names: ['C', 'D', 'E', 'G', 'A'],
  },
  // C blues (minor pentatonic plus the flat-five "blue note"), so flocks that
  // land on F♯ grind against the rest.
  blues: {
    id: 'blues',
    label: 'Blues',
    kind: 'blues',
    intervals: [0, 3, 5, 6, 7, 10],
    names: ['C', 'E♭', 'F', 'F♯', 'G', 'B♭'],
  },
};

const ROOT_MIDI = 36; // C2
const OCTAVES = 4; // every scale spans C2 up to the top of octave 5

export const MIN_FLOCK_SIZE = 3; // groups smaller than this don't sing
// Each doubling of flock size drops this much pitch, in octaves. That's 3
// notes per doubling in the pentatonic scale and 3.6 in the blues scale, so a
// flock of 3 plays the top note and about 240 birds reaches C2 in either one.
const OCTAVES_PER_DOUBLING = 0.6;

export const noteCount = (scale) => OCTAVES * scale.intervals.length;

// Scale steps below the top note, as a continuous value.
export function flockSizeToStep(size, scale) {
  const perDoubling = OCTAVES_PER_DOUBLING * scale.intervals.length;
  return Math.max(0, perDoubling * Math.log2(size / MIN_FLOCK_SIZE));
}

// The note a flock of `size` birds plays (0 = lowest), ignoring hysteresis.
export function flockSizeToNote(size, scale) {
  const count = noteCount(scale);
  const step = Math.min(Math.round(flockSizeToStep(size, scale)), count - 1);
  return count - 1 - step;
}

export function noteMidi(note, scale) {
  const n = scale.intervals.length;
  return ROOT_MIDI + 12 * Math.floor(note / n) + scale.intervals[note % n];
}

// Name of any MIDI note, e.g. 61 -> "C♯4". Used once notes are shifted out
// of C, where a scale's own spellings no longer apply.
const CHROMATIC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function midiName(midi, { octave = true } = {}) {
  const name = CHROMATIC[((midi % 12) + 12) % 12];
  return octave ? name + (Math.floor(midi / 12) - 1) : name;
}

// Key name of the scale when shifted by `shift` semitones, e.g. "D blues".
export function scaleTitle(scale, shift = 0) {
  return `${midiName(ROOT_MIDI + shift, { octave: false })} ${scale.kind}`;
}

export function noteName(note, scale) {
  const n = scale.intervals.length;
  return scale.names[note % n] + (2 + Math.floor(note / n));
}

const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

const MAX_VOICES = 32;

// ---------------------------------------------------------------------------
// Sampled voice: a recording, repitched to each note by changing its playback
// speed (like a classic sampler, so higher notes are also shorter).
// ---------------------------------------------------------------------------
const SAMPLE_START_S = 0; // mihiScale.m4a repeats one note four times, ~1 s
const SAMPLE_END_S = 1.0; // apart. Use the first one.
const SAMPLE_FADE_IN_S = 0.003;
const SAMPLE_FADE_OUT_S = 0.12;

// Fundamental frequency of a mono signal, by YIN (de Cheveigné & Kawahara,
// 2002) over one window. Returns Hz, or null if there's no clear pitch.
export function detectPitch(samples, sampleRate, { minHz = 50, maxHz = 1000 } = {}) {
  const half = Math.floor(samples.length / 2);
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / minHz));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const diff = new Float32Array(maxTau + 2);
  for (let tau = 1; tau <= maxTau + 1; tau += 1) {
    let sum = 0;
    for (let i = 0; i < half; i += 1) {
      const d = samples[i] - samples[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  // Cumulative mean normalized difference; take the first dip under the threshold.
  let running = 0;
  const cmnd = new Float32Array(maxTau + 2);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau + 1; tau += 1) {
    running += diff[tau];
    cmnd[tau] = (diff[tau] * tau) / (running || 1);
  }
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cmnd[tau] < 0.15) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      const a = cmnd[tau - 1];
      const b = cmnd[tau];
      const c = cmnd[tau + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c)) || 0; // parabolic refinement
      return sampleRate / (tau + shift);
    }
  }
  return null;
}

// Decode a recording and cut out one clean note. Returns { buffer, hz }.
export async function loadSampleVoice(url) {
  const bytes = await (await fetch(url)).arrayBuffer();
  // An AudioBuffer isn't tied to the context that decoded it, so decode now
  // (before the user has clicked) with a throwaway offline context.
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
  const rate = decoded.sampleRate;
  const src = decoded.getChannelData(0);
  const start = Math.floor(SAMPLE_START_S * rate);
  const end = Math.min(src.length, Math.floor(SAMPLE_END_S * rate));

  const note = new AudioBuffer({ length: end - start, numberOfChannels: 1, sampleRate: rate });
  const out = note.getChannelData(0);
  out.set(src.subarray(start, end));
  // Bake in short fades so the cut doesn't click, and normalize.
  const fadeIn = Math.floor(SAMPLE_FADE_IN_S * rate);
  const fadeOut = Math.floor(SAMPLE_FADE_OUT_S * rate);
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (i < fadeIn) out[i] *= i / fadeIn;
    const fromEnd = out.length - 1 - i;
    if (fromEnd < fadeOut) out[i] *= fromEnd / fadeOut;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] *= 0.9 / peak;

  // Its pitch, measured on the steady middle of the note.
  const window = src.subarray(start + Math.floor(0.2 * rate), start + Math.floor(0.6 * rate));
  const hz = detectPitch(window, rate);
  if (!hz) throw new Error(`couldn't find a pitch in ${url}`);
  return { buffer: note, hz };
}

export class FlockSynth {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voices = 0;
    this.voice = 'synth'; // or 'sample'
    this.sample = null; // { buffer, hz } from loadSampleVoice()
  }

  setSample(sample) {
    this.sample = sample;
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // Browsers only allow audio after a user gesture, so call this from one.
  unlock() {
    if (!this.ctx) this.#build();
    if (this.ctx.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, t, 0.05);
  }

  // midi: MIDI note number, pan: -1..1, size: flock size (sets loudness)
  play(midi, { pan = 0, size = MIN_FLOCK_SIZE } = {}) {
    if (!this.enabled || !this.running || this.voices >= MAX_VOICES) return;
    if (this.voice === 'sample' && this.sample) {
      this.#playSample(midi, pan, size);
      return;
    }
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const freq = midiToFreq(midi);
    // 0 at the top of the range, 1 at the bottom
    const low = Math.min(1, Math.max(0, 1 - (midi - ROOT_MIDI) / (12 * OCTAVES)));

    // Bigger flocks are a bit louder, and low notes ring longer.
    const peak = Math.min(0.22, 0.08 + 0.02 * Math.log2(size / MIN_FLOCK_SIZE) + 0.04 * low);
    const decay = 0.9 + 1.8 * low;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    const panner = new StereoPannerNode(ctx, { pan: Math.max(-1, Math.min(1, pan)) });
    env.connect(panner).connect(this.bus);

    // Bell-ish voice: a triangle fundamental, plus a quiet sine an octave up
    // so the low notes still read on laptop speakers.
    const body = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
    const shimmer = new OscillatorNode(ctx, { type: 'sine', frequency: freq * 2 });
    const shimmerGain = new GainNode(ctx, { gain: 0.35 });
    body.connect(env);
    shimmer.connect(shimmerGain).connect(env);

    const end = t + decay + 0.05;
    body.start(t);
    shimmer.start(t);
    body.stop(end);
    shimmer.stop(end);

    this.voices += 1;
    body.onended = () => {
      this.voices -= 1;
      env.disconnect();
      panner.disconnect();
      shimmerGain.disconnect();
    };
  }

  // The recording, sped up or slowed down so its pitch lands on `midi`.
  #playSample(midi, pan, size) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const rate = midiToFreq(midi) / this.sample.hz;
    const duration = this.sample.buffer.duration / rate;
    const peak = Math.min(0.55, 0.22 + 0.06 * Math.log2(size / MIN_FLOCK_SIZE));

    const source = new AudioBufferSourceNode(ctx, { buffer: this.sample.buffer, playbackRate: rate });
    const env = new GainNode(ctx, { gain: peak });
    env.gain.setValueAtTime(peak, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const panner = new StereoPannerNode(ctx, { pan: Math.max(-1, Math.min(1, pan)) });
    source.connect(env).connect(panner).connect(this.bus);
    source.start(t);
    source.stop(t + duration + 0.02);

    this.voices += 1;
    source.onended = () => {
      this.voices -= 1;
      env.disconnect();
      panner.disconnect();
    };
  }

  #build() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    // Voices go into a bus. The bus feeds a dry path and a soft feedback
    // echo, both into the master gain, then a compressor so stacked chords
    // don't clip.
    this.bus = new GainNode(ctx, { gain: 1 });
    this.master = new GainNode(ctx, { gain: this.enabled ? 0.8 : 0 });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 4 });

    const delay = new DelayNode(ctx, { delayTime: 0.3, maxDelayTime: 1 });
    const feedback = new GainNode(ctx, { gain: 0.35 });
    const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2200 });
    const wet = new GainNode(ctx, { gain: 0.3 });

    this.bus.connect(this.master);
    this.bus.connect(delay);
    delay.connect(tone).connect(feedback).connect(delay);
    tone.connect(wet).connect(this.master);
    this.master.connect(comp).connect(ctx.destination);
  }
}
