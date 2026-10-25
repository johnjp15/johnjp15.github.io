// The four ways to play. Each returns a "mode" object driven by game.js:
//   next(round) → question | null, answer(round, q, result) → feedback,
//   leave(round, q) when the player left the app, finish(round) → summary.

import { h, rand, pick, shuffle, deviceCode, isStandalone } from './util.js';
import { FACTS, TOTAL, BOSSES, trickFor } from './facts.js';
import { trainingDeck, blitzPicker, bossPicker, orient } from './srs.js';
import { recordAnswer, savePlayer, syncTests, addXp, checkBadges, setActiveTest, clearActiveTest } from './store.js';
import { REASON } from './codec.js';
import { signTest } from './certs.js';
import { floatText } from './fx.js';
import { sfx } from './sfx.js';

const FAST_CHEERS = ['⚡ Lightning!', '🚀 Rocket speed!', '🧠 Big brain!', '✨ Nailed it!', '🎯 Bullseye!', '💪 Strong!', '😎 Too easy!'];
const COMBO_CHEERS = { 5: '🔥 5 in a row!', 10: '💥 10 COMBO!', 15: '🌪️ 15! Unreal!', 20: '🌟 20! UNSTOPPABLE!', 30: '👑 30! Times-table royalty!' };

const cheer = combo => COMBO_CHEERS[combo] || pick(FAST_CHEERS);
const missText = res => (res.timeout ? "⏰ Time's up!" : 'Not quite!');

function progressHud(r, title) {
  const fill = h('i');
  const combo = h('div', { class: 'hud-combo' });
  r.hud.append(h('div', { class: 'hud-title' }, title), h('div', { class: 'hud-progress' }, fill), combo);
  return {
    progress: f => { fill.style.width = `${Math.round(f * 100)}%`; },
    combo: n => { combo.textContent = n >= 3 ? `🔥×${n}` : ''; },
  };
}

// ---------- Training: adaptive spaced-repetition practice ----------

export function trainMode(player, { table = null } = {}) {
  const queue = trainingDeck(player, { table });
  const repairs = new Map();
  const log = [];
  let xp = 0;
  let hud;
  return {
    id: 'train',
    limit: 10000,
    countdown: false,
    init(r) { hud = progressHud(r, table ? `🧠 ${table}s` : '🧠 Training'); },
    next() {
      hud.progress(log.length / (log.length + queue.length || 1));
      return queue.shift() || null;
    },
    answer(r, q, res) {
      const out = recordAnswer(player, q, res);
      log.push({ q, res, out });
      savePlayer(player);
      hud.combo(res.combo);
      if (res.correct) {
        const pts = (res.fast ? 10 : 4) + Math.min(10, Math.floor(res.combo / 5) * 2);
        xp += pts;
        return { text: res.fast ? cheer(res.combo) : '✓ Right! Now get it faster 🐢', points: `+${pts}` };
      }
      // Ask it again a few questions later (at most twice per round).
      const n = repairs.get(q.key) || 0;
      if (n < 2) {
        repairs.set(q.key, n + 1);
        queue.splice(Math.min(queue.length, 2 + rand(2)), 0, orient(q));
      }
      return { fix: true, trick: trickFor(q.a, q.b), text: missText(res), delay: 650 };
    },
    skip(r, q) { if (q) queue.splice(Math.min(queue.length, 1), 0, orient(q)); },
    leave(r, q) {
      this.skip(r, q);
      return { icon: '👋', title: 'Welcome back!', text: 'That question was skipped — no peeking allowed 👀' };
    },
    finish(r, { quit } = {}) {
      const complete = !quit;
      if (complete) xp += 20;
      player.stats.rounds++;
      const leveled = addXp(player, xp);
      const badges = checkBadges(player);
      savePlayer(player);
      return { kind: 'train', table, log, xp, leveled, badges, complete };
    },
  };
}

// ---------- Blitz: as many as you can in 60 seconds ----------

export function blitzMode(player) {
  const nextFact = blitzPicker(player);
  const DURATION = 60000;
  let endAt = null;
  let lastSec = null;
  let correct = 0;
  let answered = 0;
  let timeEl, scoreEl, comboEl;
  return {
    id: 'blitz',
    limit: null,
    countdown: true,
    introIcon: '⚡',
    introTitle: '60-second Blitz',
    introText: 'Answer as many as you can!',
    init(r) {
      r.hud.append(
        h('div', { class: 'hud-title' }, '⚡ Blitz'),
        h('div', { class: 'hud-stat' }, '⏱ ', (timeEl = h('b', null, '60'))),
        h('div', { class: 'hud-stat' }, '✓ ', (scoreEl = h('b', null, '0'))),
        (comboEl = h('div', { class: 'hud-combo' })));
    },
    start() { endAt = Date.now() + DURATION; },
    tick(r) {
      if (!endAt) return;
      const left = endAt - Date.now();
      const sec = Math.max(0, Math.ceil(left / 1000));
      if (sec !== lastSec) {
        lastSec = sec;
        timeEl.textContent = sec;
        timeEl.parentElement.classList.toggle('hurry', sec <= 10);
        if (sec <= 5 && sec > 0) sfx.tick();
      }
      if (left <= 0) r.finish();
    },
    next() { return nextFact(); },
    answer(r, q, res) {
      answered++;
      recordAnswer(player, q, res);
      comboEl.textContent = res.combo >= 3 ? `🔥×${res.combo}` : '';
      if (res.correct) {
        correct++;
        scoreEl.textContent = correct;
        return { points: res.fast ? '+1 ⚡' : '+1', delay: 220 };
      }
      return { reveal: true, text: missText(res), delay: 800 };
    },
    leave() { return { icon: '👋', title: 'Welcome back!', text: 'The clock kept running — and that question was skipped 👀' }; },
    finish(r, { quit } = {}) {
      const best = player.blitzBest;
      const newBest = !quit && correct > best;
      if (newBest) player.blitzBest = correct;
      const xp = correct * 3;
      player.stats.rounds++;
      const leveled = addXp(player, xp);
      const badges = checkBadges(player);
      savePlayer(player);
      return { kind: 'blitz', correct, answered, best, newBest, xp, leveled, badges, quit };
    },
  };
}

