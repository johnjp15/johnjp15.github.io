// Every screen of the app (except the game itself, see game.js).

import { h, rand, clip, shuffle, dayKey, fmtAgo, fmtShortDate, fmtDate, isIOS, isStandalone, plural, shortId } from './util.js';
import { TOTAL, BOSSES, MAX, factOf, trickFor } from './facts.js';
import { LEVELS, memorizedCount, tableMastery, weakestTable, factState } from './srs.js';
import * as store from './store.js';
import { play } from './game.js';
import { trainMode, blitzMode, bossMode, testMode, finalizeAbandonedTest } from './modes.js';
import { runFlashcards, tableCards, trickyCards, hasTrickyCards } from './flashcards.js';
import { shareLink, readLink, backupLink, readBackup, deviceSeal, setDeviceSeal, deriveSeal, fpText, cryptoReady } from './certs.js';
import { resultsView } from './results-view.js';
import { factGrid, lineChart, ring, tipValue } from './charts.js';
import { confetti, toast, dialog } from './fx.js';
import { sfx, applySound, unlockAudio, onSoundChange } from './sfx.js';
import * as family from './family.js';
import { familyBoard, familyStrip } from './family-view.js';
import { runDuel } from './duel.js';
import { RACE_TARGET, fmtRace, newSeed } from './race.js';
import { raceMode } from './race-mode.js';
import { connectLive, onLive, liveSend, liveState, toLocal } from './live.js';
import { hostRoom, joinRoom } from './room.js';

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
  window.addEventListener('hashchange', () => { if (/^#(restore|family)=/.test(location.hash)) location.reload(); });
  // Share progress when the app is put away (keepalive lets the request finish).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && player) family.syncPlayer(player); });
  document.addEventListener('gesturestart', e => e.preventDefault()); // no pinch-zoom mid-game
  onSoundChange(next => {
    if (!player) return;
    player.settings = { ...player.settings, music: next.music };
    store.savePlayer(player);
  });
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

  let invite = null;
  if (location.hash.startsWith('#family=')) {
    invite = family.parseInvite(location.hash.slice('#family='.length));
    history.replaceState(null, '', location.pathname + location.search);
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
  if (player) applySound(player.settings);
  listenForInvites();
  ensureLive();
  if (invite) return inviteFlow(invite);
  if (!player) return family.getFamily()?.viewer ? familyScreen() : onboarding();
  home();
  if (interrupted) {
    dialog({ icon: '🏅', title: 'Unfinished Mastery Check', body: `Mastery Check #${interrupted.seq} was interrupted (the app was closed or reloaded), so it was saved as incomplete.` });
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
      onsubmit: async e => {
        e.preventDefault();
        e.submitter?.setAttribute('disabled', '');
        player = store.createPlayer({ name: nameInput.value, avatar });
        applySound(player.settings);
        const pending = store.lsGet('pendingInvite');
        if (pending) {
          store.lsSet('pendingInvite', null);
          try {
            const f = await family.joinFamily(pending, { players: [player] });
            await family.syncPlayer(player, { force: true });
            toast(`👪 Joined ${f.name}`);
          } catch {
            toast('⚠️ Couldn\'t join the family — open the invite link again');
          }
        }
        firstRun();
      },
    },
    h('label', { class: 'field-label' }, 'What should we call you?'),
    nameInput,
    h('label', { class: 'field-label' }, 'Pick your buddy'),
    pick,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, 'Let\'s go! 🚀'),
    adding && h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (player ? home() : familyScreen()) }, 'Cancel'),
    !adding && family.familyEnabled() && h('button', { class: 'btn btn-ghost', type: 'button', onclick: grownUpSetup }, '👀 I\'m a grown-up — set up family tracking'))));
}

async function firstRun() {
  home();
  const go = await dialog({
    icon: AVATARS[player.avatar],
    title: `Welcome, ${player.name}!`,
    body: 'First, let\'s find out which facts you already know with a Mastery Check. It takes about 5 minutes.',
    buttons: [{ label: 'Take the Mastery Check 🏅', value: true, primary: true }, { label: 'Maybe later', value: false }],
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
      applySound(p.settings);
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
  ensureLive();
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
    familySlot(),
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
    h('button', { class: 'btn btn-learn', type: 'button', onclick: flashMenu },
      h('span', { class: 'bm-icon' }, '🃏'),
      h('span', { class: 'bm-text' }, h('b', null, 'Flash Cards'), h('small', null, 'Learn a table, one card at a time')),
      h('span', { class: 'bm-go' }, '›')),
    h('div', { class: 'mode-grid' },
      modeTile('👾', 'Boss Battles', `${wins}/12 defeated`, bossMap, 't-pink'),
      modeTile('⚡', 'Blitz', p.blitzBest ? `Best: ${p.blitzBest}` : '60 seconds', startBlitz, 't-cyan'),
      modeTile('⚔️', 'Versus', 'Race someone to 15', versusMenu, 't-orange'),
      modeTile('🏅', 'Mastery Check', lastTest ? `Last: ${fmtAgo(lastTest.start)}` : 'Test yourself', testIntro, 't-gold'),
      modeTile('🗺️', 'My Map', `${mem}/${TOTAL} facts`, mapScreen, 't-violet'),
      modeTile('📈', 'My Results', p.tests.length ? `${plural(p.tests.length, 'check')} · share` : 'Share with a grown-up', historyScreen, 't-green')),
    installTip()));
}

/** Home's family strip: shows the cached board at once, then refreshes. */
function familySlot() {
  const f = family.getFamily();
  if (!f || !family.familyEnabled()) return null;
  const slot = h('div', { class: 'fam-slot' });
  const show = r => { if (r?.board) slot.replaceChildren(familyStrip(r, familyScreen)); };
  if (f.board) show({ board: f.board });
  (async () => {
    await family.syncPlayer(player);
    show(await family.fetchBoard());
  })();
  return slot;
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
  if (player) family.syncPlayer(player);
  if (!res) return;
  if (res.xp > 0) setTimeout(() => sfx.coin(), 350);
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
    missed.length > 0 && h('button', {
      class: 'btn btn-learn-small wide', type: 'button',
      onclick: () => startFlash({ custom: missed.map(q => ({ a: q.a, b: q.b })), label: 'Missed' }),
    }, '🃏 Study these as flash cards'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startTrain(res.table) }, 'Train again'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: home }, 'Home')));
  if (great) confetti();
  celebrate(res);
}

const sumTile = (icon, n, label) => h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, `${icon} ${n}`), h('div', { class: 'tile-label' }, label));

// ---------- flash cards ----------

