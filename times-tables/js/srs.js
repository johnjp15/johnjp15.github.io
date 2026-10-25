// Spaced repetition (Leitner boxes). A fact only climbs when it is answered FAST
// (from memory) and only when it is due, so reaching "Memorized" takes fast
// recall on several different days — cramming one evening is not enough.

import { FACTS, FAST_MS, difficulty, tableFacts } from './facts.js';
import { shuffle, rand } from './util.js';

const MIN = 6e4;
const DAY = 864e5;
/** Wait before a fact in each box is due again. */
const WAIT = [0, 20 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 21 * DAY];

export const LEVELS = ['New', 'Learning', 'Practicing', 'Getting there', 'Memorized', 'Mastered'];
export const MEMORIZED_BOX = 4;

const FRESH = Object.freeze({ b: 0, d: 0, n: 0, c: 0, f: 0, t: [], s: 0 });
export const newFact = () => ({ ...FRESH, t: [] });
export const factState = (player, f) => player.facts[f.key] || FRESH;

/**
 * Apply one answer to a fact's state. Returns 'up' (climbed a box), 'early'
 * (fast, but reviewed before due), 'slow' or 'miss'.
 * placement: an instant answer on a benchmark marks a brand-new fact Memorized
 * straight away (it gets re-checked in a week).
 */
export function updateFact(st, { correct, ms }, now, placement = false) {
  st.n++;
  st.s = now;
  if (!correct) {
    st.b = 1;
    st.d = now + WAIT[1];
    return 'miss';
  }
  st.c++;
  st.t = [...st.t, Math.round(ms)].slice(-5);
  if (ms >= FAST_MS) {
    // Correct but worked out, not remembered: back to practice.
    st.b = Math.max(1, Math.min(st.b - 1, 2));
    st.d = now + WAIT[st.b];
    return 'slow';
  }
  st.f++;
  if (st.b === 0) st.b = placement ? MEMORIZED_BOX : 2;
  else if (now >= st.d) st.b = Math.min(5, st.b + 1);
  else return 'early';
  st.d = now + WAIT[st.b];
  return 'up';
}

export function memorizedCount(player) {
  return FACTS.filter(f => factState(player, f).b >= MEMORIZED_BOX).length;
}

/** Average mastery of a table's 12 facts, 0..1. */
export function tableMastery(player, t) {
  const list = tableFacts(t);
  return list.reduce((sum, f) => sum + Math.min(factState(player, f).b, MEMORIZED_BOX), 0) / (list.length * MEMORIZED_BOX);
}

/** The table the player should focus on next (weakest, easiest-first on ties). */
export function weakestTable(player) {
  let best = null;
  for (const t of [1, 10, 2, 5, 11, 3, 4, 9, 6, 12, 8, 7]) {
    const m = tableMastery(player, t);
    if (m < 1 && (best == null || m < best.m - 0.05)) best = { t, m };
  }
  return best?.t ?? null;
}

/** Randomly show 3×7 or 7×3. */
export const orient = f => (f.a !== f.b && Math.random() < 0.5 ? { ...f, a: f.b, b: f.a } : { ...f });

/**
 * Build a training round: missed facts first, then due reviews, then a few
 * new facts (fewer when there's a lot still being learned), then fillers.
 */
export function trainingDeck(player, { table = null, size = 20, now = Date.now() } = {}) {
  const pool = table ? tableFacts(table) : FACTS;
  const st = f => factState(player, f);
  const weakFirst = (x, y) => st(x).b - st(y).b || st(x).d - st(y).d;
  const learning = shuffle(pool.filter(f => st(f).b === 1));
  const due = pool.filter(f => st(f).b >= 2 && st(f).d <= now).sort(weakFirst);
  const fresh = pool.filter(f => st(f).b === 0).sort((x, y) => difficulty(x) - difficulty(y));
  const later = pool.filter(f => st(f).b >= 2 && st(f).d > now).sort(weakFirst);

  const deck = [];
  const take = (list, n) => {
    for (const f of list) {
      if (deck.length >= size || n <= 0) break;
      if (!deck.includes(f)) { deck.push(f); n--; }
    }
  };
  take(learning, 8);
  take(due, size);
  take(fresh, learning.length >= 6 ? 3 : learning.length >= 3 ? 6 : 10);
  take(later, size);
  take(fresh, size);
  take(learning, size);

  // Small pools (one table) repeat their weakest facts once more.
  const extra = [...deck].sort(weakFirst);
  for (let i = 0; deck.length < size && i < extra.length; i++) deck.push(extra[i]);

  return spread(shuffle(deck)).map(orient);
}

/** Reorder so the same fact never appears twice in a row. */
function spread(list) {
  for (let i = 1; i < list.length; i++) {
    if (list[i].key !== list[i - 1].key) continue;
    const j = list.findIndex((f, k) => k > i && f.key !== list[i].key);
    if (j > 0) [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Endless picker for Blitz, weighted toward facts that still need work. */
export function blitzPicker(player) {
  const W = [2, 6, 5, 3, 2, 1];
  const recent = [];
  return () => {
    const options = FACTS.filter(f => !recent.includes(f.key));
    const weights = options.map(f => W[factState(player, f).b]);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r >= weights[i] && i < weights.length - 1) r -= weights[i++];
    const f = options[i];
    recent.push(f.key);
    if (recent.length > 8) recent.shift();
    return orient(f);
  };
}

/** Facts of one table for a boss battle, reshuffled each lap. */
export function bossPicker(t) {
  let lap = [];
  return () => {
    if (!lap.length) lap = shuffle(tableFacts(t));
    const f = lap.pop();
    // Show the boss's own number first most of the time ("7 × 4" for the 7s boss).
    if (f.a === f.b) return { ...f };
    const other = f.a === t ? f.b : f.a;
    return rand(4) ? { ...f, a: t, b: other } : { ...f, a: other, b: t };
  };
}