// ---------- Boss battles: one monster per table ----------

export function bossMode(player, t) {
  const boss = BOSSES[t];
  const nextFact = bossPicker(t);
  const MAX_Q = 24;
  let hp = 100;
  let hearts = 3;
  let asked = 0;
  let outcome = null;
  const retry = []; // questions skipped via the quit menu come back a bit later
  let mon, hpFill, heartsEl;
  const drawHearts = () => {
    const n = Math.max(0, hearts);
    heartsEl.textContent = '❤️'.repeat(n) + '🖤'.repeat(3 - n);
  };
  const animate = cls => {
    mon.classList.remove('hit', 'attack');
    void mon.offsetWidth;
    mon.classList.add(cls);
  };
  const hurt = () => {
    hearts--;
    drawHearts();
    animate('attack');
    sfx.hit();
  };
  return {
    id: 'boss',
    limit: 6000,
    countdown: true,
    introIcon: boss.emoji,
    introTitle: boss.name,
    introText: `“${boss.taunt}”`,
    init(r) {
      r.hud.append(h('div', { class: 'hud-title' }, `👾 ${t}s Boss`), (heartsEl = h('div', { class: 'hud-hearts', 'aria-label': 'Hearts' })));
      drawHearts();
      r.stage.append(h('div', { class: 'boss' },
        (mon = h('div', { class: 'boss-mon', 'aria-hidden': 'true' }, boss.emoji)),
        h('div', { class: 'boss-info' },
          h('div', { class: 'boss-name' }, boss.name),
          h('div', { class: 'boss-hp' }, (hpFill = h('i'))))));
    },
    next() {
      if (outcome) return null;
      if (asked >= MAX_Q) { outcome = 'escaped'; return null; }
      asked++;
      const i = retry.findIndex(x => x.at <= asked);
      return i >= 0 ? retry.splice(i, 1)[0].q : nextFact();
    },
    skip(r, q) { if (q && !outcome) retry.push({ q, at: asked + 3 }); },
    answer(r, q, res) {
      if (outcome) return { end: true, delay: 0 };
      recordAnswer(player, q, res);
      if (res.correct) {
        const dmg = res.fast ? 10 : 5;
        hp = Math.max(0, hp - dmg);
        hpFill.style.width = `${hp}%`;
        animate('hit');
        floatText(r.stage, `−${dmg}`, res.fast ? 'gold' : '');
        if (hp <= 0) {
          outcome = 'won';
          mon.classList.add('ko');
          return { text: '💥 K.O.!', end: true, delay: 1100 };
        }
        return { text: res.fast ? '⚡ Critical hit!' : '👊 Hit! Faster = more damage', delay: 420 };
      }
      hurt();
      if (hearts <= 0) { outcome = 'lost'; return { reveal: true, text: missText(res), end: true, delay: 1400 }; }
      return { reveal: true, text: missText(res), delay: 1150 };
    },
    leave(r, q) {
      if (outcome) return { icon: boss.emoji, title: 'Welcome back!', text: '' };
      if (!q) return { icon: boss.emoji, title: 'Welcome back!', text: 'Ready to keep fighting?' };
      hurt();
      if (hearts <= 0) {
        outcome = 'lost';
        return { icon: boss.emoji, title: `${boss.name} wins!`, text: 'It attacked while you were away…', end: true };
      }
      return { icon: '💔', title: 'Sneak attack!', text: `${boss.name} attacked while you were away and that question was skipped. No peeking!` };
    },
    finish(r, { quit } = {}) {
      const won = outcome === 'won' && !quit;
      const stars = won ? (hearts === 3 && asked <= 12 ? 3 : hearts >= 2 ? 2 : 1) : 0;
      const rec = (player.bosses[t] ||= { stars: 0, wins: 0, tries: 0 });
      rec.tries++;
      const firstWin = won && rec.wins === 0;
      if (won) rec.wins++;
      rec.stars = Math.max(rec.stars, stars);
      const xp = won ? 40 + stars * 10 + (firstWin ? 50 : 0) : 10;
      player.stats.rounds++;
      const leveled = addXp(player, xp);
      const badges = checkBadges(player);
      savePlayer(player);
      return { kind: 'boss', t, boss, won, stars, outcome: quit ? 'quit' : outcome, hearts, xp, leveled, badges, firstWin };
    },
  };
}