function flashMenu() {
  let mix = !!store.lsGet('fcShuffle');
  const sw = h('input', {
    type: 'checkbox', class: 'switch', checked: mix, 'aria-label': 'Shuffle the cards',
    onchange: e => { mix = e.target.checked; store.lsSet('fcShuffle', mix); },
  });
  page('🃏 Flash Cards', home,
    h('p', { class: 'muted center small' }, 'Pick a table. Look at each card, say the answer out loud, then flip it to check. Be honest — tap “Again” if you weren\'t sure!'),
    h('div', { class: 'table-chips' },
      Array.from({ length: MAX }, (_, i) => i + 1).map(t => {
        const m = tableMastery(player, t);
        const studied = player.cards?.[t];
        return h('button', { class: `tchip ${studied ? 'studied' : ''}`, type: 'button', onclick: () => startFlash({ table: t, mix }), 'aria-label': `${t} times table flash cards${studied ? ', studied' : ''}` },
          h('b', null, `${t}s`, studied ? h('span', { class: 'tchip-check' }, ' ✓') : null),
          h('span', { class: 'tchip-bar' }, h('i', { style: { width: `${Math.round(m * 100)}%` } })));
      })),
    card(h('label', { class: 'setting' }, h('span', null, '🔀 Shuffle the cards'), sw)),
    hasTrickyCards(player) && h('button', { class: 'btn btn-learn-small wide', type: 'button', onclick: () => startFlash({ tricky: true }) }, '🧩 My tricky facts'),
    card(
      h('h3', null, 'The learning path'),
      h('ol', { class: 'steps' },
        h('li', null, '🃏 Learn a table here with flash cards.'),
        h('li', null, '🧠 Train it until the answers pop out in under 3 seconds.'),
        h('li', null, '👾 Beat that table\'s boss.'),
        h('li', null, '🏅 Prove it in a Mastery Check!'))));
}

/** deck: { table, mix } | { tricky } | { custom: [{ a, b }], label } */
async function startFlash(deck) {
  const { table = null, tricky = false, custom = null, label = '', mix = false } = deck;
  const cards = custom || (tricky ? trickyCards(player) : tableCards(table));
  const title = custom ? `🃏 ${label}` : tricky ? '🧩 Tricky' : `🃏 ${table}s`;
  const res = await runFlashcards({ title, cards: mix || tricky || custom ? shuffle(cards) : cards, player });
  store.recordCards(player, res.known + res.again);
  if (res.quit && res.known === 0) {
    store.savePlayer(player);
    return table ? flashMenu() : home();
  }

  let xp = 0;
  if (!res.quit) {
    const key = custom ? 'custom' : tricky ? 'tricky' : String(table);
    const rec = (player.cards[key] ||= { times: 0, last: null });
    rec.times++;
    if (rec.last !== dayKey()) xp = 15; // once per deck per day
    rec.last = dayKey();
  }
  const leveled = store.addXp(player, xp);
  const badges = store.checkBadges(player);
  store.savePlayer(player);

  const t = table;
  page(res.quit ? 'Cards put away' : 'Deck done!', null,
    h('div', { class: 'sum-hero' },
      h('div', { class: 'sum-emoji' }, res.quit ? '🃏' : res.again ? '🧠' : '🌟'),
      h('h2', null, t ? `You studied the ${t}s!` : 'Cards studied!'),
      h('p', { class: 'muted' }, res.quit
        ? `${res.known} of ${res.total} cards done.`
        : res.again ? `${plural(res.again, 'card')} needed another look — that's how learning works!` : 'Every card right on the first try!'),
      xp > 0 && h('div', { class: 'xp-gain' }, `+${xp} XP`)),
    card(
      h('h3', null, '🔒 Now lock it in'),
      h('p', { class: 'small' }, 'Flash cards help you learn. Speed makes it stick — now try answering without the cards.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startTrain(t) }, t ? `⚡ Quiz me on ${t}s` : '🧠 Train'),
      t && h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => startBoss(t) }, `${BOSSES[t].emoji} Fight the ${t}s boss`)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => startFlash(deck) }, '🃏 Go again'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: home }, 'Home')));
  if (!res.quit && !res.again) confetti(90);
  celebrate({ leveled, badges });
}

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
      !res.won && h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => startFlash({ table: t }) }, `🃏 Study ${t}s`),
      !res.won && h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => startTrain(t) }, `Train ${t}s`),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: bossMap }, 'All bosses')));
  if (res.won) { confetti(); sfx.win(); } else sfx.lose();
  celebrate(res);
}

// ---------- Mastery Check ----------

function testIntro() {
  page('🏅 Mastery Check', home,
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
  page(fresh ? 'Your results' : `Mastery Check #${rec.seq}`, back,
    fresh && h('div', { class: 'sum-hero compact' },
      h('div', { class: 'sum-emoji' }, rec.sum.reason ? '🏅' : rec.sum.instant >= TOTAL * 0.9 ? '🏆' : '🎉'),
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
      h('p', null, 'No Mastery Checks yet. Take one to see how many facts you\'ve memorized!'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: testIntro }, 'Take a Mastery Check 🏅')),
    done.length >= 2 && card(
      h('h2', null, 'Facts memorized'),
      lineChart(done.map(t => ({
        y: t.sum.instant,
        xLabel: fmtShortDate(t.start),
        tip: () => [...tipValue(`${t.sum.instant} / ${TOTAL}`, `Mastery Check #${t.seq} · ${fmtDate(t.start)}`)],
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
  const toggle = (key, label, hint) => {
    const input = h('input', {
      type: 'checkbox', class: 'switch', checked: player.settings[key] !== false, 'aria-label': label,
      onchange: e => {
        player.settings = { ...player.settings, [key]: e.target.checked };
        applySound(player.settings);
        store.savePlayer(player);
        if (key === 'sound' && e.target.checked) sfx.correct(3);
      },
    });
    return h('label', { class: 'setting' }, h('span', null, label, hint && h('small', { class: 'muted setting-hint' }, hint)), input);
  };
  page('⚙️ Settings', home,
    h('button', { class: 'card buddy-row', type: 'button', onclick: changeBuddy },
      h('span', { class: 'who-av' }, AVATARS[player.avatar] || '🙂'),
      h('span', { class: 'bm-text' }, h('b', null, player.name), h('small', { class: 'muted' }, 'Tap to change your buddy')),
      h('span', { class: 'bm-go' }, '›')),
    card(
      h('div', { class: 'stack-form' },
        toggle('sound', '🔊 Sounds'),
        toggle('music', '🎵 Music while playing'),
        isIOS() && toggle('loud', '🔔 Play sounds on silent', 'iPhones mute games when the side switch is on silent. Turn this on to hear sounds anyway.'))),
    card(
      h('h3', null, 'Players on this device'),
      h('div', { class: 'player-list' },
        store.listPlayers().map(x => h('div', { class: 'player-row' },
          h('span', null, `${AVATARS[x.avatar] || '🙂'} ${x.name}`),
          h('span', { class: 'muted small' }, `ID ${shortId(x.id)}`),
          x.id === player.id
            ? h('span', { class: 'chip' }, 'Playing')
            : h('button', { class: 'btn btn-small', type: 'button', onclick: () => { player = store.loadPlayer(x.id); store.setCurrent(x.id); applySound(player.settings); home(); } }, 'Switch')))),
      h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: () => onboarding({ adding: true }) }, '➕ Add a player')),
    !isStandalone() && card(
      h('h3', null, '📲 Install on the Home Screen'),
      h('p', { class: 'small' }, isIOS()
        ? 'In Safari, tap Share ⬆︎ → “Add to Home Screen”. The app opens full-screen and its progress is protected from Safari\'s 7-day cleanup.'
        : 'Use your browser\'s menu → “Install app” or “Add to Home screen”.')),
    family.getFamily() && h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: familyScreen }, `👪 ${family.getFamily().name}`),
    h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: parentGate }, '🔒 Parent corner'),
    h('p', { class: 'muted small center' }, `Player ID ${shortId(player.id)} · Times Table Quest`));
}

