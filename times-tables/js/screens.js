// Every screen of the app (except the game itself, see game.js).

import { h, rand, clip, fmtAgo, fmtShortDate, fmtDate, isIOS, isStandalone, plural, shortId } from './util.js';
import { TOTAL, BOSSES, MAX, factOf, trickFor } from './facts.js';
import { LEVELS, memorizedCount, tableMastery, weakestTable, factState } from './srs.js';
import * as store from './store.js';
import { play } from './game.js';
import { trainMode, blitzMode, bossMode, testMode, finalizeAbandonedTest } from './modes.js';
import { shareLink, readLink, backupLink, readBackup, deviceSeal, setDeviceSeal, deriveSeal, fpText, cryptoReady } from './certs.js';
import { resultsView } from './results-view.js';
import { factGrid, lineChart, ring, tipValue } from './charts.js';
import { confetti, toast, dialog } from './fx.js';
import { sfx, setSound, unlockAudio } from './sfx.js';

const { AVATARS, DAILY_GOAL } = store;
let player = null;

// ---------- boot ----------

export async function boot() {
  let persisted = false;
  const onGesture = () => {
    unlockAudio();
    if (!persisted) { persisted = true; store.requestPersistence(); }
  };
  // iOS only lets audio start inside certain gestures, so try on several.
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, onGesture, { capture: true });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#restore=')) location.reload(); });
  document.addEventListener('gesturestart', e => e.preventDefault()); // no pinch-zoom mid-game
  const syncHeight = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
  syncHeight();
  window.addEventListener('resize', syncHeight);
  window.visualViewport?.addEventListener('resize', syncHeight);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!cryptoReady()) {
    return mount(h('div', { class: 'screen onboard' }, h('h1', null, '😕'), h('p', null, 'This app needs a secure (https) page to work. Open it from its GitHub Pages address.')));
  }

  if (location.hash.startsWith('#restore=')) {
    const frag = location.hash.slice('#restore='.length);
    history.replaceState(null, '', location.pathname + location.search);
    await restoreFlow(frag);
  }

  // A test that was interrupted by closing/reloading the page is recorded, not forgotten.
  let interrupted = null;
  const active = store.getActiveTest();
  if (active) {
    const p = store.loadPlayer(active.pid);
    if (p) interrupted = await finalizeAbandonedTest(active, p).catch(() => null);
    store.clearActiveTest();
  }

  player = store.currentPlayer();
  if (!player) return onboarding();
  setSound(player.settings.sound);
  home();
  if (interrupted) {
    dialog({ icon: '📋', title: 'Unfinished test', body: `Benchmark #${interrupted.seq} was interrupted (the app was closed or reloaded), so it was saved as incomplete.` });
  }
}

function mount(el) {
  document.getElementById('app').replaceChildren(el);
  window.scrollTo(0, 0);
}

function page(title, back, ...content) {
  mount(h('div', { class: 'screen page' },
    h('header', { class: 'page-top' },
      back ? h('button', { class: 'icon-btn back', type: 'button', 'aria-label': 'Back', onclick: back }, '‹') : h('span', { class: 'spacer' }),
      h('h1', null, title),
      h('span', { class: 'spacer' })),
    h('main', { class: 'page-body' }, ...content)));
}

const card = (...kids) => h('section', { class: 'card' }, ...kids);

// ---------- players ----------

