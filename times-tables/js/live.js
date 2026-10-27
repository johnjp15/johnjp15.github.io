// Live connection to the family server while the app is open: who's online,
// race invites, and progress during live races.

import { apiBase, familyEnabled, getFamily } from './family.js';

const listeners = new Set();
export const liveState = { online: [], races: {}, offset: 0, me: null, connected: false };

let ws = null;
let member = null;
let retry = 0;
let retryTimer = null;
const outbox = []; // sent while reconnecting; delivered after the next hello

const emit = (type, data) => { for (const fn of listeners) fn(type, data); };

/** Listen to live events: fn(type, data). Returns an unsubscribe function. */
export function onLive(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Server time, as best we know it (for synced starts). */
export const serverNow = () => Date.now() + liveState.offset;
export const toLocal = serverTs => serverTs - liveState.offset;

export function liveSend(msg) {
  if (ws?.readyState === 1 && liveState.connected) ws.send(JSON.stringify(msg));
  else if (msg.t !== 'progress') {
    outbox.push(msg);
    if (outbox.length > 20) outbox.shift();
  }
}

/** Connect as this player (or reconnect as a different one). */
export function connectLive(memberId) {
  member = memberId;
  open();
}

export function disconnectLive() {
  member = null;
  close();
}

function close() {
  clearTimeout(retryTimer);
  if (ws) {
    ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
  }
  ws = null;
  liveState.connected = false;
}

function open() {
  close();
  const f = getFamily();
  const token = f?.tokens?.[member];
  if (!member || !token || !familyEnabled() || document.visibilityState === 'hidden') return;
  const url = `${apiBase().replace(/^http/, 'ws')}/families/${f.id}/live?member=${encodeURIComponent(member)}&token=${encodeURIComponent(token)}`;
  try {
    ws = new WebSocket(url);
  } catch {
    return scheduleRetry();
  }
  ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.t) {
      case 'hello':
        retry = 0;
        liveState.connected = true;
        liveState.offset = msg.now - Date.now();
        liveState.me = msg.me;
        liveState.online = msg.online;
        // Keep races we already know about (results screens), but drop lobbies that closed while we were away.
        for (const [id, r] of Object.entries(liveState.races)) if (r.state === 'lobby') delete liveState.races[id];
        for (const r of msg.races) liveState.races[r.id] = r;
        for (const m of outbox.splice(0)) ws.send(JSON.stringify(m));
        emit('hello', msg);
        break;
      case 'presence':
        liveState.online = msg.online;
        emit('presence', msg.online);
        break;
      case 'race':
        liveState.races[msg.race.id] = msg.race;
        emit('race', msg.race);
        break;
      case 'progress': {
        const p = liveState.races[msg.id]?.players?.[msg.member];
        if (p) Object.assign(p, { n: msg.n, wrong: msg.wrong });
        emit('progress', msg);
        break;
      }
      case 'challenge':
        emit('challenge', msg);
        break;
      default:
    }
  };
  ws.onclose = () => {
    liveState.connected = false;
    emit('presence', []);
    scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!member || document.visibilityState === 'hidden') return;
  const wait = Math.min(30000, 1000 * 2 ** retry++);
  retryTimer = setTimeout(open, wait);
}

// Only stay connected while the app is on screen.
document.addEventListener('visibilitychange', () => {
  if (!member) return;
  if (document.visibilityState === 'hidden') close();
  else open();
});