async function changeBuddy() {
  let picked = null;
  const grid = h('div', { class: 'avatar-pick' }, AVATARS.map((a, i) => h('button', {
    class: `av ${i === player.avatar ? 'sel' : ''}`, type: 'button', 'aria-label': `Buddy ${i + 1}`,
    onclick: () => { picked = i; dlg.close(); },
  }, a)));
  const dlg = dialog({ title: 'Pick your buddy', body: grid, buttons: [{ label: 'Cancel', value: null }] });
  await dlg;
  if (picked == null || picked === player.avatar) return;
  player.avatar = picked;
  store.savePlayer(player);
  family.syncPlayer(player, { force: true });
  sfx.correct(3);
  settings();
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
        h('li', null, 'Say: “Take a Mastery Check and share your results with me.”'),
        h('li', null, 'They tap 🏅 Mastery Check. It takes about 5 minutes: all 78 facts, 6 seconds each.'),
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

    family.familyEnabled() && familyCard(),

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
  if (family.getFamily()?.tokens[id]) await family.removeMember(id).catch(() => {});
  store.deletePlayer(id);
  if (player.id === id) {
    player = store.currentPlayer();
    if (!player) return onboarding();
  }
  parentCorner();
}


// ---------- family ----------

/** Ask for a short piece of text in a dialog. */
async function askText({ icon, title, body, value = '', placeholder = '', ok = 'OK', max = 24 }) {
  const input = h('input', { class: 'input', value, placeholder, maxlength: max, autocapitalize: 'words', 'aria-label': title });
  const res = await dialog({
    icon, title, body: h('div', null, body && h('p', null, body), input),
    buttons: [{ label: ok, value: true, primary: true }, { label: 'Cancel', value: false }],
  });
  return res ? clip(input.value, max) : null;
}

const familyError = e => (e?.status === 403 || e?.status === 404
  ? 'This invite link doesn\'t work anymore. Ask for a new one.'
  : 'Couldn\'t reach the family server. Check the internet connection and try again.');