function onboarding({ adding = false } = {}) {
  let avatar = rand(AVATARS.length);
  let nameTouched = false;
  const nameInput = h('input', {
    class: 'input big', maxlength: 20, value: store.suggestName(avatar), autocomplete: 'off',
    autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Your name',
    oninput: () => { nameTouched = true; },
  });
  const pick = h('div', { class: 'avatar-pick', role: 'radiogroup', 'aria-label': 'Pick your buddy' },
    AVATARS.map((a, i) => h('button', {
      class: `av ${i === avatar ? 'sel' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(i === avatar), 'aria-label': `Buddy ${i + 1}`,
      onclick: e => {
        avatar = i;
        for (const b of pick.children) { b.classList.remove('sel'); b.setAttribute('aria-checked', 'false'); }
        e.currentTarget.classList.add('sel');
        e.currentTarget.setAttribute('aria-checked', 'true');
        if (!nameTouched) nameInput.value = store.suggestName(avatar);
      },
    }, a)));
  mount(h('div', { class: 'screen onboard' },
    h('div', { class: 'logo', 'aria-hidden': 'true' }, h('span', null, '7'), h('i', null, '×'), h('span', null, '8')),
    h('h1', null, adding ? 'New player' : 'Times Table Quest'),
    !adding && h('p', { class: 'lead' }, 'Learn every times table from 1\u00a0×\u00a01 to 12\u00a0×\u00a012 — by heart!'),
    h('form', {
      class: 'onboard-form',
      onsubmit: e => {
        e.preventDefault();
        player = store.createPlayer({ name: nameInput.value, avatar });
        setSound(player.settings.sound);
        firstRun();
      },
    },
    h('label', { class: 'field-label' }, 'What should we call you?'),
    nameInput,
    h('label', { class: 'field-label' }, 'Pick your buddy'),
    pick,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Let\'s go! 🚀'),
    adding && h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => home() }, 'Cancel'))));
}

async function firstRun() {
  home();
  const go = await dialog({
    icon: AVATARS[player.avatar],
    title: `Welcome, ${player.name}!`,
    body: 'First, let\'s find out which facts you already know with a Benchmark test. It takes about 5 minutes.',
    buttons: [{ label: 'Take the test 📋', value: true, primary: true }, { label: 'Maybe later', value: false }],
  });
  if (go) testIntro();
}

async function playerSheet() {
  const players = store.listPlayers();
  const choice = await dialog({
    title: 'Who\'s playing?',
    buttons: [
      ...players.map(x => ({ label: `${AVATARS[x.avatar] || '🙂'} ${x.name}${x.id === player.id ? '  ✓' : ''}`, value: x.id, primary: x.id === player.id })),
      { label: '➕ New player', value: 'new' },
      { label: 'Cancel', value: null },
    ],
  });
  if (choice === 'new') return onboarding({ adding: true });
  if (choice && choice !== player.id) {
    const p = store.loadPlayer(choice);
    if (p) {
      player = p;
      store.setCurrent(p.id);
      setSound(p.settings.sound);
    }
  }
  home();
}

async function restoreFlow(frag) {
  try {
    const p = await readBackup(frag);
    const exists = store.loadPlayer(p.id);
    const ok = await dialog({
      icon: AVATARS[p.avatar] || '🙂',
      title: `Restore ${p.name}?`,
      body: exists
        ? `${p.name} is already on this device. Restoring combines the backup with it (nothing is lost).`
        : `This brings ${p.name}'s progress onto this device (${plural(p.tests?.length || 0, 'test')}, ${p.xp} XP).`,
      buttons: [{ label: 'Restore', value: true, primary: true }, { label: 'Cancel', value: false }],
    });
    if (!ok) return;
    store.savePlayer(store.mergeBackup(exists, p));
    store.setCurrent(p.id);
    toast(`✅ ${p.name} restored`);
  } catch (e) {
    await dialog({ icon: '⚠️', title: 'Can\'t restore', body: e.message || 'This backup link is not valid.' });
  }
}

// ---------- home ----------

function home() {
  const p = player;
  const mem = memorizedCount(p);
  const lvl = store.levelInfo(p.xp);
  const streak = store.streakCount(p);
  const today = store.todayCorrect(p);
  const next = weakestTable(p);
  const wins = Object.values(p.bosses).filter(b => b.stars > 0).length;
  const lastTest = p.tests[p.tests.length - 1];

  mount(h('div', { class: 'screen home' },
    h('header', { class: 'home-top' },
      h('button', { class: 'who', type: 'button', onclick: playerSheet, 'aria-label': 'Switch player' },
        h('span', { class: 'who-av' }, AVATARS[p.avatar]), h('span', { class: 'who-name' }, p.name), h('span', { class: 'muted' }, '▾')),
      h('div', { class: `streak ${streak ? 'on' : ''}`, title: 'Daily-goal streak' }, '🔥', h('b', null, String(streak))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', onclick: settings }, '⚙️')),
    h('div', { class: 'level' },
      h('div', { class: 'level-row' }, h('b', null, `Level ${lvl.level}`), h('span', null, lvl.title), h('span', { class: 'muted small' }, `${lvl.into}/${lvl.need} XP`)),
      h('div', { class: 'xpbar' }, h('i', { style: { width: `${(lvl.into / lvl.need) * 100}%` } }))),
    h('button', { class: 'card progress-card', type: 'button', onclick: mapScreen },
      h('div', { class: 'ring-wrap' }, ring(mem, TOTAL), h('div', { class: 'ring-label' }, h('b', null, String(mem)), h('span', null, `of ${TOTAL}`))),
      h('div', { class: 'pc-text' },
        h('div', { class: 'pc-title' }, 'Facts memorized'),
        h('div', { class: `goal ${today >= DAILY_GOAL ? 'done' : ''}` },
          today >= DAILY_GOAL ? '✅ Daily goal done!' : `🎯 Today: ${today}/${DAILY_GOAL} correct`),
        h('div', { class: 'goalbar' }, h('i', { style: { width: `${Math.min(100, (today / DAILY_GOAL) * 100)}%` } })),
        next && h('div', { class: 'muted small' }, `Next up: the ${next}s ${BOSSES[next].emoji}`),
        mem === TOTAL && h('div', { class: 'small' }, '🏆 All memorized! Keep them fresh.'))),
    h('button', { class: 'btn btn-primary btn-mode-main', type: 'button', onclick: trainMenu },
      h('span', { class: 'bm-icon' }, '🧠'),
      h('span', { class: 'bm-text' }, h('b', null, 'Train'), h('small', null, 'Smart daily practice')),
      h('span', { class: 'bm-go' }, '›')),
    h('div', { class: 'mode-grid' },
      modeTile('👾', 'Boss Battles', `${wins}/12 defeated`, bossMap, 't-pink'),
      modeTile('⚡', 'Blitz', p.blitzBest ? `Best: ${p.blitzBest}` : '60 seconds', startBlitz, 't-cyan'),
      modeTile('📋', 'Benchmark', lastTest ? `Last: ${fmtAgo(lastTest.start)}` : 'Test yourself', testIntro, 't-gold'),
      modeTile('🗺️', 'My Map', `${mem}/${TOTAL} facts`, mapScreen, 't-violet')),
    h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: historyScreen }, '📈 My results & sharing'),
    installTip()));
}

function modeTile(icon, title, sub, onclick, cls) {
  return h('button', { class: `mode-tile ${cls}`, type: 'button', onclick },
    h('span', { class: 'mt-icon' }, icon), h('b', null, title), h('small', null, sub));
}

function installTip() {
  if (!isIOS() || isStandalone() || store.lsGet('tipDismissed')) return null;
  const el = h('div', { class: 'card tip-card' },
    h('button', { class: 'tip-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { store.lsSet('tipDismissed', true); el.remove(); } }, '✕'),
    h('strong', null, '📲 Add me to your Home Screen'),
    h('p', { class: 'small' }, 'Tap the Share button ', h('span', { class: 'share-glyph' }, '⬆︎'), ' then “Add to Home Screen”. It plays full-screen and keeps your progress safe (Safari can erase website data you haven\'t opened for a week).'));
  return el;
}

// ---------- celebrations ----------

async function celebrate(res) {
  if (!res) return;
  for (const b of res.badges || []) {
    toast(`${b.icon} New badge: ${b.name}!`, 3200);
    confetti(80);
    sfx.win();
  }
  if (res.leveled) {
    const lvl = store.levelInfo(player.xp);
    sfx.levelUp();
    confetti(160);
    await dialog({ icon: '⭐', title: `Level ${lvl.level}!`, body: `You're now a ${lvl.title}!`, buttons: [{ label: 'Awesome!', value: true, primary: true }] });
  }
}

// ---------- training ----------

function trainMenu() {
  page('🧠 Training', home,
    h('button', { class: 'btn btn-primary btn-big stack', type: 'button', onclick: () => startTrain() },
      h('span', null, '✨ Smart practice'), h('small', null, 'Picks the facts you need most right now')),
    h('h2', { class: 'section-title' }, 'Or focus on one table'),
    h('div', { class: 'table-chips' },
      Array.from({ length: MAX }, (_, i) => i + 1).map(t => {
        const m = tableMastery(player, t);
        return h('button', { class: 'tchip', type: 'button', onclick: () => startTrain(t), 'aria-label': `${t} times table, ${Math.round(m * 100)}% memorized` },
          h('b', null, `${t}s`), h('span', { class: 'tchip-bar' }, h('i', { style: { width: `${Math.round(m * 100)}%` } })));
      })),
    card(
      h('h3', null, 'How training works'),
      h('ul', { class: 'bullets' },
        h('li', null, '⚡ Answer in under 3 seconds to make a fact stronger.'),
        h('li', null, '🐢 Slow answers mean you\'re still working it out — keep practicing.'),
        h('li', null, '✗ Miss one and you\'ll type the right answer, then see it again soon.'),
        h('li', null, '🗓️ A fact is “Memorized” after fast answers on different days. Come back tomorrow!'))));
}

async function startTrain(table = null) {
  const res = await play(trainMode(player, { table }));
  const fast = res.log.filter(l => l.res.fast).length;
  const slow = res.log.filter(l => l.res.correct && !l.res.fast).length;
  const miss = res.log.filter(l => !l.res.correct).length;
  const ups = res.log.filter(l => l.out === 'up').length;
  const missed = [...new Map(res.log.filter(l => !l.res.correct).map(l => [l.q.key, l.q])).values()];
  const great = res.log.length && fast / res.log.length >= 0.8;
  page(res.complete ? 'Round complete!' : 'Round stopped', null,
    h('div', { class: 'sum-hero' },
      h('div', { class: 'sum-emoji' }, great ? '🤩' : fast >= slow + miss ? '😄' : '💪'),
      h('h2', null, great ? 'Amazing speed!' : res.complete ? 'Nice work!' : 'Good effort!'),
      h('div', { class: 'xp-gain' }, `+${res.xp} XP`)),
    h('div', { class: 'tiles' },
      sumTile('⚡', fast, 'instant'), sumTile('🐢', slow, 'slow'), sumTile('✗', miss, 'missed')),
    ups > 0 && h('p', { class: 'center' }, `⬆️ ${plural(ups, 'fact')} got stronger!`),
    missed.length > 0 && card(
      h('h3', null, 'Remember these'),
      h('ul', { class: 'practice' }, missed.map(q => h('li', { class: 'p-miss' },
        h('span', { class: 'p-eq' }, `${q.a} × ${q.b} = ${q.a * q.b}`),
        h('span', { class: 'p-why' }, trickFor(q.a, q.b) || ''))))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startTrain(res.table) }, 'Train again'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: home }, 'Home')));
  if (great) confetti();
  celebrate(res);
}

