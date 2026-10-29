// Room-code games: phones connect directly to each other (WebRTC via PeerJS).
// The host's phone shows a 4-digit code; others type it to join. PeerJS's free
// public server only introduces the phones; the game itself goes phone to phone
// (through PeerJS's relay when networks don't allow a direct link). The host
// runs the room: it runs the game mode's referee (versus.js) on everyone's
// answers and sends the game state to every phone.

import { lsGet } from './store.js';
import { newSeed } from './race.js';
import { modeOf, act, unfit } from './versus.js';

const PEER_SCRIPT = new URL('./vendor/peerjs-1.5.5.min.js', import.meta.url).href;
const PREFIX = 'ttq-race-';
const MAX_PLAYERS = 4;
const START_DELAY_MS = 4000;
const CONNECT_TIMEOUT_MS = 12000;
// Guests ping every HEARTBEAT_MS and the host answers; a phone silent for SILENT_MS is gone.
const HEARTBEAT_MS = 2000;
const SILENT_MS = 10000;

/** Every HEARTBEAT_MS; tells fn when this page was frozen (iOS pauses background pages), so silence isn't blamed on others. */
function every(fn) {
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    fn(now, now - last > HEARTBEAT_MS * 3);
    last = now;
  }, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

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

const publicPlayers = players => players.map(({ conn, seen, ...p }) => p);

// Only these answer fields reach the referee.
const cleanEvent = e => ({ correct: !!e?.correct, fast: !!e?.fast, timeout: !!e?.timeout, heal: !!e?.heal, quit: !!e?.quit });

/**
 * Host a room for a game mode (versus.js); me: { name, avatar }.
 * Room events: 'lobby' (players), 'start' ({ seed, mode, st, startAt, players }),
 * 'st' ({ st, fx }) after every answer, 'result' ({ mode, st, players }), 'closed' (reason).
 */
export async function hostRoom(me, modeId = 'race') {
  const Peer = await loadPeer();
  let peer = null;
  let code = null;
  for (let tries = 0; tries < 6 && !peer; tries++) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    const p = new Peer(PREFIX + code, peerOptions());
    try {
      await waitFor(p, 'open', 'error', CONNECT_TIMEOUT_MS, 'Couldn\'t reach the live-game connector.');
      peer = p;
    } catch (e) {
      p.destroy();
      if (e?.type !== 'unavailable-id') throw new Error(e?.type === 'network' || e?.type === 'server-error' ? 'Couldn\'t reach the live-game connector. Check the internet connection.' : e.message);
    }
  }
  if (!peer) throw new Error('Couldn\'t get a game code. Try again.');

  const ev = emitter();
  const players = [{ id: 'host', name: me.name, avatar: me.avatar }];
  let state = 'lobby';
  let selected = modeOf(modeId).id;
  let game = null; // { seed, mode, startAt, st }
  let deadline = null;

  const send = (conn, msg) => { try { conn.open && conn.send(msg); } catch { /* gone */ } };
  const broadcast = msg => players.forEach(p => p.conn && send(p.conn, msg));
  const lobby = () => {
    const list = publicPlayers(players);
    broadcast({ t: 'lobby', players: list, state, mode: selected });
    ev.emit('lobby', list);
  };
  const result = (force = false) => {
    if (state !== 'running') return;
    if (!force && !modeOf(game.mode).over(game.st, Date.now() - game.startAt)) return;
    state = 'done';
    clearTimeout(deadline);
    const msg = { mode: game.mode, st: game.st, players: publicPlayers(players) };
    broadcast({ t: 'result', ...msg });
    ev.emit('result', msg);
  };
  // Someone answered (or left): run the referee and tell everyone.
  const play = (id, e) => {
    if (state !== 'running') return;
    const fx = act(modeOf(game.mode), game.st, id, e, Math.max(0, Date.now() - game.startAt));
    if (!fx) return;
    const msg = { st: game.st, fx: { from: id, ...fx } };
    broadcast({ t: 'st', ...msg });
    ev.emit('st', msg);
    result();
  };
  const drop = conn => {
    const i = players.findIndex(x => x.conn === conn);
    if (i < 0) return;
    if (state === 'running') {
      players[i].gone = true;
      delete players[i].conn;
      play(players[i].id, { quit: true });
    } else players.splice(i, 1);
    lobby();
  };
  const stopWatch = every((now, frozen) => {
    for (const p of [...players]) {
      if (!p.conn) continue;
      if (frozen) p.seen = now;
      else if (now - p.seen > SILENT_MS) {
        const { conn } = p;
        drop(conn);
        try { conn.close(); } catch { /* gone */ }
      }
    }
  });

  peer.on('connection', conn => {
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      const p = players.find(x => x.conn === conn);
      if (p) p.seen = Date.now();
      if (msg.t === 'ping') return send(conn, { t: 'pong', t0: msg.t0 });
      if (msg.t === 'hello') {
        if (p) return;
        if (state === 'running') return send(conn, { t: 'full', reason: 'That game already started.' });
        if (players.length >= MAX_PLAYERS) return send(conn, { t: 'full', reason: 'That game is full.' });
        players.push({ id: conn.peer, conn, seen: Date.now(), name: String(msg.name || 'Player').slice(0, 20), avatar: msg.avatar });
        return lobby();
      }
      if (p && msg.t === 'ev') play(p.id, cleanEvent(msg.ev));
    });
    conn.on('close', () => drop(conn));
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* destroyed */ } });

  return {
    code,
    isHost: true,
    on: ev.on,
    lastResult: ev.lastResult,
    players: () => publicPlayers(players).filter(p => !p.gone),
    mode: () => selected,
    /** Pick the game the next start plays. */
    select(id) {
      selected = modeOf(id).id;
      lobby();
    },
    /** Why the room can't start now, or null. */
    blocked: () => unfit(modeOf(selected), players.filter(p => !p.gone).length),
    /** Start (or restart) the selected game for everyone in the room. */
    start() {
      if (state === 'running') return;
      for (let i = players.length - 1; i > 0; i--) if (players[i].gone) players.splice(i, 1);
      const mode = modeOf(selected);
      if (unfit(mode, players.length)) return;
      state = 'running';
      game = { seed: newSeed(), mode: mode.id, startAt: Date.now() + START_DELAY_MS, st: mode.init(players.map(p => p.id)) };
      const list = publicPlayers(players);
      broadcast({ t: 'start', seed: game.seed, mode: game.mode, st: game.st, delay: START_DELAY_MS, players: list });
      ev.emit('start', { seed: game.seed, mode: game.mode, st: game.st, startAt: game.startAt, players: list });
      // Close out the game even if a phone went quiet (timed modes end here too).
      deadline = setTimeout(() => result(true), START_DELAY_MS + mode.maxMs + 2500);
    },
    /** The host's own answers. */
    event(e) { play('host', cleanEvent(e)); },
    close() {
      broadcast({ t: 'closed', reason: 'The host left.' });
      clearTimeout(deadline);
      stopWatch();
      setTimeout(() => peer.destroy(), 300);
    },
  };
}