async function shareInvite(f) {
  const url = family.inviteLink(f);
  const text = `Join ${f.name} on Times Table Quest so we can see each other's practice:`;
  if (navigator.share) {
    try { await navigator.share({ title: `Join ${f.name}`, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 Invite link copied');
  } catch {
    await dialog({ title: 'Invite link', body: h('textarea', { class: 'input link-box', readonly: true, rows: 4 }, url) });
  }
}

/** Opened an invite link on this device. */
async function inviteFlow(invite) {
  const proceed = () => (player ? home() : family.getFamily()?.viewer ? familyScreen() : onboarding());
  if (!family.familyEnabled()) {
    await dialog({ icon: '👪', title: 'Not switched on yet', body: 'Family sharing isn\'t switched on in this app yet.' });
    return proceed();
  }
  if (!invite) {
    await dialog({ icon: '⚠️', title: 'Can\'t join', body: 'This invite link is incomplete. Ask for it to be sent again.' });
    return proceed();
  }
  mount(h('div', { class: 'screen onboard' }, h('div', { class: 'sum-emoji' }, '👪'), h('p', { class: 'lead' }, 'Checking the invite…')));
  let board;
  try {
    board = await family.peekFamily(invite);
  } catch (e) {
    await dialog({ icon: '⚠️', title: 'Can\'t join', body: familyError(e) });
    return proceed();
  }
  const current = family.getFamily();
  const players = store.listPlayers().map(x => store.loadPlayer(x.id)).filter(Boolean);
  if (current?.id === invite.id && players.every(p => current.tokens[p.id])) {
    toast(`👪 Already in ${board.name}`);
    return proceed();
  }
  const leaving = current && current.id !== invite.id ? ` This device will leave ${current.name}.` : '';
  let choice;
  if (players.length) {
    const names = players.map(p => p.name).join(' & ');
    choice = await dialog({
      icon: '👪', title: `Join ${board.name}?`,
      body: `${names} will share practice progress with the family and see everyone else's.${leaving}`,
      buttons: [{ label: 'Join', value: 'player', primary: true }, { label: 'Cancel', value: null }],
    });
  } else {
    choice = await dialog({
      icon: '👪', title: `Join ${board.name}`,
      body: `Is this phone for someone who'll practice, or a grown-up who wants to watch?${leaving}`,
      buttons: [
        { label: '🎮 I\'ll practice', value: 'player', primary: true },
        { label: '👀 I\'m a grown-up, just watching', value: 'viewer' },
        { label: 'Cancel', value: null },
      ],
    });
  }
  try {
    if (choice === 'player' && players.length) {
      await family.joinFamily(invite, { players });
      await Promise.all(players.map(p => family.syncPlayer(p, { force: true })));
      toast(`👪 Joined ${board.name}`);
      return familyScreen();
    }
    if (choice === 'player') {
      store.lsSet('pendingInvite', invite);
      return onboarding();
    }
    if (choice === 'viewer') {
      const name = await askText({ icon: '👀', title: 'What should the kids call you?', placeholder: 'Mom, Dad, Grandpa…', ok: 'Join' });
      if (!name) return proceed();
      await family.joinFamily(invite, { viewerName: name });
      return familyScreen();
    }
  } catch (e) {
    await dialog({ icon: '⚠️', title: 'Can\'t join', body: familyError(e) });
  }
  return proceed();
}

/** A grown-up's own phone: create the family and watch, no player needed. */
async function grownUpSetup() {
  const nameInput = h('input', { class: 'input', placeholder: 'Mom, Dad, Grandpa…', maxlength: 24, autocapitalize: 'words', 'aria-label': 'Your name' });
  const famInput = h('input', { class: 'input', value: 'Our family', maxlength: 40, autocapitalize: 'words', 'aria-label': 'Family name' });
  const msg = h('p', { class: 'small', 'aria-live': 'polite' });
  page('👀 Family tracking', onboarding,
    card(
      h('p', null, 'Set up a family on this phone to see every kid\'s practice: who practiced today, streaks, facts memorized and Mastery Checks.'),
      h('p', { class: 'small muted' }, 'You won\'t need a player profile. Next you\'ll get an invite link to send to each kid\'s device.')),
    h('form', {
      class: 'card stack-form',
      onsubmit: async e => {
        e.preventDefault();
        const name = clip(nameInput.value, 24);
        if (!name) { msg.textContent = 'Add your name so the kids know who\'s watching.'; return; }
        msg.textContent = 'Creating…';
        try {
          const f = await family.createFamily(clip(famInput.value, 40) || 'Our family');
          await family.joinFamily({ id: f.id, secret: f.secret }, { viewerName: name });
          await familyScreen();
          shareInvite(family.getFamily());
        } catch (err) {
          msg.textContent = familyError(err);
        }
      },
    },
    h('label', { class: 'field-label' }, 'Your name'), nameInput,
    h('label', { class: 'field-label' }, 'Family name'), famInput,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create family'), msg),
    card(h('p', { class: 'small' }, 'Already have an invite link? Just open it on this phone.')));
}

/** The family board. On a grown-up's phone (no player) it's the home screen. */
async function familyScreen() {
  const f = family.getFamily();
  if (!f) return player ? familySetup() : onboarding();
  ensureLive();
  const viewerHome = !player;
  const me = Object.keys(f.tokens);
  const body = h('div', null, h('p', { class: 'muted center' }, 'Loading…'));
  const stamp = h('p', { class: 'muted small center' });
  page(`👪 ${f.name}`, viewerHome ? null : home,
    body,
    stamp,
    h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: () => render(true) }, '🔄 Refresh'),
    viewerHome && card(
      h('h3', null, '👀 Grown-up tools'),
      h('div', { class: 'stack-form' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => shareInvite(family.getFamily()) }, '📨 Invite someone'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => manageFamily(familyScreen) }, '👥 Manage members'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => onboarding({ adding: true }) }, '➕ Add a player on this phone'))),
    !viewerHome && h('p', { class: 'muted small center' }, 'Grown-ups manage the family in ⚙️ → Parent corner.'));

  async function render(force) {
    if (!body.isConnected) return;
    const r = await family.fetchBoard({ force });
    if (!body.isConnected) return;
    if (!r?.board) {
      body.replaceChildren(card(h('p', null, r?.gone ? 'This family no longer exists, or this device was removed from it.' : '📡 Couldn\'t reach the family server. Check the internet connection and refresh.')));
      return;
    }
    body.replaceChildren(familyBoard(r, me, liveState.online));
    stamp.textContent = r.offline ? '' : `Updated ${fmtAgo(r.fetchedAt || Date.now())}`;
  }

  if (player) await family.syncPlayer(player);
  await render(true);
  const timer = setInterval(() => (body.isConnected ? render(true) : clearInterval(timer)), 30000);
  const off = onLive(type => {
    if (!body.isConnected) return off();
    if (type === 'presence' || type === 'hello') render(false);
  });
}

/** Before joining a family (reached from the Parent corner on a kid's device). */
function familySetup() {
  const famInput = h('input', { class: 'input', value: `${player.name}'s family`, maxlength: 40, autocapitalize: 'words', 'aria-label': 'Family name' });
  const msg = h('p', { class: 'small', 'aria-live': 'polite' });
  page('👪 Family', parentCorner,
    card(
      h('h2', null, 'See each other\'s practice'),
      h('p', null, 'Everyone in a family sees who practiced today, streaks, facts memorized and Mastery Checks — each on their own phone.')),
    h('form', {
      class: 'card stack-form',
      onsubmit: async e => {
        e.preventDefault();
        msg.textContent = 'Creating…';
        try {
          const f = await family.createFamily(clip(famInput.value, 40) || 'Our family');
          const players = store.listPlayers().map(x => store.loadPlayer(x.id)).filter(Boolean);
          await family.joinFamily({ id: f.id, secret: f.secret }, { players });
          await Promise.all(players.map(p => family.syncPlayer(p, { force: true })));
          await familyScreen();
          shareInvite(family.getFamily());
        } catch (err) {
          msg.textContent = familyError(err);
        }
      },
    },
    h('h3', null, 'Start a family'), famInput,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create family'), msg),
    card(h('h3', null, 'Already have an invite?'), h('p', { class: 'small' }, 'Open the invite link on this device and it joins automatically.')));
}

/** Parent corner card. */
function familyCard() {
  const f = family.getFamily();
  if (!f) {
    return card(
      h('h2', null, '👪 Family'),
      h('p', { class: 'small' }, 'Let everyone in the family see each other\'s practice on their own phones. Tip: create it on your own phone (“I\'m a grown-up” on the welcome screen) and send invite links to the kids.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: familySetup }, 'Set up a family'));
  }
  return card(
    h('h2', null, `👪 ${f.name}`),
    h('div', { class: 'stack-form' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => shareInvite(f) }, '📨 Invite someone'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: familyScreen }, 'See the family board'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => manageFamily(parentCorner) }, '👥 Manage members')),
    h('p', { class: 'small muted' }, 'Anyone with the invite link can join, so only send it to family.'));
}