const sumTile = (icon, n, label) => h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, `${icon} ${n}`), h('div', { class: 'tile-label' }, label));

// ---------- blitz ----------

async function startBlitz() {
  const res = await play(blitzMode(player));
  page('⚡ Blitz', null,
    h('div', { class: 'sum-hero' },
      h('div', { class: 'sum-emoji' }, res.newBest ? '🏆' : '⚡'),
      h('div', { class: 'hero-num' }, String(res.correct)),
      h('div', { class: 'hero-label' }, 'correct in 60 seconds'),
      res.newBest && h('div', { class: 'badge-new' }, res.best ? `New best! (was ${res.best})` : 'Your first Blitz score!'),
      !res.newBest && res.best > 0 && h('div', { class: 'muted' }, `Your best: ${res.best}`),
      h('div', { class: 'xp-gain' }, `+${res.xp} XP`)),
    h('p', { class: 'center muted' }, `${res.answered} answered · ${res.answered ? Math.round((res.correct / res.answered) * 100) : 0}% right`),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: startBlitz }, 'Play again'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: home }, 'Home')));
  if (res.newBest) { confetti(); sfx.win(); }
  celebrate(res);
}

// ---------- bosses ----------

function bossMap() {
  const next = weakestTable(player);
  page('👾 Boss Battles', home,
    h('p', { class: 'muted center' }, 'Each times table has a monster. Fast answers are critical hits ⚡. Three misses and the monster wins!'),
    h('div', { class: 'boss-grid' },
      Array.from({ length: MAX }, (_, i) => i + 1).map(t => {
        const b = BOSSES[t];
        const rec = player.bosses[t];
        const stars = rec?.stars || 0;
        return h('button', { class: `boss-tile ${stars ? 'beaten' : ''}`, type: 'button', onclick: () => startBoss(t) },
          t === next && !stars && h('span', { class: 'boss-tag' }, 'Next!'),
          h('span', { class: 'bt-emoji' }, b.emoji),
          h('b', null, `${t}s`),
          h('small', null, b.name),
          starRow(stars));
      })));
}

