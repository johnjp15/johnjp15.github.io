// A race on your own phone against other people: either their ghosts (a replay
// of a recorded run, for challenges) or live players (progress pushed by the
// family server). Runs on the regular game engine.

import { h } from './util.js';
import { AVATARS, recordAnswer, savePlayer } from './store.js';
import { RACE_TARGET, PENALTY_MS, RACE_MAX_MS, raceStream, fmtRace } from './race.js';

/**
 * lanes: [{ id, name, avatar, ghost?: [ms of each correct answer] }]
 * startAt: local timestamp to start at (live races), otherwise a normal countdown.
 * onProgress(correct, wrong): called after every answer.
 */
export function raceMode(player, { seed, title, lanes = [], startAt = null, onProgress }) {
  const nextFact = raceStream(seed);
  const timeline = [];
  let correct = 0;
  let wrong = 0;
  let t0 = null;
  let clock;
  const rows = new Map();

  const lane = (id, name, avatar, cls = '') => {
    const fill = h('i');
    const count = h('b', null, `0/${RACE_TARGET}`);
    const row = h('div', { class: `race-lane ${cls}` },
      h('span', { class: 'race-av' }, avatar), h('span', { class: 'race-name' }, name),
      h('span', { class: 'race-track' }, fill), count);
    rows.set(id, { row, fill, count });
    return row;
  };
  const setLane = (id, n, { done = false, dnf = false } = {}) => {
    const r = rows.get(id);
    if (!r) return;
    r.fill.style.width = `${(Math.min(n, RACE_TARGET) / RACE_TARGET) * 100}%`;
    r.count.textContent = dnf ? 'out' : n >= RACE_TARGET || done ? '🏁' : `${n}/${RACE_TARGET}`;
    r.row.classList.toggle('finished', n >= RACE_TARGET);
  };

  return {
    id: 'race',
    music: 'race',
    limit: 8000,
    countdown: true,
    startAt,
    introIcon: '⚔️',
    introTitle: title,
    introText: `First to ${RACE_TARGET} correct wins!`,
    setLane,
    init(r) {
      r.hud.append(h('div', { class: 'hud-title' }, title), h('div', { class: 'hud-stat' }, '⏱ ', (clock = h('b', null, '0.0s'))));
      r.stage.append(h('div', { class: 'race-lanes' },
        lane('me', 'You', AVATARS[player.avatar] || '🙂', 'me'),
        lanes.map(l => lane(l.id, l.name, typeof l.avatar === 'number' ? AVATARS[l.avatar] || '🙂' : l.avatar, l.ghost ? 'ghost' : ''))));
    },
    start() { t0 = Date.now(); },
    tick(r) {
      if (!t0) return;
      const el = Date.now() - t0;
      clock.textContent = fmtRace(el);
      for (const l of lanes) if (l.ghost) setLane(l.id, l.ghost.filter(t => t <= el).length);
      if (el > RACE_MAX_MS) r.finish();
    },
    next() { return nextFact(); },
    answer(r, q, res) {
      recordAnswer(player, q, res);
      if (res.correct) {
        correct++;
        timeline.push(Date.now() - t0);
        setLane('me', correct);
        onProgress?.(correct, wrong);
        if (correct >= RACE_TARGET) return { text: '🏁 Finished!', end: true, delay: 300 };
        return { delay: 180 };
      }
      wrong++;
      onProgress?.(correct, wrong);
      return { reveal: true, text: '⏳ +1.5s', delay: PENALTY_MS };
    },
    leave() {
      return { icon: '👀', title: 'Welcome back!', text: 'The clock kept running, and that question was skipped — no peeking!' };
    },
    finish(r, { quit } = {}) {
      savePlayer(player);
      const finished = correct >= RACE_TARGET;
      return { correct, wrong, ms: finished ? timeline[timeline.length - 1] : null, timeline, quit: !!quit && !finished };
    },
  };
}