async function manageFamily(back) {
  const f = family.getFamily();
  const r = await family.fetchBoard({ force: true });
  const members = r?.board?.members || [];
  const localPlayers = store.listPlayers();
  const removedHere = localPlayers.filter(x => f.removed?.[x.id]);
  page('👥 Members', back,
    card(
      members.length ? members.map(m => h('div', { class: 'player-row' },
        h('span', null, `${m.role === 'viewer' ? '🧑' : AVATARS[m.avatar] || '🙂'} ${m.name}${m.role === 'viewer' ? ' (watching)' : ''}`),
        h('button', {
          class: 'btn btn-small btn-danger', type: 'button',
          onclick: async () => {
            const ok = await dialog({ title: `Remove ${m.name}?`, body: 'They disappear from the family board. Their own progress stays on their device.', buttons: [{ label: 'Remove', value: true, danger: true }, { label: 'Cancel', value: false }] });
            if (!ok) return;
            await family.removeMember(m.memberId).catch(e => toast(`⚠️ ${familyError(e)}`));
            manageFamily(back);
          },
        }, 'Remove'))) : h('p', { class: 'muted' }, r ? 'No members yet.' : 'Couldn\'t reach the family server.')),
    removedHere.length > 0 && card(
      h('h3', null, 'Removed players on this device'),
      removedHere.map(x => h('div', { class: 'player-row' },
        h('span', null, `${AVATARS[x.avatar] || '🙂'} ${x.name}`),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { await family.rejoinPlayer(store.loadPlayer(x.id)).catch(() => {}); manageFamily(back); } }, 'Add back')))),
    h('button', {
      class: 'btn btn-ghost wide', type: 'button',
      onclick: async () => {
        const ok = await dialog({ title: `Leave ${f.name}?`, body: 'This device stops sharing and seeing family progress. You can rejoin with an invite link.', buttons: [{ label: 'Leave family', value: true, danger: true }, { label: 'Cancel', value: false }] });
        if (!ok) return;
        await family.leaveFamily();
        toast('Left the family');
        if (player) home(); else onboarding();
      },
    }, 'Leave family on this device'));
}

// ---------- versus ----------

function versusMenu() {
  const inFamily = family.familyEnabled() && family.getFamily();
  page('⚔️ Versus', home,
    h('p', { class: 'muted center' }, `Race to ${RACE_TARGET} correct answers. Everyone gets the same questions. A wrong answer costs 1.5 seconds!`),
    h('button', { class: 'btn btn-primary vs-option', type: 'button', onclick: duelSetup },
      h('span', { class: 'bm-icon' }, '📱'),
      h('span', { class: 'bm-text' }, h('b', null, 'Duel on this phone'), h('small', null, 'Two players, one screen, face to face'))),
    h('button', { class: 'btn btn-learn vs-option', type: 'button', onclick: roomMenu },
      h('span', { class: 'bm-icon' }, '📡'),
      h('span', { class: 'bm-text' }, h('b', null, 'Race a friend\'s phone'), h('small', null, 'Live, phone to phone, with a 4-digit code'))),
    versusFamilyOptions(),
    !inFamily && family.familyEnabled() && card(h('p', { class: 'small' }, '👪 Join your family (ask a grown-up) to challenge each other on your own phones — even when you\'re not together.')));
}

// ---------- versus with the family (on your own phones) ----------

/** Keep the live link open as whoever uses this device (player, or a watching grown-up). */
function ensureLive() {
  const f = family.familyEnabled() && family.getFamily();
  const id = player?.id || f?.viewer?.id;
  if (f && id && f.tokens?.[id] && liveState.me !== id) connectLive(id);
}

const seenInvites = new Set();
function listenForInvites() {
  onLive((type, r) => {
    if (type === 'challenge') return;
    if (type !== 'race' || !player || r.state !== 'lobby' || r.host === player.id || r.players[player.id]) return;
    if (seenInvites.has(r.id) || Date.now() - toLocal(r.created) > 60000) return;
    seenInvites.add(r.id);
    const host = r.players[r.host];
    if (document.documentElement.classList.contains('in-game')) {
      toast(`⚡ ${host.name} wants to race — open Versus to join`);
      return;
    }
    sfx.coin();
    dialog({
      icon: '⚡', title: `${host.name} wants to race!`, body: `First to ${RACE_TARGET} correct wins.`,
      buttons: [{ label: '🏁 Join the race', value: true, primary: true }, { label: 'Not now', value: false }],
    }).then(ok => { if (ok) joinLiveRace(r.id); });
  });
}

const avatarOf = a => (typeof a === 'number' ? AVATARS[a] || '🙂' : a || '🙂');
const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;

function versusFamilyOptions() {
  const f = family.familyEnabled() && family.getFamily();
  if (!f || !player || !f.tokens[player.id]) return null;
  const slot = h('div', { class: 'stack-form' });
  const online = h('p', { class: 'small muted' });
  const showOnline = () => {
    const members = family.getFamily()?.board?.members || [];
    const names = members.filter(m => m.role !== 'viewer' && m.memberId !== player.id && liveState.online.includes(m.memberId)).map(m => m.name);
    online.textContent = liveState.connected ? (names.length ? `🟢 Online now: ${names.join(', ')}` : 'Nobody else has the app open right now.') : '📡 Connecting…';
  };
  const fill = async (force = false) => {
    const r = await family.fetchBoard({ force });
    if (!slot.isConnected) return;
    const challenges = r?.board?.challenges || [];
    const todo = challenges.filter(c => !c.entries[player.id] && c.from !== player.id && Date.now() - c.created < 7 * 864e5);
    const mine = challenges.filter(c => c.entries[player.id]).slice(0, 5);
    const lobbies = Object.values(liveState.races).filter(x => x.state === 'lobby' && !x.players[player.id]);
    slot.replaceChildren(...[
      h('button', { class: 'btn btn-learn vs-option', type: 'button', onclick: createLiveRace },
        h('span', { class: 'bm-icon' }, '⚡'),
        h('span', { class: 'bm-text' }, h('b', null, 'Live race'), h('small', null, 'Race family members who have the app open'))),
      online,
      ...lobbies.map(x => h('button', { class: 'btn btn-primary wide', type: 'button', onclick: () => joinLiveRace(x.id) }, `🏁 Join ${x.players[x.host]?.name}'s race`)),
      h('button', { class: 'btn btn-ghost vs-option', type: 'button', onclick: setChallenge },
        h('span', { class: 'bm-icon' }, '👻'),
        h('span', { class: 'bm-text' }, h('b', null, 'Challenge the family'), h('small', null, 'Set a time — they race your ghost later'))),
      todo.length > 0 && card(
        h('h3', null, '👻 Challenges for you'),
        h('div', { class: 'stack-form' }, todo.map(c => {
          const from = c.entries[c.from];
          return h('button', { class: 'btn btn-primary wide', type: 'button', onclick: () => raceChallenge(c) },
            `${avatarOf(from?.avatar)} ${from?.name || 'Someone'} · ${fmtRace(from?.ms)} to beat`);
        }))),
      mine.length > 0 && card(
        h('h3', null, '🏆 Recent challenges'),
        mine.map(c => {
          const rows = family.standings(c.entries);
          return h('div', { class: 'ch-row' }, rows.slice(0, 4).map((e, i) =>
            h('span', { class: e.id === player.id ? 'me' : '' }, `${medal(i)} ${e.name} ${e.ms ? fmtRace(e.ms) : `(${e.correct}/${RACE_TARGET})`}`)));
        })),
    ].filter(Boolean));
    showOnline();
  };
  fill(true);
  const off = onLive(type => {
    if (!slot.isConnected) return off();
    if (type === 'presence' || type === 'hello') showOnline();
    if (type === 'race' || type === 'challenge' || type === 'hello') fill(type === 'challenge');
  });
  return slot;
}

