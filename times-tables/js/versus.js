// Versus game modes. Everyone gets the same questions in the same order (shared
// seed). Each mode is a referee: init() makes the game state, apply() changes it
// after someone answers, and the rest only read it. Duel runs the referee on one
// phone; in room games the host's phone runs it and sends the state to everyone.
//
// An answer event is { correct, fast, timeout, heal } (heal: use a potion, Battle
// only) or { quit: true } when someone leaves. `at` is the game time in ms.

import { RACE_TARGET, RACE_MAX_MS, fmtRace } from './race.js';

export const PENALTY_MS = 1500;
export const MAX_HP = 100;
const ATTACK = { hit: 10, crit: 15 };
const HEAL = 20;
const TRIP = 5;
const MAX_POTIONS = 3;
const POTION_STREAK = 3;
const SPRINT_MS = 60000;
const TUG_WIN = 10;
const LIVES = 3;
export const TEAMS = [{ icon: '🔵', name: 'Blue team' }, { icon: '🔴', name: 'Red team' }];

const ids = st => Object.keys(st.p);
const by = (...keys) => (a, b) => { for (const k of keys) { const d = k(a, b); if (d) return d; } return 0; };

const race = {
  id: 'race',
  icon: '🏁',
  name: 'Race',
  tagline: `First to ${RACE_TARGET} right answers`,
  rules: [
    `First to ${RACE_TARGET} right answers wins.`,
    'A wrong answer shows the right one and costs 1.5 seconds.',
  ],
  music: 'race',
  maxMs: RACE_MAX_MS,
  limit: () => 8000,
  init: (list, { duel = false } = {}) => ({ duel, p: Object.fromEntries(list.map(id => [id, { n: 0, wrong: 0, ms: null, quit: false }])) }),
  apply(st, id, ev, at) {
    const me = st.p[id];
    if (ev.quit) { me.quit = true; return {}; }
    if (!ev.correct) { me.wrong++; return { text: '⏳ +1.5s' }; }
    me.n++;
    if (me.n >= RACE_TARGET) me.ms = at;
    return { text: me.ms != null ? '🏁 Finished!' : '' };
  },
  out: (st, id) => st.p[id].ms != null || st.p[id].quit,
  over: (st, at) => at >= RACE_MAX_MS || ids(st).every(id => race.out(st, id)) || (st.duel && ids(st).some(id => st.p[id].ms != null)),
  order: st => ids(st).sort(by((a, b) => (st.p[a].ms == null) - (st.p[b].ms == null), (a, b) => (st.p[a].ms ?? 0) - (st.p[b].ms ?? 0), (a, b) => st.p[b].n - st.p[a].n)),
  score: (st, id) => (st.p[id].ms != null ? fmtRace(st.p[id].ms) : `${st.p[id].n}/${RACE_TARGET}${st.p[id].quit ? ' · left' : ''}`),
  lanes: st => ids(st).map(id => ({ id, frac: st.p[id].n / RACE_TARGET, text: st.p[id].ms != null ? '🏁' : st.p[id].quit ? 'out' : `${st.p[id].n}/${RACE_TARGET}` })),
  verdict(st) {
    const top = race.order(st)[0];
    return st.p[top].ms == null ? { winners: [], title: 'Nobody finished!' } : { winners: [top] };
  },
};

const standing = st => ids(st).filter(id => st.p[id].ko == null);