const starRow = (n, cls = '') => h('span', { class: `stars ${cls}`, 'aria-label': `${n} of 3 stars` },
  h('b', null, '★'.repeat(n)), h('i', null, '★'.repeat(3 - n)));

async function startBoss(t) {
  const res = await play(bossMode(player, t));
  const title = res.won ? 'Victory!' : res.outcome === 'escaped' ? 'It got away!' : res.outcome === 'quit' ? 'Retreat!' : 'Defeated…';
  page(`👾 ${title}`, null,
    h('div', { class: 'sum-hero' },
      h('div', { class: `sum-emoji ${res.won ? 'ko' : ''}` }, res.won ? '🏆' : res.boss.emoji),
      h('h2', null, res.won ? `You beat ${res.boss.name}!` : res.outcome === 'escaped' ? `${res.boss.name} escaped!` : `${res.boss.name} wins this time`),
      res.won && starRow(res.stars, 'big'),
      h('p', { class: 'muted' }, res.won
        ? (res.stars < 3 ? 'For 3 stars: no misses and mostly fast answers.' : 'Perfect battle!')
        : `Practice your ${t}s and come back — fast answers do double damage!`),
      h('div', { class: 'xp-gain' }, `+${res.xp} XP`)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startBoss(t) }, res.won ? 'Rematch' : 'Try again'),
      !res.won && h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => startTrain(t) }, `Train ${t}s`),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: bossMap }, 'All bosses')));
  if (res.won) { confetti(); sfx.win(); } else sfx.lose();
  celebrate(res);
}