/** Host a live race: create it, then wait in the lobby. */
function createLiveRace() {
  if (!liveState.connected) return toast('📡 Not connected to the family yet — try again in a moment');
  const known = new Set(Object.keys(liveState.races));
  const timer = setTimeout(() => { off(); toast('⚠️ The family server didn\'t answer'); }, 6000);
  const off = onLive((type, r) => {
    if (type !== 'race' || known.has(r.id) || r.host !== player.id) return;
    off();
    clearTimeout(timer);
    raceLobby(r.id);
  });
  liveSend({ t: 'create' });
}

function joinLiveRace(id) {
  liveSend({ t: 'join', id });
  raceLobby(id);
}

function raceLobby(id) {
  const body = h('div', { class: 'stack-form' });
  let off = () => {};
  const leave = () => { liveSend({ t: 'leave', id }); off(); versusMenu(); };
  const render = () => {
    if (!body.isConnected) return off();
    const r = liveState.races[id];
    if (!r) return;
    if (r.state === 'cancelled') { off(); toast('The race was cancelled'); return versusMenu(); }
    if (r.state === 'running') {
      if (!r.players[player.id]) { off(); toast('That race already started'); return versusMenu(); }
      off();
      return runLiveRace(r);
    }
    const isHost = r.host === player.id;
    const racers = Object.entries(r.players);
    const watching = (family.getFamily()?.board?.members || []).filter(m => m.role !== 'viewer' && liveState.online.includes(m.memberId) && !r.players[m.memberId]);
    body.replaceChildren(...[
      card(
        h('h2', null, isHost ? 'Your race' : `${r.players[r.host]?.name}'s race`),
        h('div', { class: 'lobby-list' }, racers.map(([mid, p]) => h('div', { class: 'lobby-player' },
          h('span', { class: 'race-av' }, avatarOf(p.avatar)), h('b', null, p.name), mid === r.host ? ' 👑' : '', mid === player.id ? h('span', { class: 'chip' }, 'You') : null))),
        h('p', { class: 'small muted' }, isHost
          ? (racers.length < 2 ? 'Everyone in the family with the app open got an invite. Waiting for someone to join…' : 'Ready when you are!')
          : `Waiting for ${r.players[r.host]?.name} to start…`),
        watching.length > 0 && h('p', { class: 'small muted' }, `🟢 Also online: ${watching.map(m => m.name).join(', ')}`)),
      isHost && h('button', { class: 'btn btn-primary btn-big', type: 'button', disabled: racers.length < 2, onclick: () => liveSend({ t: 'start', id }) },
        racers.length < 2 ? 'Waiting for a racer…' : `🏁 Start the race (${racers.length} racers)`),
      h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: leave }, isHost ? 'Cancel race' : 'Leave'),
    ].filter(Boolean));
  };
  page('⚡ Live race', leave, body);
  off = onLive(type => { if (type === 'race' || type === 'presence' || type === 'hello') render(); });
  render();
}

async function runLiveRace(r) {
  const others = Object.entries(r.players).filter(([mid]) => mid !== player.id).map(([mid, p]) => ({ id: mid, name: p.name, avatar: p.avatar }));
  const mode = raceMode(player, {
    seed: r.seed, title: '⚡ Live race', lanes: others, startAt: toLocal(r.startAt),
    onProgress: (n, wrong) => liveSend({ t: 'progress', id: r.id, n, wrong }),
  });
  const off = onLive((type, data) => {
    if (type === 'progress' && data.id === r.id && data.member !== player.id) mode.setLane(data.member, data.n);
    if (type === 'race' && data.id === r.id) {
      for (const [mid, p] of Object.entries(data.players)) if (mid !== player.id) mode.setLane(mid, p.n, p);
    }
  });
  const res = await play(mode);
  off();
  liveSend({ t: 'finish', id: r.id, n: res.correct, wrong: res.wrong });
  family.syncPlayer(player);
  raceResults(r.id);
}

function raceResults(id) {
  const body = h('div', { class: 'stack-form' });
  let cheered = false;
  const render = () => {
    if (!body.isConnected) return off();
    const r = liveState.races[id];
    if (!r) return;
    const rows = family.standings(r.players);
    const doneAll = r.state === 'done';
    const place = rows.findIndex(x => x.id === player.id);
    if (doneAll && !cheered) {
      cheered = true;
      if (place === 0 && rows[0].ms != null) { confetti(); sfx.win(); } else sfx.slow();
    }
    body.replaceChildren(...[
      h('div', { class: 'sum-hero' },
        h('div', { class: 'sum-emoji' }, !doneAll ? '⏳' : place === 0 && rows[0].ms != null ? '🏆' : '🏁'),
        h('h2', null, !doneAll ? 'Waiting for everyone to finish…' : rows[0].ms == null ? 'Nobody finished!' : rows[0].id === player.id ? 'You won!' : `${rows[0].name} won!`)),
      card(h('ol', { class: 'standings' }, rows.map((x, i) => h('li', { class: x.id === player.id ? 'me' : '' },
        h('span', null, medal(i)), h('span', { class: 'race-av' }, avatarOf(x.avatar)), h('b', null, x.name),
        h('span', { class: 'muted' }, x.done ? (x.ms != null ? fmtRace(x.ms) : `${x.n}/${RACE_TARGET} · didn't finish`) : `${x.n}/${RACE_TARGET}…`))))),
      doneAll && h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { off(); createLiveRace(); } }, '⚡ Race again'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { off(); versusMenu(); } }, 'Done')),
    ].filter(Boolean));
  };
  page('⚡ Race results', null, body);
  const off = onLive(type => { if (type === 'race' || type === 'progress' || type === 'hello') render(); });
  render();
}

