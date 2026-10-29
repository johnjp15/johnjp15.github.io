// Family: everyone in a family can see everyone's practice. This talks to the
// family server (server/). The invite link carries the family id and secret;
// each player (or watch-only grown-up) on this device has its own member token.

import { FAMILY_API } from './config.js';
import { lsGet, lsSet, DAILY_GOAL, levelInfo } from './store.js';
import { memorizedCount, tableMastery, MEMORIZED_BOX } from './srs.js';
import { dayKey } from './util.js';
import { TOTAL } from './facts.js';

const BOARD_MAX_AGE = 30000;

export function apiBase() {
  try {
    return localStorage.getItem('ttq:v1:api') || FAMILY_API; // override is for local testing
  } catch {
    return FAMILY_API;
  }
}

export const familyEnabled = () => !!apiBase();

/**
 * This device's family: { id, secret, name, tokens: { memberId: token },
 * viewer: { id, name } | null, removed: { memberId: true }, sent: { memberId: json },
 * board, fetched }
 */
export const getFamily = () => lsGet('family');
const saveFamily = f => lsSet('family', f);

async function api(path, { method = 'GET', body, secret, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (secret) headers['X-Family-Secret'] = secret;
  if (token) headers.Authorization = `Bearer ${token}`;
  // keepalive lets a sync finish even if the app is being closed.
  const res = await fetch(apiBase() + path, { method, headers, keepalive: method !== 'GET', body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw Object.assign(new Error(info.error || `Server error (${res.status})`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

export const inviteLink = f => new URL(`./#family=${f.id}.${f.secret}`, location.href).href;

export function parseInvite(fragment) {
  const [id, secret] = String(fragment).split('.');
  return /^[\w-]{12}$/.test(id || '') && /^[\w-]{20,}$/.test(secret || '') ? { id, secret } : null;
}

const newViewerId = () => `v${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')}`;

export async function createFamily(name) {
  const r = await api('/families', { method: 'POST', body: { name } });
  const f = { id: r.familyId, secret: r.secret, name: r.name, tokens: {}, viewer: null, removed: {}, sent: {} };
  saveFamily(f);
  return f;
}

/** Look up a family from an invite (checks the secret). */
export const peekFamily = invite => api(`/families/${invite.id}`, { secret: invite.secret });

async function join(f, member) {
  // An existing member's token proves it's really them re-joining.
  const r = await api(`/families/${f.id}/members`, { method: 'POST', secret: f.secret, token: f.tokens[member.memberId], body: member });
  f.tokens[member.memberId] = r.token;
  f.name = r.name;
  delete f.removed?.[member.memberId];
  delete f.sent?.[member.memberId]; // a fresh member record has no progress yet: send it again
  saveFamily(f);
}

/**
 * Join a family with these local players and/or as a watch-only grown-up.
 * Switching families leaves the old one first.
 */
export async function joinFamily(invite, { players = [], viewerName = null }) {
  const board = await peekFamily(invite);
  let f = getFamily();
  if (f && f.id !== invite.id) await leaveFamily().catch(() => {});
  f = getFamily();
  if (!f) f = { id: invite.id, secret: invite.secret, name: board.name, tokens: {}, viewer: null, removed: {}, sent: {} };
  for (const p of players) await join(f, { memberId: p.id, role: 'player', name: p.name, avatar: p.avatar });
  if (viewerName) {
    const id = f.viewer?.id || newViewerId();
    await join(f, { memberId: id, role: 'viewer', name: viewerName, avatar: 0 });
    f.viewer = { id, name: viewerName };
  }
  saveFamily(f);
  return f;
}

export async function leaveFamily() {
  const f = getFamily();
  if (!f) return;
  await Promise.all(Object.entries(f.tokens).map(([mid, token]) =>
    api(`/families/${f.id}/members/${mid}`, { method: 'DELETE', token }).catch(() => {})));
  lsSet('family', null);
}

/** Remove someone from the family (grown-up action). */
export async function removeMember(memberId) {
  const f = getFamily();
  await api(`/families/${f.id}/members/${memberId}`, { method: 'DELETE', secret: f.secret });
  delete f.tokens[memberId];
  if (f.viewer?.id === memberId) f.viewer = null;
  f.removed = { ...f.removed, [memberId]: true };
  saveFamily(f);
  return fetchBoard({ force: true });
}

/** Let someone a grown-up removed back in; their device rejoins on its next sync (grown-up action). */
export async function restoreMember(memberId) {
  const f = getFamily();
  await api(`/families/${f.id}/members/${memberId}/restore`, { method: 'POST', secret: f.secret });
  return fetchBoard({ force: true });
}

/** Put a removed player on this device back (grown-up action). */
export async function rejoinPlayer(p) {
  const f = getFamily();
  await restoreMember(p.id);
  await join(f, { memberId: p.id, role: 'player', name: p.name, avatar: p.avatar });
  return syncPlayer(p, { force: true });
}

// ---------- challenges (race someone's ghost) ----------

export async function createChallenge(p, seed, entry) {
  const f = getFamily();
  return api(`/families/${f.id}/challenges`, { method: 'POST', token: f.tokens[p.id], body: { memberId: p.id, seed, entry } });
}

export async function answerChallenge(p, challengeId, entry) {
  const f = getFamily();
  await api(`/families/${f.id}/challenges/${challengeId}/entries`, { method: 'POST', token: f.tokens[p.id], body: { memberId: p.id, entry } });
  f.fetched = 0;
  saveFamily(f);
}

/** Finished first, fastest first; then everyone else by how far they got. */
export function standings(entries) {
  return Object.entries(entries)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.ms == null) - (b.ms == null) || (a.ms ?? 0) - (b.ms ?? 0) || (b.correct ?? b.n ?? 0) - (a.correct ?? a.n ?? 0));
}

// ---------- what each player shares ----------

export function summarize(p) {
  const days = {};
  const d = new Date();
  for (let i = 0; i < 14; i++) {
    const key = dayKey(d.getTime());
    if (p.days?.[key]) days[key] = p.days[key];
    d.setDate(d.getDate() - 1);
  }
  const done = p.tests.filter(t => !t.sum.reason);
  const last = p.tests[p.tests.length - 1];
  const check = t => ({ seq: t.seq, start: t.start, instant: t.sum.instant, correct: t.sum.correct, asked: t.sum.asked, reason: t.sum.reason });
  return {
    v: 2,
    goal: DAILY_GOAL,
    total: TOTAL,
    days,
    streak: p.streak,
    memorized: memorizedCount(p),
    level: levelInfo(p.xp).level,
    lastActive: p.lastActive || null,
    bosses: Object.values(p.bosses).filter(b => b.stars > 0).length,
    blitzBest: p.blitzBest,
    lastCheck: last ? check(last) : null,
    bestCheck: done.length ? Math.max(...done.map(t => t.sum.instant)) : null,
    // For a grown-up's progress page.
    tables: Array.from({ length: 12 }, (_, i) => Math.round(tableMastery(p, i + 1) * 100)),
    practice: Object.entries(p.facts)
      .map(([key, st]) => ({ key, misses: st.n - st.c, b: st.b }))
      .filter(x => x.misses > 0 && x.b < MEMORIZED_BOX)
      .sort((x, y) => y.misses - x.misses || x.b - y.b)
      .slice(0, 8)
      .map(x => x.key),
    checks: p.tests.slice(-8).map(check),
    answers: p.stats.answers,
    correct: p.stats.correct,
    duels: p.versus ? { played: p.versus.duels, won: p.versus.duelWins } : null,
  };
}

/**
 * Share this player's latest progress with the family (quietly; failures are
 * retried next time). New players on a family device join automatically —
 * unless a grown-up removed them.
 */
function markRemoved(f, memberId) {
  delete f.tokens[memberId];
  f.removed = { ...f.removed, [memberId]: true };
  saveFamily(f);
}

/** Remember players the family board lists as removed by a grown-up. */
export function noteRemoved(memberIds) {
  const f = getFamily();
  if (f) for (const id of memberIds) markRemoved(f, id);
}

export async function syncPlayer(p, { force = false } = {}) {
  let f = getFamily();
  if (!f || !familyEnabled()) return;
  // The board can say a grown-up removed this player before our token is ever refused.
  if (!f.removed?.[p.id] && f.board?.removed?.some(x => x.memberId === p.id)) markRemoved(f, p.id);
  if (f.removed?.[p.id]) {
    // Rejoin once a grown-up has added this player back.
    const board = (await fetchBoard({ force: true }))?.board;
    if (!board?.removed || board.removed.some(x => x.memberId === p.id)) return;
    f = getFamily();
  }
  try {
    if (!f.tokens[p.id]) await join(f, { memberId: p.id, role: 'player', name: p.name, avatar: p.avatar });
    const body = JSON.stringify({ name: p.name, avatar: p.avatar, summary: summarize(p) });
    if (!force && f.sent?.[p.id] === body) return;
    await api(`/families/${f.id}/members/${p.id}`, { method: 'PUT', token: f.tokens[p.id], body: JSON.parse(body) });
    const fresh = getFamily();
    if (fresh?.id === f.id) {
      fresh.sent = { ...fresh.sent, [p.id]: body };
      fresh.fetched = 0; // the board is now out of date
      saveFamily(fresh);
    }
  } catch (e) {
    if (e.status === 403) {
      // Our token no longer works: a grown-up removed this player.
      const fresh = getFamily();
      if (fresh?.id === f.id) markRemoved(fresh, p.id);
    }
  }
}

/** The family board (cached for 30 s). Returns { board, offline } or null when not in a family. */
export async function fetchBoard({ force = false } = {}) {
  const f = getFamily();
  if (!f || !familyEnabled()) return null;
  if (!force && f.board && Date.now() - (f.fetched || 0) < BOARD_MAX_AGE) return { board: f.board, fetchedAt: f.fetched };
  try {
    const board = await api(`/families/${f.id}`, { secret: f.secret });
    const fresh = getFamily();
    if (fresh?.id !== f.id) return null;
    fresh.board = board;
    fresh.fetched = Date.now();
    saveFamily(fresh);
    return { board, fetchedAt: fresh.fetched };
  } catch (e) {
    if (e.status === 403 || e.status === 404) return { board: f.board || null, gone: true };
    return f.board ? { board: f.board, fetchedAt: f.fetched, offline: true } : { board: null, offline: true };
  }
}

// ---------- reading a board ----------

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
};

/** Today's practice for a member, using this device's calendar day. */
export function todayOf(m) {
  const s = m.summary;
  const d = s?.days?.[dayKey()];
  const goal = s?.goal || DAILY_GOAL;
  return { correct: d?.c || 0, cards: d?.f || 0, goal, done: (d?.c || 0) >= goal, started: !!d };
}

export function streakOf(m) {
  const st = m.summary?.streak;
  return st && (st.last === dayKey() || st.last === yesterday()) ? st.count : 0;
}

/** The last 7 days, oldest first: { key, weekday, state: 'goal'|'some'|'none' }. */
export function weekOf(m) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const key = dayKey(d.getTime());
    const rec = m.summary?.days?.[key];
    const goal = m.summary?.goal || DAILY_GOAL;
    out.push({
      key,
      weekday: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      state: rec && rec.c >= goal ? 'goal' : rec && rec.a + rec.f > 0 ? 'some' : 'none',
      correct: rec?.c || 0,
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Days in a row (ending today, or yesterday if today isn't finished) where every player hit the goal. */
export function familyStreak(players) {
  if (!players.length) return 0;
  const allMet = key => players.every(m => (m.summary?.days?.[key]?.c || 0) >= (m.summary?.goal || DAILY_GOAL));
  const d = new Date();
  if (!allMet(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (n < 14 && allMet(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