// ---------- benchmark test ----------

function testIntro() {
  page('📋 Benchmark', home,
    card(
      h('h2', null, 'The big test'),
      h('ul', { class: 'bullets' },
        h('li', null, `🔢 All ${TOTAL} facts from 1 × 1 to 12 × 12, in random order`),
        h('li', null, '⏱ 6 seconds per question. Under 3 seconds = memorized ⚡'),
        h('li', null, '📵 Stay in the app! Leaving counts as a miss and shows on your results. Leave 3 times and the test stops.'),
        h('li', null, '🔁 Closing or reloading the app saves the test as incomplete'),
        h('li', null, '📤 At the end you get a results link to share with a grown-up'))),
    h('p', { class: 'center muted' }, 'Takes about 5 minutes. Find a quiet spot!'),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: startTest }, 'I\'m ready! 🚀'));
}

async function startTest() {
  const res = await play(testMode(player));
  await testResult(res.record, { fresh: res });
}

async function testResult(rec, { fresh = null, cached = null } = {}) {
  let url;
  let link;
  try {
    url = cached?.url || await shareLink(player, rec);
    link = cached?.link || await readLink(new URL(url).hash);
  } catch (e) {
    return page('Results', historyScreen, card(h('p', null, `⚠️ ${e.message}`)));
  }
  const shareBtn = () => h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: () => shareUrl(url) }, '📤 Share with a grown-up');
  const back = fresh ? home : historyScreen;
  page(fresh ? 'Your results' : `Benchmark #${rec.seq}`, back,
    fresh && h('div', { class: 'sum-hero compact' },
      h('div', { class: 'sum-emoji' }, rec.sum.reason ? '📋' : rec.sum.instant >= TOTAL * 0.9 ? '🏆' : '🎉'),
      h('h2', null, rec.sum.reason ? 'Test saved (incomplete)' : 'Test complete!'),
      fresh.xp > 0 && h('div', { class: 'xp-gain' }, `+${fresh.xp} XP`)),
    shareBtn(),
    resultsView(link, { onSealChange: () => testResult(rec, { cached: { url, link } }) }),
    shareBtn(),
    h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: back }, 'Done'));
  if (fresh) {
    if (!rec.sum.reason) confetti();
    celebrate(fresh);
  }
}

