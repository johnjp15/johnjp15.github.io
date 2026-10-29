// The family board (everyone's practice, side by side) and the small strip on Home.

import { h, fmtAgo, fmtShortDate, plural, dayKey } from './util.js';
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

function memberCard(m, meIds, online = [], onOpen = null) {
  const s = m.summary;
  const streak = streakOf(m);
  const check = s.lastCheck;
  return h('article', { class: `card fam-card ${meIds.includes(m.memberId) ? 'me' : ''}` },
    h('header', { class: 'fam-head' },
      h('span', { class: 'fam-av', 'aria-hidden': 'true' }, avatarOf(m)),
      h('div', { class: 'fam-name' },
        h('b', null, m.name),
        meIds.includes(m.memberId) && h('span', { class: 'chip' }, 'You'),
        h('small', { class: 'muted' }, online.includes(m.memberId) ? '🟢 In the app now' : s.lastActive ? `Active ${fmtAgo(s.lastActive)}` : 'Not active yet')),
      h('div', { class: `streak ${streak ? 'on' : ''}`, title: 'Daily-goal streak' }, '🔥', h('b', null, String(streak)))),
    statusChip(m),
    weekStrip(m),
    h('div', { class: 'fam-stats' },
      h('span', null, '🧠 ', h('b', null, `${s.memorized}/${s.total || 78}`), ' memorized'),
      h('span', null, '👾 ', h('b', null, `${s.bosses}/12`), ' bosses'),
      h('span', null, '🏅 ', check
        ? h('b', null, check.reason ? `#${check.seq} unfinished` : `${check.instant}/${s.total || 78}`)
        : h('b', null, 'no check yet'),
        check && !check.reason ? ` · ${fmtShortDate(check.start)}` : '')),
    onOpen && h('button', { class: 'btn btn-ghost btn-small fam-open', type: 'button', onclick: () => onOpen(m) }, '📈 See progress ›'));
}

/** Last 14 days as bars of right answers, with the daily goal marked. */
function fortnight(m) {
  const s = m.summary;
  const goal = s.goal || 40;
  const top = goal * 1.5;
  const d = new Date();
  d.setDate(d.getDate() - 13);
  const bars = [];
  for (let i = 0; i < 14; i++) {
    const key = dayKey(d.getTime());
    const rec = s.days?.[key];
    const c = rec?.c || 0;
    bars.push(h('div', { class: `kid-day ${c >= goal ? 'goal' : rec && rec.a + rec.f > 0 ? 'some' : ''}`, title: `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${c} right${rec?.f ? `, ${rec.f} flash cards` : ''}` },
      h('i', { style: { height: `${Math.min(1, c / top) * 100}%` } }),
      h('small', null, d.toLocaleDateString(undefined, { weekday: 'narrow' }))));
    d.setDate(d.getDate() + 1);
  }
  return h('div', { class: 'kid-days', style: { '--goal': (goal / top).toFixed(3) } }, bars);
}

/** A grown-up's view of one kid's progress, from what their phone shares. */
export function kidProgress(m, online = []) {
  const s = m.summary;
  const total = s.total || 78;
  const t = todayOf(m);
  const old = !s.tables;
  const checks = (s.checks || (s.lastCheck ? [s.lastCheck] : [])).slice().reverse();
  return h('div', { class: 'stack-form kid-page' },
    h('section', { class: 'card kid-head' },
      h('span', { class: 'kid-av', 'aria-hidden': 'true' }, avatarOf(m)),
      h('div', null,
        h('h2', null, m.name),
        h('p', { class: 'small muted' }, online.includes(m.memberId) ? '🟢 In the app now' : s.lastActive ? `Last active ${fmtAgo(s.lastActive)}` : 'Not active yet'),
        h('p', { class: 'small' }, `Level ${s.level} · 🔥 ${plural(streakOf(m), 'day')} streak`))),
    h('section', { class: 'card' },
      h('h3', null, 'Today'),
      statusChip(m),
      h('p', { class: 'small muted' }, t.done ? 'Daily goal met. 🎉' : `${t.goal - t.correct} more right answers to reach today's goal.`)),
    h('section', { class: 'card' },
      h('h3', null, 'Last 14 days'),
      fortnight(m),
      h('p', { class: 'small muted' }, `Bars show right answers each day; the line is the daily goal (${s.goal || 40}).`)),
    h('section', { class: 'card' },
      h('h3', null, `🧠 ${s.memorized}/${total} facts memorized`),
      old ? h('p', { class: 'small muted' }, 'Open the app on their device to share more detail here.')
        : h('div', { class: 'kid-tables' }, s.tables.map((pct, i) => h('div', { class: `kid-table lv${Math.min(5, Math.floor(pct / 20))}` }, h('b', null, `${i + 1}s`), h('small', null, `${pct}%`)))),
      s.practice?.length > 0 && h('div', null,
        h('p', { class: 'small' }, 'Needs practice:'),
        h('div', { class: 'kid-facts' }, s.practice.map(k => h('span', { class: 'chip' }, k.replace('x', ' × ')))))),
    h('section', { class: 'card' },
      h('h3', null, '🏅 Mastery Checks'),
      checks.length
        ? h('ol', { class: 'kid-checks' }, checks.map(c => h('li', null,
          h('b', null, `#${c.seq}`),
          h('span', null, fmtShortDate(c.start)),
          h('span', null, c.reason ? 'Unfinished' : `⚡ ${c.instant}/${total}`),
          h('span', { class: 'muted' }, c.asked ? `${Math.round((c.correct / c.asked) * 100)}% right` : ''))))
        : h('p', { class: 'small muted' }, 'No Mastery Check yet. It\'s on their Home screen (about 5 minutes).'),
      s.bestCheck != null && h('p', { class: 'small muted' }, `Best: ${s.bestCheck}/${total} instant.`)),
    h('section', { class: 'card' },
      h('h3', null, 'Games'),
      h('div', { class: 'fam-stats' },
        h('span', null, '👾 ', h('b', null, `${s.bosses}/12`), ' bosses beaten'),
        s.blitzBest != null && h('span', null, '⚡ ', h('b', null, String(s.blitzBest)), ' best Blitz'),
        s.answers != null && h('span', null, '✍️ ', h('b', null, String(s.answers)), ' answers', s.answers ? ` (${Math.round((s.correct / s.answers) * 100)}% right)` : ''),
        s.duels && h('span', null, '⚔️ ', h('b', null, `${s.duels.won}/${s.duels.played}`), ' duels won'))));
}

/**
 * The full board. me: member ids on this device.
 */
export function familyBoard({ board, fetchedAt, offline }, me = [], online = [], onOpen = null) {
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
    players.map(m => memberCard(m, me, online, onOpen)),
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
