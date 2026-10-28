// Battle: everyone has a health bar. A correct answer attacks (harder when it's
// fast), a potion turns your next correct answer into a heal, and a wrong answer
// hurts you a little. Last one standing wins; after BATTLE_MAX_MS the most health
// wins. Shared by Duel (one phone) and room battles (phone to phone).

import { h } from './util.js';
import { AVATARS, recordAnswer, savePlayer } from './store.js';
import { PENALTY_MS, raceStream, fmtRace } from './race.js';
import { sfx } from './sfx.js';
import { shake } from './fx.js';

export const MAX_HP = 100;
export const BATTLE_MAX_MS = 3 * 60000;
export const AMOUNT = { hit: 10, crit: 15, heal: 20, trip: 5 };
const MAX_POTIONS = 3;
const POTION_STREAK = 3; // a potion for every 3 correct in a row

/** What one answer does: 'crit' (fast and correct), 'hit', 'heal' or 'trip' (wrong). */
export const moveFor = ({ correct, fast }, healing) => (!correct ? 'trip' : healing ? 'heal' : fast ? 'crit' : 'hit');

export const newFighters = ids => Object.fromEntries(ids.map(id => [id, { hp: MAX_HP, ko: null }]));
export const standing = fighters => Object.keys(fighters).filter(id => fighters[id].ko == null);

/**
 * Apply a move to fighters ({ id: { hp, ko } }). Attacks hit whoever has the most
 * health, so nobody gets ganged up on. at: battle time (ms). Returns { target, amount } or null.
 */
export function applyMove(fighters, from, move, at) {
  const me = fighters[from];
  if (!me || me.ko != null || !AMOUNT[move]) return null;
  let target = from;
  if (move === 'heal') me.hp = Math.min(MAX_HP, me.hp + AMOUNT.heal);
  else if (move === 'trip') me.hp = Math.max(0, me.hp - AMOUNT.trip);
  else {
    const foes = standing(fighters).filter(id => id !== from).sort((a, b) => fighters[b].hp - fighters[a].hp);
    if (!foes.length) return null;
    target = foes[0];
    fighters[target].hp = Math.max(0, fighters[target].hp - AMOUNT[move]);
  }
  if (fighters[target].hp <= 0) fighters[target].ko = at;
  return { target, amount: AMOUNT[move] };
}

/** Still standing first (most health first), then knocked out (last one out first). */
export const battleOrder = fighters => Object.keys(fighters)
  .sort((a, b) => (fighters[a].ko != null) - (fighters[b].ko != null) || fighters[b].hp - fighters[a].hp || (fighters[b].ko ?? 0) - (fighters[a].ko ?? 0));

export const moveText = (move, amount) => ({ crit: `⚡ Critical hit! −${amount}`, hit: `⚔️ Hit! −${amount}`, heal: `💚 Healed +${amount}`, trip: `💥 Ouch! −${amount} · +1.5s` })[move];

/** Potions: one to start, one more for every POTION_STREAK correct in a row. */
export function potions(onChange) {
  const s = { count: 1, armed: false, streak: 0 };
  return {
    get armed() { return s.armed && s.count > 0; },
    get count() { return s.count; },
    toggle() { if (s.count > 0) s.armed = !s.armed; onChange(s); },
    /** After an answer; returns true when the answer used the potion. */
    answered(correct) {
      let used = false;
      if (correct) {
        if (s.armed && s.count > 0) { s.count--; s.armed = false; used = true; }
        if (++s.streak % POTION_STREAK === 0 && s.count < MAX_POTIONS) s.count++;
      } else s.streak = 0;
      onChange(s);
      return used;
    },
  };
}

export const potionLabel = s => `🧪 ${s.armed && s.count > 0 ? 'Heal ready!' : `Heal ×${s.count}`}`;

