// Synthesized sound effects and music (no audio files), plus haptic taps.

let ctx = null;
let fxBus = null;
let musicBus = null;
let noiseBuf = null;
let opts = { sound: true, music: true, loud: true };

/** Apply a player's sound settings: { sound, music, loud }. */
export function applySound(settings = {}) {
  for (const k of ['sound', 'music', 'loud']) if (typeof settings[k] === 'boolean') opts[k] = settings[k];
  setSession();
  if (!opts.music || !opts.sound) music.stop();
  else if (music.wanted && !music.playing) music.play(music.wanted);
}

// iPhones mute web audio when the ring/silent switch is on silent — which is
// how most kids keep their phones. "playback" plays anyway; "ambient" respects it.
function setSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = opts.loud ? 'playback' : 'ambient';
  } catch { /* not supported */ }
}

let onChange = null;
/** Called with the new settings whenever a sound setting is flipped from inside a game. */
export const onSoundChange = fn => { onChange = fn; };
export function toggleMusic() {
  applySound({ music: !opts.music });
  onChange?.({ ...opts });
  return opts.music;
}
export const musicOn = () => opts.sound && opts.music;

/** Must run inside a user gesture on iOS before any sound can play. */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      setSession();
      ctx = new AC();
      fxBus = ctx.createGain();
      fxBus.gain.value = 0.9;
      fxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.45;
      musicBus.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume().then(() => { if (music.wanted && !music.playing) music.play(music.wanted); });
  } catch { /* audio unavailable */ }
}

const live = () => ctx && ctx.state === 'running';

function tone(freq, at, dur, { type = 'sine', gain = 0.12, to = null, bus = fxBus, attack = 0.01 } = {}) {
  if (!live()) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(at, dur, { gain = 0.2, freq = 2000, to = null, q = 1, type = 'bandpass', bus = fxBus } = {}) {
  if (!live()) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const semis = n => Math.pow(2, n / 12);
const fx = fn => (...args) => { if (opts.sound) fn(...args); };

export const sfx = {
  /** Two-note chime that climbs with the combo, with a sparkle on top. */
  correct: fx((combo = 0) => {
    const base = 660 * semis(Math.min(combo, 14));
    tone(base, 0, 0.12, { type: 'triangle', gain: 0.13 });
    tone(base * 1.5, 0.07, 0.2, { type: 'triangle', gain: 0.12 });
    tone(base * 4, 0.07, 0.12, { gain: 0.03 });
    if (combo && combo % 5 === 0) [0, 4, 7, 12].forEach((s, i) => tone(base * 2 * semis(s), 0.2 + i * 0.05, 0.14, { type: 'square', gain: 0.03 }));
  }),
  slow: fx(() => { tone(523, 0, 0.16, { type: 'triangle', gain: 0.09 }); }),
  /** A soft "bonk", not a harsh buzzer. */
  wrong: fx(() => {
    tone(196, 0, 0.22, { type: 'triangle', gain: 0.16, to: 110 });
    noise(0, 0.08, { gain: 0.06, freq: 400, q: 2 });
  }),
  key: fx(() => { noise(0, 0.025, { gain: 0.05, freq: 3000, q: 4 }); }),
  tick: fx(() => { tone(1200, 0, 0.035, { type: 'square', gain: 0.03 }); }),
  go: fx(() => {
    tone(880, 0, 0.25, { type: 'triangle', gain: 0.12 });
    tone(1320, 0.05, 0.3, { gain: 0.05 });
  }),
  flip: fx(() => { noise(0, 0.18, { gain: 0.12, freq: 800, to: 3200, q: 1.5 }); }),
  whoosh: fx(() => { noise(0, 0.3, { gain: 0.14, freq: 3000, to: 500, q: 1 }); }),
  coin: fx(() => {
    tone(988, 0, 0.08, { type: 'square', gain: 0.05 });
    tone(1319, 0.07, 0.25, { type: 'square', gain: 0.05 });
  }),
  /** Boss takes a hit: thwack + thump. */
  hit: fx(() => {
    noise(0, 0.12, { gain: 0.25, freq: 1200, q: 0.8 });
    tone(150, 0, 0.18, { type: 'sine', gain: 0.25, to: 60 });
  }),
  /** Boss attacks you. */
  hurt: fx(() => {
    tone(330, 0, 0.3, { type: 'sawtooth', gain: 0.06, to: 90 });
    noise(0.02, 0.25, { gain: 0.1, freq: 300, type: 'lowpass' });
  }),
  /** Boss knocked out. */
  boom: fx(() => {
    noise(0, 0.9, { gain: 0.35, freq: 1600, to: 80, type: 'lowpass' });
    tone(110, 0, 0.6, { gain: 0.3, to: 40 });
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35 + i * 0.07, 0.25, { type: 'triangle', gain: 0.08 }));
  }),
  win: fx(() => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.24, { type: 'triangle', gain: 0.1 }));
    tone(1568, 0.44, 0.5, { gain: 0.05 });
  }),
  levelUp: fx(() => {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.08, 0.2, { type: 'triangle', gain: 0.09 }));
    noise(0.45, 0.4, { gain: 0.06, freq: 6000, type: 'highpass' });
  }),
  lose: fx(() => {
    [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.17, 0.28, { type: 'triangle', gain: 0.09 }));
  }),
};