/** Join a room by its 4-digit code. Same events as hostRoom. */
export async function joinRoom(code, me) {
  const Peer = await loadPeer();
  const peer = new Peer(peerOptions());
  await waitFor(peer, 'open', 'error', CONNECT_TIMEOUT_MS, 'Couldn\'t reach the live-game connector.').catch(e => {
    peer.destroy();
    throw new Error(e?.type === 'network' || e?.type === 'server-error' ? 'Couldn\'t reach the live-game connector. Check the internet connection.' : e.message);
  });
  const conn = peer.connect(PREFIX + code, { reliable: true });
  const ev = emitter();
  let players = [];
  let rtt = 0;
  let mode = 'race';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Couldn\'t connect to that phone. Check the code, and try both phones on the same Wi-Fi.')), CONNECT_TIMEOUT_MS);
      conn.once('open', () => { clearTimeout(timer); resolve(); });
      peer.once('error', e => { clearTimeout(timer); reject(new Error(e?.type === 'peer-unavailable' ? `There's no game with the code ${code}.` : 'Couldn\'t connect to that phone.')); });
    });
  } catch (e) {
    peer.destroy();
    throw e;
  }

  let heard = Date.now();
  let ended = false;
  const end = reason => {
    if (ended) return;
    ended = true;
    stopWatch();
    ev.emit('closed', reason);
  };
  const stopWatch = every((now, frozen) => {
    if (frozen) heard = now;
    send({ t: 'ping', t0: now });
    if (now - heard > SILENT_MS) { end('Lost the connection to the host.'); peer.destroy(); }
  });

  conn.on('data', msg => {
    if (!msg || typeof msg !== 'object') return;
    heard = Date.now();
    switch (msg.t) {
      case 'pong': rtt = Date.now() - msg.t0; break;
      case 'lobby':
        players = msg.players;
        mode = msg.mode || mode;
        ev.emit('lobby', players);
        break;
      case 'start':
        players = msg.players;
        mode = msg.mode;
        // The host started its countdown when it sent this; allow for the trip here.
        ev.emit('start', { seed: msg.seed, mode, st: msg.st, startAt: Date.now() + msg.delay - rtt / 2, players });
        break;
      case 'st': ev.emit('st', { st: msg.st, fx: msg.fx }); break;
      case 'result':
        players = msg.players;
        ev.emit('result', { mode: msg.mode, st: msg.st, players });
        break;
      case 'full': end(msg.reason); peer.destroy(); break;
      case 'closed': end(msg.reason); break;
      default:
    }
  });
  conn.on('close', () => end('Lost the connection to the host.'));
  const send = msg => { try { conn.open && conn.send(msg); } catch { /* gone */ } };
  send({ t: 'ping', t0: Date.now() });
  send({ t: 'hello', name: me.name, avatar: me.avatar });

  return {
    code,
    isHost: false,
    myId: peer.id,
    on: ev.on,
    lastResult: ev.lastResult,
    players: () => players.filter(p => !p.gone),
    mode: () => mode,
    event(e) { send({ t: 'ev', ev: e }); },
    close() { ended = true; stopWatch(); setTimeout(() => peer.destroy(), 200); },
  };
}
