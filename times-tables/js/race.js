// Shared rules for every Versus mode: everyone gets the same questions in the
// same order (from a shared seed), the first to RACE_TARGET correct wins, and a
// wrong answer costs PENALTY_MS while the right answer is shown.

import { FACTS } from './facts.js';

export const RACE_TARGET = 15;
export const PENALTY_MS = 1500;
export const RACE_MAX_MS = 4 * 60000; // give up after 4 minutes

/** Small, fast seeded random numbers (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

// × 1 facts make for a dull race.
const POOL = FACTS.filter(f => f.a !== 1);

/** Endless question stream; the same seed always gives the same questions. */
export function raceStream(seed) {
  const r = rng(seed);
  let deck = [];
  return () => {
    if (!deck.length) {
      deck = [...POOL];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    const f = deck.pop();
    return r() < 0.5 && f.a !== f.b ? { ...f, a: f.b, b: f.a } : { ...f };
  };
}

export function fmtRace(ms) {
  if (ms == null) return '—';
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