// ---------- music: a tiny step sequencer ----------

// Chords as semitone offsets from the theme's root; each chord lasts one bar of 16 steps.
const THEMES = {
  calm: { bpm: 92, root: 60, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], arp: [0, 1, 2, 1, 2, 1, 0, 1], lead: 'triangle', drums: false },
  battle: { bpm: 128, root: 57, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], arp: [0, 2, 1, 2, 0, 2, 1, 2], lead: 'square', drums: true },
  race: { bpm: 150, root: 62, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], arp: [0, 1, 2, 3, 2, 1, 2, 1], lead: 'square', drums: true },
};

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

export const music = {
  wanted: null,
  playing: false,
  timer: null,
  play(name) {
    this.wanted = name;
    this.stop(true);
    if (!opts.sound || !opts.music || !live() || !THEMES[name]) return;
    const th = THEMES[name];
    const stepDur = 60 / th.bpm / 4;
    let step = 0;
    let next = ctx.currentTime + 0.08;
    const playStep = (s, t) => {
      const chord = th.chords[Math.floor(s / 16) % th.chords.length];
      const i = s % 16;
      const at = t - ctx.currentTime;
      if (i % 8 === 0) tone(midi(th.root - 24 + chord[0]), at, stepDur * 6, { type: 'triangle', gain: 0.16, bus: musicBus });
      if (i % 2 === 0) {
        const tones = [...chord, chord[0] + 12];
        const n = tones[th.arp[(i / 2) % th.arp.length] % tones.length];
        tone(midi(th.root + 12 + n), at, stepDur * 1.6, { type: th.lead, gain: th.lead === 'square' ? 0.025 : 0.06, bus: musicBus });
      }
      if (th.drums) {
        if (i % 4 === 0) tone(110, at, 0.12, { gain: 0.18, to: 45, bus: musicBus });
        if (i % 4 === 2) noise(at, 0.04, { gain: 0.04, freq: 8000, type: 'highpass', bus: musicBus });
      }
    };
    this.playing = true;
    this.timer = setInterval(() => {
      if (!live()) return;
      if (next < ctx.currentTime - 0.2) next = ctx.currentTime + 0.05; // after a pause, don't play a burst of catch-up notes
      while (next < ctx.currentTime + 0.15) {
        playStep(step, next);
        next += stepDur;
        step = (step + 1) % (16 * th.chords.length);
      }
    }, 25);
  },
  /** Stop the music. keepWanted: stopping only to switch tracks. */
  stop(keepWanted = false) {
    clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    if (!keepWanted) this.wanted = null;
  },
};

/** Read a fact out loud (only ever called from a tap, as iOS requires). */
export function speak(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.85;
    synth.speak(u);
  } catch { /* speech unavailable */ }
}

// iOS Safari has no vibrate(); toggling a hidden <input switch> gives a haptic tap on iOS 18+.
let hapticLabel = null;
export function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(20); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      hapticLabel.append(input);
      document.head.append(hapticLabel);
    }
    hapticLabel.click();
  } catch { /* no haptics */ }
}
