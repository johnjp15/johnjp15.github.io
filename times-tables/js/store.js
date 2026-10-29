// Players live in this browser: the current player's id is kept in a cookie
// (refreshed on every visit) and each player's progress in localStorage.

import { newFact, updateFact, memorizedCount } from './srs.js';
import { dayKey, yesterdayKey, bytesToHex, clip } from './util.js';
import { TOTAL } from './facts.js';

const NS = 'ttq:v1:';
const COOKIE = 'ttq_player';
const COOKIE_DAYS = 400;

export const DAILY_GOAL = 40; // correct answers per day
export const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🦄', '🐲', '🐙', '🦖', '🐧', '🐨', '🐶', '🐱', '🦉', '🐬', '🦈']; // only ever append: players store the position

const FUN_NAMES = ['Captain', 'Super', 'Turbo', 'Mega', 'Ninja', 'Rocket', 'Cosmic', 'Thunder'];
const FUN_ANIMALS = ['Fox', 'Panda', 'Tiger', 'Lion', 'Frog', 'Monkey', 'Unicorn', 'Dragon', 'Octopus', 'Dino', 'Penguin', 'Koala', 'Pup', 'Kitty', 'Owl', 'Dolphin', 'Shark'];

export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function lsSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(NS + key);
    else localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readCookie() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]{16})`));
  return m ? m[1] : null;
}

function writeCookie(id) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${id}; Max-Age=${COOKIE_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
}

export function newPlayerId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

export function suggestName(avatarIndex) {
  return `${FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)]} ${FUN_ANIMALS[avatarIndex] || 'Fox'}`;
}

function defaults(id) {
  return {
    v: 1,
    id,
    name: 'Player',
    avatar: 0,
    created: Date.now(),
    xp: 0,
    facts: {},
    bosses: {},
    blitzBest: 0,
    streak: { count: 0, last: null },
    daily: { day: null, correct: 0 },
    tests: [],
    testSeq: 0,
    restores: 0,
    cards: {}, // flash-card decks studied: { [table|'tricky'|'custom']: { times, last } }
    days: {}, // practice per calendar day: { 'YYYY-MM-DD': { c: correct, a: answers, ms: answer time, f: flash cards } }
    lastActive: null,
    badges: {},
    stats: { answers: 0, correct: 0, fast: 0, bestCombo: 0, rounds: 0 },
    settings: { sound: true, music: true, loud: true, keypad: 'calc' },
  };
}

export const listPlayers = () => lsGet('players', []);

export function loadPlayer(id) {
  const p = lsGet(`p:${id}`);
  if (!p) return null;
  const d = defaults(id);
  return { ...d, ...p, stats: { ...d.stats, ...p.stats }, settings: { ...d.settings, ...p.settings } };
}

/** Union of test records (never lose one, whichever copy is saved last). */
function unionTests(a = [], b = []) {
  const bySig = new Map();
  for (const t of [...b, ...a]) bySig.set(t.sig, t);
  return [...bySig.values()].sort((x, y) => x.seq - y.seq || x.start - y.start);
}

/** Pull in tests saved by another tab or an older copy of this player. */
export function syncTests(p) {
  const stored = lsGet(`p:${p.id}`);
  if (!stored) return p;
  p.tests = unionTests(p.tests, stored.tests);
  p.testSeq = Math.max(p.testSeq || 0, stored.testSeq || 0, ...p.tests.map(t => t.seq));
  return p;
}

export function savePlayer(p) {
  syncTests(p);
  const ok = lsSet(`p:${p.id}`, p);
  const index = listPlayers().filter(x => x.id !== p.id);
  index.push({ id: p.id, name: p.name, avatar: p.avatar });
  lsSet('players', index);
  return ok;
}

// Reuse the cookie's id when the rest of the player's data was wiped, so their player ID stays the same.
const freeCookieId = () => { const c = readCookie(); return c && !listPlayers().some(p => p.id === c) ? c : null; };

export function createPlayer({ id = freeCookieId() || newPlayerId(), name, avatar }) {
  const p = { ...defaults(id), name: clip(name, 20) || 'Player', avatar };
  savePlayer(p);
  setCurrent(p.id);
  return p;
}

function mergeDays(a = {}, b = {}) {
  const out = { ...b };
  for (const [k, d] of Object.entries(a)) out[k] = !out[k] || d.a + d.f >= out[k].a + out[k].f ? d : out[k];
  return out;
}

/**
 * Combine a backup with what's already on this device. Nothing is lost: every
 * test is kept, the test counter never goes back, and the restore is counted
 * (it appears on future results).
 */
export function mergeBackup(local, backup) {
  const base = { ...defaults(backup.id), ...backup, name: clip(backup.name, 20) || 'Player' };
  if (!local) return { ...base, restores: (base.restores || 0) + 1 };
  const facts = { ...base.facts };
  for (const [k, st] of Object.entries(local.facts || {})) {
    if (!facts[k] || (st.s || 0) > (facts[k].s || 0)) facts[k] = st;
  }
  const bosses = { ...base.bosses };
  for (const [t, b] of Object.entries(local.bosses || {})) {
    const o = bosses[t];
    bosses[t] = o ? { stars: Math.max(o.stars, b.stars), wins: Math.max(o.wins, b.wins), tries: Math.max(o.tries, b.tries) } : b;
  }
  const stats = { ...base.stats };
  for (const [k, v] of Object.entries(local.stats || {})) stats[k] = Math.max(v, stats[k] || 0);
  const later = (x, y) => ((x?.last || x?.day || '') >= (y?.last || y?.day || '') ? x : y);
  const tests = unionTests(local.tests, base.tests);
  return {
    ...base,
    xp: Math.max(local.xp || 0, base.xp || 0),
    facts,
    bosses,
    stats,
    blitzBest: Math.max(local.blitzBest || 0, base.blitzBest || 0),
    badges: { ...base.badges, ...local.badges },
    cards: { ...base.cards, ...local.cards },
    days: mergeDays(local.days, base.days),
    lastActive: Math.max(local.lastActive || 0, base.lastActive || 0) || null,
    streak: later(local.streak, base.streak),
    daily: later(local.daily, base.daily),
    tests,
    testSeq: Math.max(local.testSeq || 0, base.testSeq || 0, ...tests.map(t => t.seq)),
    restores: Math.max(local.restores || 0, base.restores || 0) + 1,
  };
}

export function deletePlayer(id) {
  lsSet(`p:${id}`, null);
  lsSet('players', listPlayers().filter(x => x.id !== id));
  if (readCookie() === id) document.cookie = `${COOKIE}=; Max-Age=0; Path=/`;
  if (lsGet('last') === id) lsSet('last', null);
}

export function setCurrent(id) {
  writeCookie(id);
  lsSet('last', id);
}

/** Who is playing on this device right now (cookie first, then last used). */
export function currentPlayer() {
  for (const id of [readCookie(), lsGet('last'), listPlayers()[0]?.id]) {
    if (!id) continue;
    const p = loadPlayer(id);
    if (p) {
      setCurrent(p.id); // refresh the cookie so it doesn't expire
      return p;
    }
  }
  return null;
}

/** Ask the browser not to evict our data (Safari 17+, Chrome). */
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* not supported */ }
}

// ---------- progress ----------

const TITLES = [
  'Number Rookie', 'Digit Dabbler', 'Times Trainee', 'Fact Finder', 'Product Pro',
  'Speedy Solver', 'Table Tamer', 'Number Ninja', 'Math Wizard', 'Lightning Brain',
  'Times Titan', 'Grand Multiplier', 'Legend of 12 × 12',
];

export function levelInfo(xp) {
  let level = 1;
  let floor = 0;
  let need = 100;
  while (xp >= floor + need) {
    floor += need;
    level++;
    need += 50;
  }
  return { level, into: xp - floor, need, title: TITLES[Math.min(level - 1, TITLES.length - 1)] };
}

/** Record one answer for a fact: spaced repetition, stats and the daily goal. */
export function recordAnswer(p, q, res, { placement = false, now = Date.now() } = {}) {
  const st = (p.facts[q.key] ||= newFact());
  const outcome = updateFact(st, res, now, placement);
  p.stats.answers++;
  if (res.correct) p.stats.correct++;
  if (res.fast) p.stats.fast++;
  p.stats.bestCombo = Math.max(p.stats.bestCombo, res.combo || 0);
  if (res.correct) bumpDaily(p, now);
  const d = dayRecord(p, now);
  d.a++;
  if (res.correct) d.c++;
  d.ms += Math.min(Math.round(res.ms || 0), 10000);
  return outcome;
}

/** Flash cards studied (self-graded, so they count as practice but not as correct answers). */
export function recordCards(p, n, now = Date.now()) {
  if (n > 0) dayRecord(p, now).f += n;
}

const KEEP_DAYS = 70;

function dayRecord(p, now) {
  p.lastActive = now;
  const days = (p.days ||= {});
  const key = dayKey(now);
  if (!days[key]) {
    days[key] = { c: 0, a: 0, ms: 0, f: 0 };
    const keys = Object.keys(days).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[old];
  }
  return days[key];
}

function bumpDaily(p, now) {
  const today = dayKey(now);
  if (p.daily.day !== today) p.daily = { day: today, correct: 0 };
  p.daily.correct++;
  if (p.daily.correct === DAILY_GOAL) {
    if (p.streak.last === yesterdayKey(now)) p.streak.count++;
    else if (p.streak.last !== today) p.streak.count = 1;
    p.streak.last = today;
  }
}

export function todayCorrect(p) {
  return p.daily.day === dayKey() ? p.daily.correct : 0;
}

/** Current streak (0 once a day has been missed). */
export function streakCount(p) {
  return p.streak.last === dayKey() || p.streak.last === yesterdayKey() ? p.streak.count : 0;
}

export function addXp(p, n) {
  const before = levelInfo(p.xp).level;
  p.xp += Math.max(0, Math.round(n));
  return levelInfo(p.xp).level > before;
}

export const BADGES = {
  cards12: { icon: '🃏', name: 'Card Shark', desc: 'Studied the flash cards for all 12 tables' },
  first_test: { icon: '🏅', name: 'First Mastery Check', desc: 'Finished your first Mastery Check' },
  combo10: { icon: '💥', name: 'Combo ×10', desc: '10 right answers in a row' },
  combo25: { icon: '🌟', name: 'Unstoppable', desc: '25 right answers in a row' },
  blitz30: { icon: '⚡', name: 'Blitz Master', desc: '30+ correct in a 60-second Blitz' },
  streak3: { icon: '🔥', name: 'On Fire', desc: 'Met your daily goal 3 days in a row' },
  streak7: { icon: '🗓️', name: 'Week Warrior', desc: 'Met your daily goal 7 days in a row' },
  boss1: { icon: '⚔️', name: 'Monster Hunter', desc: 'Defeated your first boss' },
  boss12: { icon: '🐲', name: 'Dragon Slayer', desc: 'Defeated all 12 bosses' },
  half: { icon: '🧗', name: 'Halfway Hero', desc: 'Memorized 39 of 78 facts' },
  all: { icon: '🏆', name: 'Times Table Champion', desc: `Memorized all ${TOTAL} facts` },
  perfect: { icon: '💯', name: 'Perfect Mastery Check', desc: `${TOTAL} of ${TOTAL} instant answers on a Mastery Check` },
};

/** Award any newly earned badges; returns the list of new ones. */
export function checkBadges(p, extra = {}) {
  const earned = [];
  const give = (id, cond) => {
    if (cond && !p.badges[id]) {
      p.badges[id] = Date.now();
      earned.push({ id, ...BADGES[id] });
    }
  };
  const mem = memorizedCount(p);
  const bossWins = Object.values(p.bosses).filter(b => b.stars > 0).length;
  give('cards12', Array.from({ length: 12 }, (_, i) => p.cards?.[i + 1]).every(Boolean));
  give('first_test', p.tests.some(t => !t.sum.reason));
  give('combo10', p.stats.bestCombo >= 10);
  give('combo25', p.stats.bestCombo >= 25);
  give('blitz30', p.blitzBest >= 30);
  give('streak3', p.streak.count >= 3);
  give('streak7', p.streak.count >= 7);
  give('boss1', bossWins >= 1);
  give('boss12', bossWins >= 12);
  give('half', mem >= 39);
  give('all', mem >= TOTAL);
  give('perfect', extra.perfect);
  return earned;
}

// ---------- in-progress test (so closing or reloading the page can't erase a bad test) ----------

export const getActiveTest = () => lsGet('active');
export const setActiveTest = t => lsSet('active', t);
export const clearActiveTest = () => lsSet('active', null);
