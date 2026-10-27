// Room-code races: phones connect directly to each other (WebRTC via PeerJS).
// The host's phone shows a 4-digit code; others type it to join. PeerJS's free
// public server only introduces the phones; the race itself goes phone to phone
// (through PeerJS's relay when networks don't allow a direct link). The host
// runs the room: it relays progress and decides the results.

import { lsGet } from './store.js';
import { newSeed, RACE_MAX_MS } from './race.js';

const PEER_SCRIPT = new URL('./vendor/peerjs-1.5.5.min.js', import.meta.url).href;
const PREFIX = 'ttq-race-';
const MAX_PLAYERS = 4;
const START_DELAY_MS = 4000;
const CONNECT_TIMEOUT_MS = 12000;

let loading = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEER_SCRIPT;
    s.onload = () => resolve(window.Peer);
    s.onerror = () => { loading = null; reject(new Error('Couldn\'t load the live-race connector. Check the internet connection.')); };
    document.head.append(s);
  });
  return loading;
}

// Tests point this at a local PeerJS server: localStorage['ttq:v1:peerServer'] = {host, port, path, secure}
const peerOptions = () => ({ debug: 0, ...(lsGet('peerServer') || {}) });

const waitFor = (target, ok, fail, ms, timeoutMsg) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(timeoutMsg)), ms);
  target.once(ok, v => { clearTimeout(timer); resolve(v); });
  target.once(fail, e => { clearTimeout(timer); reject(e); });
});

/** A tiny event emitter shared by host and guest rooms. */
function emitter() {
  const fns = new Set();
  let last = null;
  return {
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    emit(type, data) {
      if (type === 'result') last = data;
      if (type === 'start') last = null;
      for (const fn of [...fns]) fn(type, data);
    },
    /** Results of the latest finished race (null while one is running). */
    lastResult: () => last,
  };
}

const publicPlayers = players => players.map(({ conn, ...p }) => p);

/**
 * Host a room. me: { name, avatar }.
 * Room events: 'lobby' (players), 'start' ({ seed, startAt }), 'progress' ({ id, n }),
 * 'result' (players), 'closed' (reason).
 */
export async function hostRoom(me) {
  const Peer = await loadPeer();
  let peer = null;
  let code = null;
  for (let tries = 0; tries < 6 && !peer; tries++) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    const p = new Peer(PREFIX + code, peerOptions());
    try {
      await waitFor(p, 'open', 'error', CONNECT_TIMEOUT_MS, 'Couldn\'t reach the live-race connector.');
      peer = p;
    } catch (e) {
      p.destroy();
      if (e?.type !== 'unavailable-id') throw new Error(e?.type === 'network' || e?.type === 'server-error' ? 'Couldn\'t reach the live-race connector. Check the internet connection.' : e.message);
    }
  }
  if (!peer) throw new Error('Couldn\'t get a race code. Try again.');

  const ev = emitter();
  const players = [{ id: 'host', name: me.name, avatar: me.avatar, n: 0, wrong: 0, ms: null, done: false, dnf: false }];
  let state = 'lobby';
  let race = null;
  let deadline = null;

  const send = (conn, msg) => { try { conn.open && conn.send(msg); } catch { /* gone */ } };
  const broadcast = msg => players.forEach(p => p.conn && send(p.conn, msg));
  const lobby = () => { const list = publicPlayers(players); broadcast({ t: 'lobby', players: list, state }); ev.emit('lobby', list); };
  const result = () => {
    if (state !== 'running' || !players.every(p => p.done)) return;
    state = 'done';
    clearTimeout(deadline);
    const list = publicPlayers(players);
    broadcast({ t: 'result', players: list });
    ev.emit('result', list);
  };

  peer.on('connection', conn => {
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      const p = players.find(x => x.conn === conn);
      if (msg.t === 'ping') return send(conn, { t: 'pong', t0: msg.t0 });
      if (msg.t === 'hello') {
        if (p) return;
        if (state !== 'lobby' && state !== 'done') return send(conn, { t: 'full', reason: 'That race already started.' });
        if (players.length >= MAX_PLAYERS) return send(conn, { t: 'full', reason: 'That race is full.' });
        players.push({ id: conn.peer, conn, name: String(msg.name || 'Player').slice(0, 20), avatar: msg.avatar, n: 0, wrong: 0, ms: null, done: false, dnf: false });
        return lobby();
      }
      if (!p || state !== 'running' || p.done) return;
      if (msg.t === 'progress') {
        Object.assign(p, { n: Number(msg.n) || 0, wrong: Number(msg.wrong) || 0 });
        broadcast({ t: 'progress', id: p.id, n: p.n });
        ev.emit('progress', { id: p.id, n: p.n });
      }
      if (msg.t === 'finish') {
        Object.assign(p, { n: Number(msg.n) || 0, wrong: Number(msg.wrong) || 0, done: true, dnf: msg.ms == null, ms: msg.ms == null ? null : Number(msg.ms) });
        result();
      }
    });
    conn.on('close', () => {
      const i = players.findIndex(x => x.conn === conn);
      if (i < 0) return;
      if (state === 'running') {
        Object.assign(players[i], { done: true, dnf: true, gone: true });
        delete players[i].conn;
        result();
      } else players.splice(i, 1);
      lobby();
    });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* destroyed */ } });

  return {
    code,
    isHost: true,
    on: ev.on,
    lastResult: ev.lastResult,
    players: () => publicPlayers(players),
    /** Start (or restart) a race for everyone in the room. */
    start() {
      if (players.length < 2 || state === 'running') return;
      state = 'running';
      race = { seed: newSeed() };
      for (const p of players) Object.assign(p, { n: 0, wrong: 0, ms: null, done: false, dnf: false });
      for (let i = players.length - 1; i > 0; i--) if (players[i].gone) players.splice(i, 1);
      broadcast({ t: 'start', seed: race.seed, delay: START_DELAY_MS, players: publicPlayers(players) });
      ev.emit('start', { seed: race.seed, startAt: Date.now() + START_DELAY_MS, players: publicPlayers(players) });
      // Close out the race even if someone's phone went quiet.
      deadline = setTimeout(() => {
        for (const p of players) if (!p.done) Object.assign(p, { done: true, dnf: true });
        result();
      }, START_DELAY_MS + RACE_MAX_MS + 15000);
    },
    progress(n, wrong) {
      Object.assign(players[0], { n, wrong });
      broadcast({ t: 'progress', id: 'host', n });
    },
    finish({ correct, wrong, ms }) {
      Object.assign(players[0], { n: correct, wrong, ms: ms ?? null, done: true, dnf: ms == null });
      result();
    },
    close() {
      broadcast({ t: 'closed', reason: 'The host left.' });
      clearTimeout(deadline);
      setTimeout(() => peer.destroy(), 300);
    },
  };
}