const battle = {
  id: 'battle',
  icon: '⚔️',
  name: 'Battle',
  tagline: 'Health bars: attack, heal, knock them out',
  rules: [
    `Everyone starts with ❤️ ${MAX_HP}.`,
    `A right answer attacks: −${ATTACK.hit}, or ⚡ −${ATTACK.crit} if it took under 3 seconds. With 3–4 players it hits whoever has the most health.`,
    `Tap 🧪 Heal and your next right answer heals you +${HEAL}. You start with one potion and earn another for every ${POTION_STREAK} right in a row.`,
    `A wrong answer hurts you −${TRIP}.`,
    'Last one standing wins. After 3 minutes, the most health wins.',
  ],
  music: 'battle',
  maxMs: 3 * 60000,
  potions: true,
  limit: () => 8000,
  init: list => ({ p: Object.fromEntries(list.map(id => [id, { hp: MAX_HP, ko: null, potions: 1, streak: 0, quit: false }])) }),
  apply(st, id, ev, at) {
    const me = st.p[id];
    if (ev.quit) {
      me.quit = true;
      if (me.ko == null) Object.assign(me, { hp: 0, ko: at });
      return {};
    }
    let target = id;
    let text;
    if (ev.correct) {
      if (++me.streak % POTION_STREAK === 0 && me.potions < MAX_POTIONS) me.potions++;
      if (ev.heal && me.potions > 0) {
        me.potions--;
        me.hp = Math.min(MAX_HP, me.hp + HEAL);
        text = `💚 Healed +${HEAL}`;
      } else {
        const foes = standing(st).filter(x => x !== id).sort((a, b) => st.p[b].hp - st.p[a].hp);
        if (!foes.length) return {};
        target = foes[0];
        const dmg = ev.fast ? ATTACK.crit : ATTACK.hit;
        st.p[target].hp = Math.max(0, st.p[target].hp - dmg);
        text = ev.fast ? `⚡ Critical hit! −${dmg}` : `⚔️ Hit! −${dmg}`;
      }
    } else {
      me.streak = 0;
      me.hp = Math.max(0, me.hp - TRIP);
      text = `💥 Ouch! −${TRIP} · +1.5s`;
    }
    if (st.p[target].hp <= 0) st.p[target].ko = at;
    return { text, hit: target !== id ? [target] : ev.correct ? [] : [id] };
  },
  out: (st, id) => st.p[id].ko != null,
  over: (st, at) => at >= battle.maxMs || standing(st).length <= 1,
  // Still standing first (most health first), then knocked out (last one out first).
  order: st => ids(st).sort(by((a, b) => (st.p[a].ko != null) - (st.p[b].ko != null), (a, b) => st.p[b].hp - st.p[a].hp, (a, b) => (st.p[b].ko ?? 0) - (st.p[a].ko ?? 0))),
  score: (st, id) => (st.p[id].ko != null ? `💥 KO${st.p[id].quit ? ' · left' : ''}` : `❤️ ${st.p[id].hp}`),
  lanes: st => ids(st).map(id => {
    const { hp, ko } = st.p[id];
    return { id, frac: hp / MAX_HP, text: ko != null ? '💥' : String(hp), cls: `hp ${hp <= 25 ? 'hp-low' : hp <= 50 ? 'hp-mid' : ''} ${ko != null ? 'ko' : ''}` };
  }),
  verdict(st) {
    const [a, b] = battle.order(st);
    return b && st.p[b].ko == null && st.p[a].hp === st.p[b].hp ? { winners: [], title: 'It\'s a draw!' } : { winners: [a] };
  },
};

const sprint = {
  id: 'sprint',
  icon: '⏱️',
  name: 'Time Attack',
  tagline: 'Most right answers in 60 seconds',
  rules: [
    'Most right answers in 60 seconds wins.',
    'A wrong answer shows the right one and costs 1.5 seconds.',
  ],
  music: 'race',
  maxMs: SPRINT_MS,
  limit: () => 6000,
  clock: at => `${Math.max(0, Math.ceil((SPRINT_MS - at) / 1000))}s left`,
  init: list => ({ p: Object.fromEntries(list.map(id => [id, { n: 0, wrong: 0, quit: false }])) }),
  apply(st, id, ev) {
    const me = st.p[id];
    if (ev.quit) { me.quit = true; return {}; }
    if (!ev.correct) { me.wrong++; return { text: '⏳ +1.5s' }; }
    me.n++;
    return { text: `+1 · ${me.n} right` };
  },
  out: (st, id) => st.p[id].quit,
  over: (st, at) => at >= SPRINT_MS || ids(st).every(id => st.p[id].quit),
  order: st => ids(st).sort(by((a, b) => st.p[a].quit - st.p[b].quit, (a, b) => st.p[b].n - st.p[a].n, (a, b) => st.p[a].wrong - st.p[b].wrong)),
  score: (st, id) => `${st.p[id].n} right${st.p[id].quit ? ' · left' : ''}`,
  lanes(st) {
    const best = Math.max(10, ...ids(st).map(id => st.p[id].n));
    return ids(st).map(id => ({ id, frac: st.p[id].n / best, text: String(st.p[id].n) }));
  },
  verdict(st) {
    const [a, b] = sprint.order(st);
    return b && st.p[a].n === st.p[b].n && st.p[a].wrong === st.p[b].wrong ? { winners: [], title: 'It\'s a draw!' } : { winners: [a] };
  },
};

