// Tiny synthesized sound effects (no audio files) and haptic taps.

let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }

/** Must run inside a user gesture on iOS before any sound can play. */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state !== 'running') ctx.resume();
  } catch { /* audio unavailable */ }
}

function tone(freq, at, dur, { type = 'sine', gain = 0.12, to = null } = {}) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const semis = n => Math.pow(2, n / 12);

export const sfx = {
  correct(combo = 0) {
    const base = 660 * semis(Math.min(combo, 12));
    tone(base, 0, 0.09, { type: 'triangle' });
    tone(base * 1.5, 0.07, 0.14, { type: 'triangle' });
  },
  slow() { tone(520, 0, 0.12, { type: 'triangle', gain: 0.08 }); },
  wrong() {
    tone(220, 0, 0.18, { type: 'square', gain: 0.05, to: 140 });
    tone(165, 0.12, 0.22, { type: 'square', gain: 0.05, to: 110 });
  },
  tick() { tone(1200, 0, 0.03, { type: 'square', gain: 0.03 }); },
  go() { tone(880, 0, 0.2, { type: 'triangle' }); },
  hit() { tone(300, 0, 0.12, { type: 'sawtooth', gain: 0.07, to: 80 }); },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, { type: 'triangle', gain: 0.1 }));
  },
  levelUp() {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.08, 0.18, { type: 'triangle', gain: 0.09 }));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.25, { type: 'triangle', gain: 0.08 }));
  },
};

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
