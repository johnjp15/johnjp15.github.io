// A Versus game on your own phone (room-code games) on the regular game engine.
// The host's phone runs the referee (versus.js) and sends everyone the state;
// this phone shows the latest state it got, and works out its own answers'
// effects straight away so feedback doesn't wait for the network.

import { h } from './util.js';
import { recordAnswer, savePlayer } from './store.js';
import { raceStream, fmtRace } from './race.js';
import { PENALTY_MS, act, laneInfo } from './versus.js';
import { sfx } from './sfx.js';
import { shake } from './fx.js';

/**
 * mode: from versus.js; people: { id: { name, avatar } }; st: the game state at the start.
 * onEvent(e) sends this player's answers to the referee; setState() shows its replies;
 * end() stops the game (results are in, or the room closed).
 */
export function versusMode(player, { mode, seed, myId, people, st, startAt, onEvent }) {
  const nextFact = raceStream(seed);
  let correct = 0;
  let wrong = 0;
  let t0 = null;
  let over = false;
  let armed = false;
  let clock;
  let lanesEl;
  let potionBtn;
  const rows = new Map();
  const at = () => (t0 ? Date.now() - t0 : 0);

  const draw = (hit = []) => {
    for (const l of laneInfo(mode, st, people, myId)) {
      let r = rows.get(l.key);
      if (!r) {
        const fill = h('i');
        const text = h('b');
        r = { fill, text, row: h('div', null, h('span', { class: 'race-av' }, l.avatar), h('span', { class: 'race-name' }, l.name), h('span', { class: 'race-track' }, fill), text) };
        rows.set(l.key, r);
        lanesEl.append(r.row);
      }
      r.row.className = `race-lane ${l.me ? 'me' : ''} ${l.cls || ''}`;
      r.fill.style.width = `${Math.max(0, Math.min(1, l.frac)) * 100}%`;
      r.text.textContent = l.text;
      if (l.ids.some(id => hit.includes(id))) shake(r.row);
    }
    if (potionBtn) {
      const n = st.p[myId]?.potions ?? 0;
      if (!n) armed = false;
      potionBtn.textContent = armed ? '🧪 Heal ready!' : `🧪 Heal ×${n}`;
      potionBtn.classList.toggle('armed', armed);
      potionBtn.disabled = !n;
    }
    if (mode.out(st, myId) || mode.over(st, at())) over = true;
  };

  return {
    id: 'race',
    music: mode.music,
    limit: mode.limit(st, 0),
    limitNow: () => mode.limit(st, at()),
    countdown: true,
    startAt,
    introIcon: mode.icon,
    introTitle: mode.name,
    introText: mode.rules[0],
    /** The referee's latest state; fx.hit lists who just got hurt. */
    setState(next, fx = {}) {
      const hurt = fx.hit?.includes(myId) && fx.from !== myId;
      st = next;
      draw(fx.from === myId ? [] : fx.hit);
      if (hurt) sfx.hurt();
    },
    end() { over = true; },
    init(r) {
      if (mode.potions) {
        potionBtn = h('button', { class: 'potion-btn', type: 'button', onclick: () => { armed = !armed; sfx.coin(); draw(); } });
      }
      r.hud.append(h('div', { class: 'hud-title' }, `${mode.icon} ${mode.name}`), potionBtn || '', h('div', { class: 'hud-stat' }, '⏱ ', (clock = h('b', null, ''))));
      r.stage.append((lanesEl = h('div', { class: 'race-lanes' })));
      draw();
    },
    start() { t0 = Date.now(); },
    tick(r) {
      if (!t0) return;
      clock.textContent = mode.clock ? mode.clock(at()) : fmtRace(at());
      if (over || at() > mode.maxMs) r.finish();
    },
    next() { return nextFact(); },
    answer(r, q, res) {
      recordAnswer(player, q, res);
      const e = { correct: res.correct, fast: res.fast, timeout: res.timeout, heal: !!(mode.potions && armed && res.correct) };
      if (e.heal) armed = false;
      const fx = act(mode, st, myId, e, at()) || {};
      draw(fx.hit?.filter(id => id !== myId));
      onEvent(e);
      if (res.correct) correct++;
      else wrong++;
      if (over) return { text: fx.text, reveal: true, end: true, delay: res.correct ? 500 : PENALTY_MS };
      return res.correct ? { text: fx.text, delay: 220 } : { reveal: true, text: fx.text, delay: PENALTY_MS };
    },
    leave() {
      return { icon: '👀', title: 'Welcome back!', text: 'The game kept going, and that question was skipped — no peeking!' };
    },
    finish(r, { quit } = {}) {
      savePlayer(player);
      return { correct, wrong, quit: !!quit && !over };
    },
  };
}