const tugWinner = st => {
  if (Math.abs(st.rope) >= TUG_WIN) return st.rope > 0 ? 0 : 1;
  for (const team of [0, 1]) if (ids(st).filter(id => st.p[id].team === team).every(id => st.p[id].quit)) return 1 - team;
  return null;
};

const tug = {
  id: 'tug',
  icon: '🪢',
  name: 'Tug of War',
  tagline: 'Pull the rope to your side (2 or 4 players)',
  rules: [
    'Two teams (or two players) pull one rope. Every right answer pulls it your way: 1 step, or 2 if it took under 3 seconds.',
    'A wrong answer lets the rope slip 1 step back and costs 1.5 seconds.',
    `Pull the rope ${TUG_WIN} steps to your side to win. After 3 minutes, the side it leans to wins.`,
    'With 4 players it\'s 2 against 2: 🔵 Blue and 🔴 Red.',
  ],
  music: 'battle',
  maxMs: 3 * 60000,
  limit: () => 8000,
  fits: n => (n === 2 || n === 4 ? null : 'Tug of War needs 2 or 4 players.'),
  init: list => ({ rope: 0, p: Object.fromEntries(list.map((id, i) => [id, { team: i % 2, pulls: 0, quit: false }])) }),
  apply(st, id, ev) {
    const me = st.p[id];
    if (ev.quit) { me.quit = true; return {}; }
    const dir = me.team === 0 ? 1 : -1;
    const step = ev.correct ? (ev.fast ? 2 : 1) : -1;
    st.rope = Math.max(-TUG_WIN, Math.min(TUG_WIN, st.rope + dir * step));
    if (step > 0) me.pulls += step;
    return { text: step > 0 ? `💪 Pull! +${step}` : '😬 Slip! · +1.5s' };
  },
  out: (st, id) => st.p[id].quit,
  over: (st, at) => at >= tug.maxMs || tugWinner(st) != null,
  winningTeam: st => tugWinner(st) ?? (st.rope > 0 ? 0 : st.rope < 0 ? 1 : null),
  order(st) {
    const w = tug.winningTeam(st);
    return ids(st).sort(by((a, b) => (st.p[a].team !== w) - (st.p[b].team !== w), (a, b) => st.p[b].pulls - st.p[a].pulls));
  },
  score: (st, id) => `${TEAMS[st.p[id].team].icon} ${st.p[id].pulls} pulls${st.p[id].quit ? ' · left' : ''}`,
  // One lane per team: how close it is to winning.
  lanes(st) {
    const teams = new Set(ids(st).map(id => st.p[id].team));
    return [...teams].sort().map(team => {
      const frac = (TUG_WIN + (team === 0 ? st.rope : -st.rope)) / (2 * TUG_WIN);
      return { team, members: ids(st).filter(id => st.p[id].team === team), icon: TEAMS[team].icon, frac, text: `${Math.round(frac * 100)}%`, cls: `team-${team}` };
    });
  },
  verdict(st) {
    const w = tug.winningTeam(st);
    return w == null ? { winners: [], title: 'It\'s a draw!' } : { winners: ids(st).filter(id => st.p[id].team === w), team: w };
  },
};

const alive = st => ids(st).filter(id => st.p[id].outAt == null);