// ---------- Benchmark test: all 78 facts, 6 seconds each, signed results ----------

export const TEST_LIMIT_MS = 6000;
export const MAX_LEAVES = 3;

export function testMode(player) {
  const now = Date.now();
  syncTests(player); // another tab may have taken a test: never reuse its number
  const seq = ++player.testSeq;
  const before24 = player.tests.filter(t => t.start > now - 864e5).length;
  savePlayer(player);
  const deck = shuffle(FACTS).map(orient);
  const items = [];
  let leaves = 0;
  let start = null;
  let reason = REASON.DONE;
  let counter, fill, leavesEl;
  const base = {
    pid: player.id, avatar: player.avatar, name: player.name, created: player.created,
    seq, before24, restores: player.restores || 0, device: deviceCode(), standalone: isStandalone(),
    tz: new Date().getTimezoneOffset(), limit: TEST_LIMIT_MS, total: TOTAL,
  };
  // Saved after every answer: closing or reloading mid-test still records the attempt.
  const persist = () => setActiveTest({ ...base, start: start ?? now, updated: Date.now(), items, leaves, reason });
  persist();
  const add = (q, res) => items.push({ a: q.a, b: q.b, given: res.given ?? null, ms: res.ms || 0, timeout: !!res.timeout, left: !!res.left });

  return {
    id: 'test',
    limit: TEST_LIMIT_MS,
    countdown: true,
    introIcon: '📋',
    introTitle: 'Benchmark test',
    introText: `${TOTAL} questions · 6 seconds each · stay in the app!`,
    init(r) {
      r.hud.append(
        h('div', { class: 'hud-title' }, '📋 Benchmark'),
        h('div', { class: 'hud-progress' }, (fill = h('i'))),
        (counter = h('div', { class: 'hud-stat' })),
        (leavesEl = h('div', { class: 'hud-leaves', hidden: true })));
    },
    start() { start = Date.now(); persist(); },
    next() {
      if (!deck.length) return null;
      counter.textContent = `${items.length + 1}/${TOTAL}`;
      fill.style.width = `${(items.length / TOTAL) * 100}%`;
      return deck.shift();
    },
    answer(r, q, res) {
      add(q, res);
      recordAnswer(player, q, res, { placement: true });
      savePlayer(player);
      persist();
      return { delay: res.correct ? 260 : 420 };
    },
    skip(r, q) {
      if (!q) return;
      add(q, {});
      persist();
    },
    leave(r, q) {
      // Only a leave while a question was showing could help, so only those count (and cost that question).
      if (!q) return { icon: '👋', title: 'Welcome back!', text: 'No question was showing, so nothing was lost. Stay in the app until the test is done!' };
      leaves++;
      add(q, { left: true });
      persist();
      leavesEl.hidden = false;
      leavesEl.textContent = `👀 ${leaves}/${MAX_LEAVES}`;
      if (leaves >= MAX_LEAVES) {
        reason = REASON.LEFT;
        return { icon: '🛑', title: 'Test stopped', text: `You left the app ${MAX_LEAVES} times, so the test was stopped. It's saved as incomplete.`, end: true };
      }
      return {
        icon: '😬',
        title: 'You left the test!',
        text: `That question counts as missed, and leaving shows up on your results (${leaves} of ${MAX_LEAVES} — at ${MAX_LEAVES} the test stops).`,
      };
    },
    quitInfo: () => ({
      title: 'Stop the test?',
      text: 'Stopping saves the test as incomplete. Either way, the question that was on screen counts as missed.',
      quitLabel: 'Stop test',
    }),
    async finish(r, { quit, q } = {}) {
      if (quit) {
        if (q) add(q, {});
        if (items.length < TOTAL) reason = REASON.QUIT;
      }
      const end = Date.now();
      const t = { ...base, start: start ?? end, dur: end - (start ?? end), leaves, reason, items };
      const record = await signTest(t);
      player.tests.push(record);
      clearActiveTest();
      const done = reason === REASON.DONE;
      const xp = done ? 50 + record.sum.instant : 0;
      player.stats.rounds++;
      const leveled = addXp(player, xp);
      const badges = checkBadges(player, { perfect: done && record.sum.instant === TOTAL });
      savePlayer(player);
      return { kind: 'test', record, xp, leveled, badges };
    },
  };
}

/** Turn an interrupted test (page closed/reloaded mid-test) into an "incomplete" record. */
export async function finalizeAbandonedTest(active, player) {
  const t = { ...active, dur: Math.max(0, (active.updated || active.start) - active.start), reason: active.reason || REASON.CLOSED };
  const record = await signTest(t);
  if (!player.tests.some(x => x.seq === record.seq)) player.tests.push(record);
  savePlayer(player);
  return record;
}