async function shareUrl(url) {
  const title = `${player.name}'s times tables results`;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 Link copied — paste it in a message');
  } catch {
    const ta = h('textarea', { class: 'input link-box', readonly: true, rows: 4 }, url);
    await dialog({ title: 'Copy this link', body: ta });
  }
}

function historyScreen() {
  const tests = [...player.tests].sort((a, b) => b.seq - a.seq);
  const done = [...player.tests].filter(t => !t.sum.reason).sort((a, b) => a.seq - b.seq);
  page('📈 My results', home,
    !tests.length && card(
      h('p', null, 'No benchmark tests yet. Take one to see how many facts you\'ve memorized!'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: testIntro }, 'Take a benchmark 📋')),
    done.length >= 2 && card(
      h('h2', null, 'Facts memorized'),
      lineChart(done.map(t => ({
        y: t.sum.instant,
        xLabel: fmtShortDate(t.start),
        tip: () => [...tipValue(`${t.sum.instant} / ${TOTAL}`, `Benchmark #${t.seq} · ${fmtDate(t.start)}`)],
      })), { max: TOTAL, goal: TOTAL, ticks: [0, 20, 40, 60] })),
    tests.length > 0 && h('div', { class: 'test-list' },
      tests.map(t => h('button', { class: 'test-row', type: 'button', onclick: () => testResult(t) },
        h('span', { class: 'tr-num' }, `#${t.seq}`),
        h('span', { class: 'tr-main' },
          h('b', null, t.sum.reason ? `Incomplete · ${t.sum.asked}/${TOTAL} asked` : `${t.sum.instant}/${TOTAL} memorized`),
          h('small', null, `${fmtDate(t.start)} · ${t.sum.correct} correct`)),
        h('span', { class: 'bm-go' }, '›')))),
    card(
      h('h3', null, '👪 For grown-ups'),
      h('p', { class: 'small' }, 'Open any test and tap “Share with a grown-up” to send a link. The link opens on any phone or computer and checks that the result is genuine.')));
}

// ---------- map ----------

function mapScreen() {
  const counts = LEVELS.map(() => 0);
  for (let a = 1; a <= MAX; a++) for (let b = a; b <= MAX; b++) counts[factState(player, factOf(a, b)).b]++;
  page('🗺️ My Map', home,
    h('p', { class: 'muted center small' }, 'Every fact from 1 × 1 to 12 × 12. Fast answers on different days make a square brighter. Tap one for a tip!'),
    h('div', { class: 'legend ramp', role: 'list' },
      LEVELS.map((name, i) => h('span', { class: 'legend-item', role: 'listitem' }, h('i', { class: `swatch lv-${i}` }), `${name} ${counts[i]}`))),
    card(factGrid((r, c) => {
      const st = factState(player, factOf(r, c));
      const last = st.t[st.t.length - 1];
      return {
        cls: `lv-${st.b}`,
        aria: `${r} × ${c}: ${LEVELS[st.b]}`,
        tip: () => [
          h('strong', null, `${r} × ${c} = ${r * c}`),
          h('span', null, `${LEVELS[st.b]}${st.n ? ` · ${st.c}/${st.n} right` : ''}${last ? ` · last ${(last / 1000).toFixed(1)}s` : ''}`),
          h('span', { class: 'tip-trick' }, `💡 ${trickFor(r, c)}`),
        ],
      };
    }, { label: 'Your memory map' })),
    h('button', { class: 'btn btn-primary wide', type: 'button', onclick: () => startTrain() }, '🧠 Train now'));
}

// ---------- settings & parent corner ----------