/** Play a race; the time becomes a challenge others race as a ghost. */
async function setChallenge() {
  const seed = newSeed();
  const res = await play(raceMode(player, { seed, title: '👻 Set a challenge' }));
  family.syncPlayer(player);
  if (res.quit || res.ms == null) {
    return page('👻 Challenge', versusMenu,
      h('div', { class: 'sum-hero' }, h('div', { class: 'sum-emoji' }, '🏁'), h('h2', null, 'No time set'), h('p', { class: 'muted' }, `Get to ${RACE_TARGET} correct to set a challenge.`)),
      h('button', { class: 'btn btn-primary btn-big', type: 'button', onclick: setChallenge }, 'Try again'));
  }
  let sent = true;
  try {
    await family.createChallenge(player, seed, { ms: res.ms, correct: res.correct, wrong: res.wrong, timeline: res.timeline });
  } catch {
    sent = false;
  }
  page('👻 Challenge set!', null,
    h('div', { class: 'sum-hero' },
      h('div', { class: 'sum-emoji' }, sent ? '👻' : '📡'),
      h('div', { class: 'hero-num' }, fmtRace(res.ms)),
      h('div', { class: 'hero-label' }, `to ${RACE_TARGET} correct`),
      h('p', { class: 'muted' }, sent ? 'Everyone in your family can now race your ghost on the same questions.' : 'Couldn\'t send it to the family — check the internet connection.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: versusMenu }, 'Done'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: setChallenge }, 'Set another')));
  if (sent) { sfx.win(); confetti(70); }
}

/** Race everyone who already raced this challenge, as ghosts. */
async function raceChallenge(c) {
  const from = c.entries[c.from];
  const lanes = family.standings(c.entries).map(e => ({ id: e.id, name: e.name, avatar: e.avatar, ghost: e.timeline }));
  const res = await play(raceMode(player, { seed: c.seed, title: `👻 ${from?.name || 'Ghost'}'s challenge`, lanes }));
  family.syncPlayer(player);
  if (res.quit) return versusMenu();
  try {
    await family.answerChallenge(player, c.id, { ms: res.ms, correct: res.correct, wrong: res.wrong, timeline: res.timeline });
  } catch { /* shown below with the local result */ }
  const rows = family.standings({ ...c.entries, [player.id]: { name: player.name, avatar: player.avatar, ms: res.ms, correct: res.correct } });
  const place = rows.findIndex(x => x.id === player.id);
  page('👻 Challenge results', null,
    h('div', { class: 'sum-hero' },
      h('div', { class: 'sum-emoji' }, place === 0 && res.ms != null ? '🏆' : '👻'),
      h('h2', null, place === 0 && res.ms != null ? 'You beat everyone!' : res.ms != null ? `${medal(place)} place` : 'Didn\'t finish this time')),
    card(h('ol', { class: 'standings' }, rows.map((x, i) => h('li', { class: x.id === player.id ? 'me' : '' },
      h('span', null, medal(i)), h('span', { class: 'race-av' }, avatarOf(x.avatar)), h('b', null, x.name),
      h('span', { class: 'muted' }, x.ms != null ? fmtRace(x.ms) : `${x.correct}/${RACE_TARGET}`))))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: versusMenu }, 'Done'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: setChallenge }, '👻 Set your own')));
  if (place === 0 && res.ms != null) { sfx.win(); confetti(); }
}

function duelSetup() {
  const locals = store.listPlayers();
  const options = [...locals.map(x => ({ id: x.id, name: x.name, avatar: AVATARS[x.avatar] || '🙂' })), { id: 'guest', name: 'Guest', avatar: '🙂' }];
  const select = (value, label) => h('select', { class: 'input', 'aria-label': label },
    options.map(o => h('option', { value: o.id, selected: o.id === value }, `${o.avatar} ${o.name}`)));
  const other = locals.find(x => x.id !== player.id);
  const s1 = select(player.id, 'Player at the bottom');
  const s2 = select(other ? other.id : 'guest', 'Player at the top');
  const guestName = h('input', { class: 'input', placeholder: 'Guest\'s name', maxlength: 16, autocapitalize: 'words', 'aria-label': 'Guest name' });
  const syncGuest = () => { guestName.hidden = s1.value !== 'guest' && s2.value !== 'guest'; };
  s1.addEventListener('change', syncGuest);
  s2.addEventListener('change', syncGuest);
  syncGuest();
  const msg = h('p', { class: 'small', 'aria-live': 'polite' });
  page('📱 Duel', versusMenu,
    card(
      h('p', { class: 'small' }, 'Lay the phone (or iPad) flat between you. Each player gets their own half of the screen and their own keypad.'),
      h('div', { class: 'vs-pick' },
        h('div', null, h('label', { class: 'field-label' }, '⬆️ Top'), s2),
        h('span', { class: 'vs-sep' }, 'VS'),
        h('div', null, h('label', { class: 'field-label' }, '⬇️ Bottom'), s1)),
      guestName),
    h('button', {
      class: 'btn btn-primary btn-big', type: 'button',
      onclick: () => {
        if (s1.value === s2.value && s1.value !== 'guest') { msg.textContent = 'Pick two different players.'; return; }
        const pick = id => {
          if (id === 'guest') return { id: null, name: clip(guestName.value, 16) || 'Guest', avatar: '🙂' };
          const p = store.loadPlayer(id);
          return { id, name: p.name, avatar: AVATARS[p.avatar] || '🙂', player: p };
        };
        startDuel([pick(s1.value), pick(s2.value)]);
      },
    }, '⚔️ Start duel'),
    msg);
}

async function startDuel(sides) {
  const res = await runDuel({
    players: sides,
    onAnswer: (i, q, r) => { if (sides[i].player) store.recordAnswer(sides[i].player, q, r); },
  });
  for (const [i, s] of sides.entries()) {
    if (!s.player) continue;
    const v = (s.player.versus ||= { duels: 0, duelWins: 0 });
    if (!res.quit) {
      v.duels++;
      if (res.winner === i) v.duelWins++;
    }
    store.savePlayer(s.player);
    if (s.player.id === player.id) player = s.player;
    family.syncPlayer(s.player);
  }
  if (res.rematch) return startDuel(sides);
  if (res.quit) return versusMenu();
  const w = sides[res.winner];
  page('⚔️ Duel over', null,
    h('div', { class: 'sum-hero' },
      h('div', { class: 'sum-emoji' }, '🏆'),
      h('h2', null, `${w.avatar} ${w.name} wins!`),
      h('p', { class: 'muted' }, `${fmtRace(res.stats[res.winner].ms)} to ${RACE_TARGET} correct`)),
    h('div', { class: 'tiles' },
      ...sides.map((s, i) => h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, `${s.avatar} ${res.stats[i].correct}`), h('div', { class: 'tile-label' }, `${s.name} · ✗ ${res.stats[i].wrong}`)))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startDuel(sides) }, '🔁 Rematch'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: home }, 'Home')));
}

