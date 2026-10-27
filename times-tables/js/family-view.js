// The family board (everyone's practice, side by side) and the small strip on Home.

import { h, fmtAgo, fmtShortDate } from './util.js';
import { AVATARS } from './store.js';
import { todayOf, streakOf, weekOf, familyStreak } from './family.js';

const avatarOf = m => (m.role === 'viewer' ? '🧑' : AVATARS[m.avatar] || '🙂');
const playersOf = board => board.members.filter(m => m.role !== 'viewer' && m.summary);

function statusChip(m) {
  const t = todayOf(m);
  if (t.done) return h('span', { class: 'fam-chip done' }, `✅ Goal done · ${t.correct} right`);
  if (t.correct || t.cards) {
    return h('span', { class: 'fam-chip some' }, `🎯 ${t.correct}/${t.goal} today${t.cards ? ` · 🃏 ${t.cards}` : ''}`);
  }
  return h('span', { class: 'fam-chip none' }, '😴 Not yet today');
}

function weekStrip(m) {
  return h('div', { class: 'fam-week', role: 'list', 'aria-label': 'Last 7 days' },
    weekOf(m).map(d => h('span', {
      class: `fam-day ${d.state}`, role: 'listitem',
      'aria-label': `${d.key}: ${d.state === 'goal' ? 'goal met' : d.state === 'some' ? `${d.correct} correct` : 'no practice'}`,
    }, h('i'), h('small', null, d.weekday))));
}

function memberCard(m, meIds) {
  const s = m.summary;
  const streak = streakOf(m);
  const check = s.lastCheck;
  return h('article', { class: `card fam-card ${meIds.includes(m.memberId) ? 'me' : ''}` },
    h('header', { class: 'fam-head' },
      h('span', { class: 'fam-av', 'aria-hidden': 'true' }, avatarOf(m)),
      h('div', { class: 'fam-name' },
        h('b', null, m.name),
        meIds.includes(m.memberId) && h('span', { class: 'chip' }, 'You'),
        h('small', { class: 'muted' }, s.lastActive ? `Active ${fmtAgo(s.lastActive)}` : 'Not active yet')),
      h('div', { class: `streak ${streak ? 'on' : ''}`, title: 'Daily-goal streak' }, '🔥', h('b', null, String(streak)))),
    statusChip(m),
    weekStrip(m),
    h('div', { class: 'fam-stats' },
      h('span', null, '🧠 ', h('b', null, `${s.memorized}/${s.total || 78}`), ' memorized'),
      h('span', null, '👾 ', h('b', null, `${s.bosses}/12`), ' bosses'),
      h('span', null, '🏅 ', check
        ? h('b', null, check.reason ? `#${check.seq} unfinished` : `${check.instant}/${s.total || 78}`)
        : h('b', null, 'no check yet'),
        check && !check.reason ? ` · ${fmtShortDate(check.start)}` : '')));
}

/**
 * The full board. me: member ids on this device.
 */
export function familyBoard({ board, fetchedAt, offline }, me = []) {
  const players = playersOf(board);
  const waiting = board.members.filter(m => m.role !== 'viewer' && !m.summary);
  const grownUps = board.members.filter(m => m.role === 'viewer');
  const done = players.filter(m => todayOf(m).done).length;
  const famStreak = familyStreak(players);
  return h('div', { class: 'fam-board' },
    h('section', { class: 'card fam-summary' },
      h('div', { class: 'fam-sum-main' },
        h('div', { class: 'hero-num' }, String(done), h('span', null, ` / ${players.length}`)),
        h('div', { class: 'hero-label' }, 'hit today\'s goal')),
      h('div', { class: `fam-streak ${famStreak ? 'on' : ''}` },
        h('b', null, `🔥 ${famStreak}`),
        h('small', null, famStreak === 1 ? 'day everyone' : 'days in a row', h('br'), famStreak === 1 ? 'hit the goal' : 'everyone hit the goal'))),
    players.length > 0 && h('div', { class: 'legend', role: 'list' },
      h('span', { class: 'legend-item', role: 'listitem' }, h('i', { class: 'swatch st-fast' }), 'Goal met'),
      h('span', { class: 'legend-item', role: 'listitem' }, h('i', { class: 'swatch st-slow' }), 'Practiced'),
      h('span', { class: 'legend-item', role: 'listitem' }, h('i', { class: 'swatch st-none' }), 'No practice')),
    offline && h('p', { class: 'warn-box small' }, `📡 Offline — showing the last update${fetchedAt ? ` (${fmtAgo(fetchedAt)})` : ''}.`),
    players.length === 0 && h('p', { class: 'muted center' }, 'Nobody has practiced yet. Progress shows up here after the first round.'),
    players.map(m => memberCard(m, me)),
    waiting.length > 0 && h('p', { class: 'muted small center' }, `Joined, no practice yet: ${waiting.map(m => m.name).join(', ')}`),
    grownUps.length > 0 && h('p', { class: 'muted small center' }, `👀 Watching: ${grownUps.map(m => m.name).join(', ')}`));
}

/** Compact strip for Home: everyone's face with a ✓ when today's goal is done. */
export function familyStrip({ board }, onOpen) {
  const players = playersOf(board);
  const done = players.filter(m => todayOf(m).done).length;
  const famStreak = familyStreak(players);
  return h('button', { class: 'card fam-strip', type: 'button', onclick: onOpen, 'aria-label': 'Open the family board' },
    h('div', { class: 'fam-strip-text' },
      h('b', null, `👪 ${board.name}`),
      h('small', { class: 'muted' }, players.length ? `${done} of ${players.length} hit today's goal${famStreak ? ` · 🔥 ${famStreak}` : ''}` : 'Waiting for the first practice')),
    h('div', { class: 'fam-faces' },
      players.slice(0, 6).map(m => {
        const t = todayOf(m);
        return h('span', { class: `fam-face ${t.done ? 'done' : t.started ? 'some' : ''}`, title: m.name },
          avatarOf(m), h('i', { 'aria-hidden': 'true' }, t.done ? '✓' : ''));
      })),
    h('span', { class: 'bm-go' }, '›'));
}