function settings() {
  const sound = h('input', {
    type: 'checkbox', class: 'switch', checked: player.settings.sound, 'aria-label': 'Sound effects',
    onchange: e => { player.settings.sound = e.target.checked; setSound(e.target.checked); store.savePlayer(player); },
  });
  page('⚙️ Settings', home,
    card(h('label', { class: 'setting' }, h('span', null, '🔊 Sound effects'), sound)),
    card(
      h('h3', null, 'Players on this device'),
      h('div', { class: 'player-list' },
        store.listPlayers().map(x => h('div', { class: 'player-row' },
          h('span', null, `${AVATARS[x.avatar] || '🙂'} ${x.name}`),
          h('span', { class: 'muted small' }, `ID ${shortId(x.id)}`),
          x.id === player.id
            ? h('span', { class: 'chip' }, 'Playing')
            : h('button', { class: 'btn btn-small', type: 'button', onclick: () => { player = store.loadPlayer(x.id); store.setCurrent(x.id); setSound(player.settings.sound); home(); } }, 'Switch')))),
      h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: () => onboarding({ adding: true }) }, '➕ Add a player')),
    !isStandalone() && card(
      h('h3', null, '📲 Install on the Home Screen'),
      h('p', { class: 'small' }, isIOS()
        ? 'In Safari, tap Share ⬆︎ → “Add to Home Screen”. The app opens full-screen and its progress is protected from Safari\'s 7-day cleanup.'
        : 'Use your browser\'s menu → “Install app” or “Add to Home screen”.')),
    h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: parentGate }, '👪 Parent corner'),
    h('p', { class: 'muted small center' }, `Player ID ${shortId(player.id)} · Times Table Quest`));
}