/** Join a room by its 4-digit code. Same events as hostRoom. */
export async function joinRoom(code, me) {
  const Peer = await loadPeer();
  const peer = new Peer(peerOptions());
  await waitFor(peer, 'open', 'error', CONNECT_TIMEOUT_MS, 'Couldn\'t reach the live-race connector.').catch(e => {
    peer.destroy();
    throw new Error(e?.type === 'network' || e?.type === 'server-error' ? 'Couldn\'t reach the live-race connector. Check the internet connection.' : e.message);
  });
  const conn = peer.connect(PREFIX + code, { reliable: true });
  const ev = emitter();
  let players = [];
  let rtt = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Couldn\'t connect to that phone. Check the code, and try both phones on the same Wi-Fi.')), CONNECT_TIMEOUT_MS);
      conn.once('open', () => { clearTimeout(timer); resolve(); });
      peer.once('error', e => { clearTimeout(timer); reject(new Error(e?.type === 'peer-unavailable' ? `There's no race with the code ${code}.` : 'Couldn\'t connect to that phone.')); });
    });
  } catch (e) {
    peer.destroy();
    throw e;
  }

  conn.on('data', msg => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'pong': rtt = Date.now() - msg.t0; break;
      case 'lobby': players = msg.players; ev.emit('lobby', players); break;
      case 'start':
        players = msg.players;
        // The host started its countdown when it sent this; allow for the trip here.
        ev.emit('start', { seed: msg.seed, startAt: Date.now() + msg.delay - rtt / 2, players });
        break;
      case 'progress': ev.emit('progress', { id: msg.id === conn.peer ? 'host' : msg.id, n: msg.n }); break;
      case 'result': players = msg.players; ev.emit('result', players); break;
      case 'full': ev.emit('closed', msg.reason); peer.destroy(); break;
      case 'closed': ev.emit('closed', msg.reason); break;
      default:
    }
  });
  conn.on('close', () => ev.emit('closed', 'Lost the connection to the host.'));
  const send = msg => { try { conn.open && conn.send(msg); } catch { /* gone */ } };
  send({ t: 'ping', t0: Date.now() });
  send({ t: 'hello', name: me.name, avatar: me.avatar });

  return {
    code,
    isHost: false,
    myId: peer.id,
    on: ev.on,
    lastResult: ev.lastResult,
    players: () => players,
    progress(n, wrong) { send({ t: 'progress', n, wrong }); },
    finish({ correct, wrong, ms }) { send({ t: 'finish', n: correct, wrong, ms: ms ?? null }); },
    close() { setTimeout(() => peer.destroy(), 200); },
  };
}