// ---------- room-code races (phone to phone) ----------

function roomMenu() {
  const me = { name: player.name, avatar: player.avatar };
  const codeInput = h('input', {
    class: 'input big code-input', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, placeholder: '0000',
    autocomplete: 'off', 'aria-label': 'Race code',
  });
  const msg = h('p', { class: 'small', 'aria-live': 'polite' });
  const busy = async (btn, label, fn) => {
    btn.disabled = true;
    msg.textContent = label;
    try {
      await fn();
    } catch (e) {
      msg.textContent = `⚠️ ${e.message}`;
      btn.disabled = false;
    }
  };
  const hostBtn = h('button', {
    class: 'btn btn-primary btn-big', type: 'button',
    onclick: () => busy(hostBtn, 'Getting a code…', async () => roomLobby(await hostRoom(me))),
  }, '📡 Host a race');
  const joinBtn = h('button', { class: 'btn btn-learn wide', type: 'submit' }, 'Join race');
  page('📡 Race a friend', versusMenu,
    h('p', { class: 'muted center' }, `Race on 2–4 phones at once, live. Everyone gets the same questions — first to ${RACE_TARGET} correct wins.`),
    hostBtn,
    h('form', {
      class: 'card stack-form',
      onsubmit: e => {
        e.preventDefault();
        const code = codeInput.value.replace(/\D/g, '');
        if (code.length !== 4) { msg.textContent = 'Type the 4-digit code from the other phone.'; return; }
        busy(joinBtn, 'Connecting…', async () => roomLobby(await joinRoom(code, me)));
      },
    }, h('h3', null, 'Got a code?'), codeInput, joinBtn),
    msg,
    h('p', { class: 'small muted center' }, 'Works best with both phones on the same Wi-Fi.'));
}

function roomLobby(room) {
  const myId = room.isHost ? 'host' : room.myId;
  const body = h('div', { class: 'stack-form' });
  let off = () => {};
  const leave = () => { off(); room.close(); versusMenu(); };
  const render = () => {
    const racers = room.players();
    body.replaceChildren(...[
      room.isHost && card(
        h('div', { class: 'room-code-label' }, 'Race code'),
        h('div', { class: 'room-code', 'aria-label': `Race code ${room.code.split('').join(' ')}` }, room.code),
        h('p', { class: 'small muted center' }, 'On the other phone: ⚔️ Versus → 📡 Race a friend\'s phone → type this code.')),
      card(
        h('h3', null, room.isHost ? 'Racers' : `Joined race ${room.code}`),
        h('div', { class: 'lobby-list' }, racers.map(p => h('div', { class: 'lobby-player' },
          h('span', { class: 'race-av' }, avatarOf(p.avatar)), h('b', null, p.name), p.id === 'host' ? ' 👑' : '',
          p.id === myId ? h('span', { class: 'chip' }, 'You') : null))),
        !room.isHost && h('p', { class: 'small muted' }, 'Waiting for the host to start…')),
      room.isHost && h('button', { class: 'btn btn-primary btn-big', type: 'button', disabled: racers.length < 2, onclick: () => room.start() },
        racers.length < 2 ? 'Waiting for someone to join…' : `🏁 Start the race (${racers.length} racers)`),
      h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: leave }, room.isHost ? 'Close the race' : 'Leave'),
    ].filter(Boolean));
  };
  page('📡 Race a friend', leave, body);
  off = room.on((type, data) => {
    if (type === 'lobby') render();
    if (type === 'start') { off(); runRoomRace(room, data); }
    if (type === 'closed') { off(); room.close(); toast(`📡 ${data}`); versusMenu(); }
  });
  render();
}

async function runRoomRace(room, start) {
  const myId = room.isHost ? 'host' : room.myId;
  const lanes = start.players.filter(p => p.id !== myId).map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
  const mode = raceMode(player, {
    seed: start.seed, title: '📡 Live race', lanes, startAt: start.startAt,
    onProgress: (n, wrong) => room.progress(n, wrong),
  });
  let result = null;
  const off = room.on((type, data) => {
    if (type === 'progress' && data.id !== myId) mode.setLane(data.id, data.n);
    if (type === 'result') result = data;
  });
  const res = await play(mode);
  room.finish({ correct: res.correct, wrong: res.wrong, ms: res.ms });
  off();
  family.syncPlayer(player);
  roomResults(room, myId, result || room.lastResult());
}

function roomResults(room, myId, initial) {
  let players = initial;
  let cheered = false;
  const body = h('div', { class: 'stack-form' });
  const leave = () => { off(); room.close(); versusMenu(); };
  const render = () => {
    const rows = players ? family.standings(Object.fromEntries(players.map(p => [p.id, p]))) : null;
    const won = rows && rows[0].id === myId && rows[0].ms != null;
    if (rows && !cheered) {
      cheered = true;
      if (won) { confetti(); sfx.win(); } else sfx.slow();
    }
    body.replaceChildren(...[
      h('div', { class: 'sum-hero' },
        h('div', { class: 'sum-emoji' }, !rows ? '⏳' : won ? '🏆' : '🏁'),
        h('h2', null, !rows ? 'Waiting for everyone to finish…' : rows[0].ms == null ? 'Nobody finished!' : won ? 'You won!' : `${rows[0].name} won!`)),
      rows && card(h('ol', { class: 'standings' }, rows.map((x, i) => h('li', { class: x.id === myId ? 'me' : '' },
        h('span', null, medal(i)), h('span', { class: 'race-av' }, avatarOf(x.avatar)), h('b', null, x.name),
        h('span', { class: 'muted' }, x.ms != null ? fmtRace(x.ms) : `${x.n}/${RACE_TARGET}${x.gone ? ' · left' : ''}`))))),
      rows && room.isHost && h('button', { class: 'btn btn-primary btn-big', type: 'button', disabled: room.players().length < 2, onclick: () => room.start() }, '🔁 Race again'),
      rows && !room.isHost && h('p', { class: 'muted center small' }, 'If the host starts another race, you\'ll join it automatically.'),
      h('button', { class: 'btn btn-ghost wide', type: 'button', onclick: leave }, 'Leave'),
    ].filter(Boolean));
  };
  page('📡 Race results', null, body);
  const off = room.on((type, data) => {
    if (type === 'result') { players = data; render(); }
    if (type === 'lobby') render();
    if (type === 'start') { off(); runRoomRace(room, data); }
    if (type === 'closed') { toast(`📡 ${data}`); if (!players) leave(); }
  });
  render();
}