/** Health bar row (used in races' lane style). */
export function hpRow(name, avatar, cls = '') {
  const fill = h('i');
  const value = h('b', null, `${MAX_HP}`);
  const row = h('div', { class: `race-lane hp-lane ${cls}` },
    h('span', { class: 'race-av' }, avatar), h('span', { class: 'race-name' }, name),
    h('span', { class: 'race-track' }, fill), value);
  return {
    row,
    set({ hp, ko }) {
      fill.style.width = `${(hp / MAX_HP) * 100}%`;
      row.classList.toggle('hp-mid', hp <= 50);
      row.classList.toggle('hp-low', hp <= 25);
      row.classList.toggle('ko', ko != null);
      value.textContent = ko != null ? '💥' : `${hp}`;
    },
    flash() { shake(row); },
  };
}

/**
 * A phone-to-phone battle on the regular game engine. The room's host decides the
 * health of everyone: onMove(move) reports this player's moves, setFighters() shows
 * the host's latest state, and end() stops the game when the battle is over.
 * foes: [{ id, name, avatar }]; myId: this player's id in fighters.
 */
export function battleMode(player, { seed, myId, foes, startAt, onMove }) {
  const nextFact = raceStream(seed);
  let correct = 0;
  let wrong = 0;
  let t0 = null;
  let over = false;
  let clock;
  let potionBtn;
  const rows = new Map();
  const shown = {};
  const pot = potions(s => {
    if (!potionBtn) return;
    potionBtn.textContent = potionLabel(s);
    potionBtn.classList.toggle('armed', s.armed && s.count > 0);
    potionBtn.disabled = s.count === 0;
  });
  const avatarOf = a => (typeof a === 'number' ? AVATARS[a] || '🙂' : a);

  return {
    id: 'race',
    music: 'battle',
    limit: 8000,
    countdown: true,
    startAt,
    introIcon: '⚔️',
    introTitle: 'Battle!',
    introText: 'Right answers attack, fast ones hit harder. Tap 🧪 to heal with your next right answer.',
    /** fighters: { id: { hp, ko } } from the host. */
    setFighters(fighters) {
      for (const [id, f] of Object.entries(fighters)) {
        const r = rows.get(id);
        if (!r) continue;
        if (shown[id] != null && f.hp < shown[id]) {
          r.flash();
          if (id === myId) sfx.hurt();
        }
        shown[id] = f.hp;
        r.set(f);
      }
      if (fighters[myId]?.ko != null || standing(fighters).length <= 1) over = true;
    },
    end() { over = true; },
    init(r) {
      potionBtn = h('button', { class: 'potion-btn', type: 'button', onclick: () => { pot.toggle(); sfx.coin(); } }, potionLabel({ count: 1 }));
      r.hud.append(h('div', { class: 'hud-title' }, '⚔️ Battle'), potionBtn, h('div', { class: 'hud-stat' }, '⏱ ', (clock = h('b', null, '0.0s'))));
      const me = hpRow('You', avatarOf(player.avatar), 'me');
      rows.set(myId, me);
      r.stage.append(h('div', { class: 'race-lanes' }, me.row, foes.map(f => {
        const row = hpRow(f.name, avatarOf(f.avatar));
        rows.set(f.id, row);
        return row.row;
      })));
    },
    start() { t0 = Date.now(); },
    tick(r) {
      if (!t0) return;
      const el = Date.now() - t0;
      clock.textContent = fmtRace(el);
      if (over || el > BATTLE_MAX_MS) r.finish();
    },
    next() { return nextFact(); },
    answer(r, q, res) {
      recordAnswer(player, q, res);
      const move = moveFor(res, pot.armed);
      pot.answered(res.correct);
      onMove(move);
      if (res.correct) {
        correct++;
        if (move !== 'heal') sfx.hit();
        return { text: moveText(move, AMOUNT[move]), delay: 260 };
      }
      wrong++;
      return { reveal: true, text: moveText(move, AMOUNT[move]), delay: PENALTY_MS };
    },
    leave() {
      return { icon: '👀', title: 'Welcome back!', text: 'The battle kept going, and that question was skipped — no peeking!' };
    },
    finish(r, { quit } = {}) {
      savePlayer(player);
      return { correct, wrong, quit: !!quit && !over };
    },
  };
}