const lives = {
  id: 'lives',
  icon: '💔',
  name: 'Three Lives',
  tagline: 'Three misses and you\'re out, and it keeps getting faster',
  rules: [
    `Everyone has ${'❤️'.repeat(LIVES)}. A wrong answer, or running out of time, loses a life.`,
    'You get 6 seconds per question at first, then a little less every 20 seconds.',
    'Last one with lives left wins.',
  ],
  music: 'battle',
  maxMs: 5 * 60000,
  limit: (st, at) => Math.max(2000, 6000 - Math.floor(at / 20000) * 500),
  init: list => ({ p: Object.fromEntries(list.map(id => [id, { lives: LIVES, n: 0, outAt: null, quit: false }])) }),
  apply(st, id, ev, at) {
    const me = st.p[id];
    if (ev.quit) {
      me.quit = true;
      if (me.outAt == null) Object.assign(me, { lives: 0, outAt: at });
      return {};
    }
    if (ev.correct) { me.n++; return { text: '✓ Safe!' }; }
    me.lives--;
    if (me.lives <= 0) me.outAt = at;
    return { text: me.lives > 0 ? `💔 ${me.lives} ${me.lives === 1 ? 'life' : 'lives'} left` : '💔 Out!', hit: [id] };
  },
  out: (st, id) => st.p[id].outAt != null,
  over: (st, at) => at >= lives.maxMs || alive(st).length <= 1,
  order: st => ids(st).sort(by((a, b) => (st.p[a].outAt != null) - (st.p[b].outAt != null), (a, b) => st.p[b].lives - st.p[a].lives, (a, b) => st.p[b].n - st.p[a].n, (a, b) => (st.p[b].outAt ?? 0) - (st.p[a].outAt ?? 0))),
  score: (st, id) => (st.p[id].outAt != null ? `💔 out · ${st.p[id].n} right${st.p[id].quit ? ' · left' : ''}` : `${'❤️'.repeat(st.p[id].lives)} · ${st.p[id].n} right`),
  lanes: st => ids(st).map(id => ({ id, frac: st.p[id].lives / LIVES, text: st.p[id].outAt != null ? '💔' : '❤️'.repeat(st.p[id].lives), cls: `hp ${st.p[id].lives === 1 ? 'hp-low' : ''} ${st.p[id].outAt != null ? 'ko' : ''}` })),
  verdict(st) {
    const [a, b] = lives.order(st);
    const same = b && st.p[b].outAt == null && st.p[a].lives === st.p[b].lives && st.p[a].n === st.p[b].n;
    return same ? { winners: [], title: 'It\'s a draw!' } : { winners: [a] };
  },
};

export const MODES = { race, battle, sprint, tug, lives };
export const modeOf = id => MODES[id] || race;

/** Apply an answer (or a quit) if it still counts; returns the mode's feedback or null. */
export function act(mode, st, id, e, at) {
  const me = st.p[id];
  if (!me || (e.quit ? me.quit : mode.out(st, id) || mode.over(st, at))) return null;
  return mode.apply(st, id, e, at);
}

/**
 * Rows to draw for a game: [{ key, ids, avatar, name, frac, text, cls, me }], yours first.
 * people: { id: { name, avatar } }.
 */
export function laneInfo(mode, st, people, myId) {
  const rows = mode.lanes(st).map(l => {
    const ids = l.members || [l.id];
    const me = ids.includes(myId);
    const names = ids.map(id => (id === myId ? 'You' : people[id]?.name || 'Player'));
    return {
      key: l.members ? `team${l.team}` : l.id,
      ids,
      me,
      avatar: l.icon || people[l.id]?.avatar || '🙂',
      name: l.members && ids.length > 1 ? `${TEAMS[l.team].name}: ${names.join(' & ')}` : names[0],
      frac: l.frac,
      text: l.text,
      cls: l.cls || '',
    };
  });
  return rows.sort((a, b) => b.me - a.me);
}

/** Why this many players can't play a mode, or null when they can. */
export const unfit = (mode, n) => (n < 2 ? 'Needs at least 2 players.' : mode.fits?.(n) ?? null);

/** The big line on a results screen. names: { id: name }. */
export function verdictTitle(mode, st, names, myId) {
  const v = mode.verdict(st);
  if (v.title) return v.title;
  if (v.winners.includes(myId)) return v.winners.length > 1 ? 'Your team won!' : 'You won!';
  if (v.team != null && v.winners.length > 1) return `${TEAMS[v.team].name} wins!`;
  return `${v.winners.map(id => names[id]).join(' & ')} won!`;
}