function parentGate() {
  const seal = deviceSeal();
  if (seal) {
    const input = h('input', { type: 'password', class: 'input', placeholder: 'Parent passphrase', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', autocomplete: 'current-password' });
    const msg = h('p', { class: 'small', 'aria-live': 'polite' });
    return page('👪 Parent corner', settings,
      h('form', {
        class: 'card',
        onsubmit: async e => {
          e.preventDefault();
          msg.textContent = 'Checking…';
          const k = await deriveSeal(input.value);
          if (fpText(k.fp) === fpText(seal.fp)) parentCorner();
          else msg.textContent = 'That passphrase isn\'t right.';
        },
      }, h('p', null, 'Enter the parent passphrase to continue.'), input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Open'), msg),
      h('button', {
        class: 'btn btn-ghost wide', type: 'button',
        onclick: async () => {
          const ok = await dialog({
            icon: '🔓', title: 'Forgot the passphrase?',
            body: 'You can remove the seal. New tests will then show “Parent seal: none” on their results, so it\'s easy to notice if anyone else does this.',
            buttons: [{ label: 'Remove seal', value: true, danger: true }, { label: 'Cancel', value: false }],
          });
          if (ok) { setDeviceSeal(null); parentCorner(); }
        },
      }, 'Forgot passphrase?'));
  }
  // No seal yet: a press-and-hold keeps casual taps out.
  let timer = null;
  const fill = h('i');
  const hold = h('button', { class: 'btn btn-hold', type: 'button' }, fill, h('span', null, 'Press and hold for 2 seconds'));
  const startHold = e => {
    e.preventDefault();
    hold.classList.add('holding');
    timer = setTimeout(parentCorner, 2000);
  };
  const stopHold = () => { hold.classList.remove('holding'); clearTimeout(timer); };
  hold.addEventListener('pointerdown', startHold);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, stopHold);
  hold.addEventListener('contextmenu', e => e.preventDefault());
  page('👪 Parent corner', settings, card(h('p', null, 'Grown-ups only! Set a parent seal inside to lock this area with a passphrase.'), hold));
}

function parentCorner() {
  const seal = deviceSeal();
  const p1 = h('input', { type: 'password', class: 'input', placeholder: 'New passphrase (6+ characters)', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', class: 'input', placeholder: 'Type it again', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', autocomplete: 'new-password' });
  const sealMsg = h('p', { class: 'small', 'aria-live': 'polite' });
  page('👪 Parent corner', settings,
    card(
      h('h2', null, 'Checking progress'),
      h('ol', { class: 'steps' },
        h('li', null, 'Say: “Take a Benchmark test and share your results with me.”'),
        h('li', null, 'They tap 📋 Benchmark. It takes about 5 minutes: all 78 facts, 6 seconds each.'),
        h('li', null, 'At the end they tap “Share with a grown-up” and send you the link (Messages, AirDrop…).'),
        h('li', null, 'Open the link on any device. A ✅ means it\'s a genuine, unedited result.')),
      h('p', { class: 'small muted' }, 'Results show every answer and its speed, how many times the app was left, the device, and how many tests were taken in the previous 24 hours — so a retaken or edited test is easy to spot.')),

    card(
      h('h2', null, '🔒 Parent seal'),
      h('p', { class: 'small' }, seal
        ? `On — seal ID ${fpText(seal.fp)}. New tests on this device are sealed with your passphrase, which also locks this Parent corner.`
        : 'Off. Turn it on for the strongest proof: results get a second signature made from your passphrase. Use the same passphrase on each kid\'s device, then confirm results on your phone by typing it once.'),
      h('form', {
        class: 'stack-form',
        onsubmit: async e => {
          e.preventDefault();
          if (p1.value.trim().length < 6) { sealMsg.textContent = 'Use at least 6 characters.'; return; }
          if (p1.value !== p2.value) { sealMsg.textContent = 'The two passphrases don\'t match.'; return; }
          sealMsg.textContent = 'Setting seal…';
          setDeviceSeal(await deriveSeal(p1.value));
          toast('🔒 Parent seal is on');
          parentCorner();
        },
      }, p1, p2, h('button', { class: 'btn btn-primary', type: 'submit' }, seal ? 'Change passphrase' : 'Turn on parent seal'), sealMsg),
      seal && h('button', {
        class: 'btn btn-ghost wide', type: 'button',
        onclick: async () => {
          const ok = await dialog({ title: 'Turn off the parent seal?', body: 'New tests will only have the app signature.', buttons: [{ label: 'Turn off', value: true, danger: true }, { label: 'Cancel', value: false }] });
          if (ok) { setDeviceSeal(null); parentCorner(); }
        },
      }, 'Turn off seal'),
      h('p', { class: 'small muted' }, 'Tests sealed with an old passphrase can still be confirmed with that old passphrase. If the seal is removed or replaced, new results show it — so you\'ll know.')),

    card(
      h('h2', null, '📵 Lock the phone to this app'),
      h('p', { class: 'small' }, 'The app already catches leaving mid-test. To make leaving impossible on iPhone/iPad, use Guided Access:'),
      h('ol', { class: 'steps small' },
        h('li', null, 'Settings → Accessibility → Guided Access → turn it on and set a passcode.'),
        h('li', null, 'Open Times Table Quest, then triple-click the side (or Home) button and tap Start.'),
        h('li', null, 'When they\'re done, triple-click again and enter your passcode.'))),

    card(
      h('h2', null, '💾 Backup & move devices'),
      h('p', { class: 'small' }, `Makes a link that restores ${player.name}'s progress on another phone or tablet, or after Safari clears website data.`),
      h('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          const url = await backupLink(player);
          if (navigator.share) {
            try { await navigator.share({ title: `${player.name} — Times Table Quest backup`, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
          }
          try { await navigator.clipboard.writeText(url); toast('🔗 Backup link copied'); } catch {
            await dialog({ title: 'Backup link', body: h('textarea', { class: 'input link-box', readonly: true, rows: 5 }, url) });
          }
        },
      }, `Back up ${player.name}`)),

    card(
      h('h2', null, '👤 Players'),
      store.listPlayers().map(x => h('div', { class: 'player-row' },
        h('span', null, `${AVATARS[x.avatar] || '🙂'} ${x.name}`),
        h('span', { class: 'btn-row tight' },
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => renamePlayer(x.id) }, 'Rename'),
          h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: () => removePlayer(x.id) }, 'Delete'))))));
}

async function renamePlayer(id) {
  const p = store.loadPlayer(id);
  const input = h('input', { class: 'input', value: p.name, maxlength: 20, 'aria-label': 'Name' });
  const ok = await dialog({ title: 'Rename player', body: input, buttons: [{ label: 'Save', value: true, primary: true }, { label: 'Cancel', value: false }] });
  if (!ok || !input.value.trim()) return;
  p.name = clip(input.value, 20);
  store.savePlayer(p);
  if (player.id === id) player = p;
  parentCorner();
}

async function removePlayer(id) {
  const p = store.loadPlayer(id);
  const ok = await dialog({
    icon: '⚠️', title: `Delete ${p.name}?`,
    body: 'All progress and test history for this player will be erased from this device. Results links already shared keep working.',
    buttons: [{ label: 'Delete', value: true, danger: true }, { label: 'Cancel', value: false }],
  });
  if (!ok) return;
  store.deletePlayer(id);
  if (player.id === id) {
    player = store.currentPlayer();
    if (!player) return onboarding();
  }
  parentCorner();
}

