// Flash cards: the "learn it" step before the timed modes. Look at a fact, say
// the answer out loud, flip to check, then be honest: "Got it" or "Again".
// No timer and no score here — mastery levels only change in timed modes, so
// self-grading can never inflate progress.

import { h } from './util.js';
import { MAX, trickFor } from './facts.js';
import { factState, MEMORIZED_BOX } from './srs.js';
import { sfx, speak } from './sfx.js';

/** The cards for one table, in order: 7 × 1, 7 × 2 … 7 × 12. */
export const tableCards = t => Array.from({ length: MAX }, (_, i) => ({ a: t, b: i + 1 }));

/** Up to 12 facts that need the most help: ones being learned, then the most-missed. */
export function trickyCards(player) {
  const list = Object.entries(player.facts)
    .map(([key, st]) => ({ key, st, misses: st.n - st.c }))
    .filter(x => x.st.b === 1 || x.misses > 0)
    .sort((x, y) => (x.st.b === 1 ? 0 : 1) - (y.st.b === 1 ? 0 : 1) || y.misses - x.misses)
    .slice(0, 12);
  return list.map(({ key }) => {
    const [a, b] = key.split('x').map(Number);
    return Math.random() < 0.5 ? { a, b } : { a: b, b: a };
  });
}

export const hasTrickyCards = player => Object.values(player.facts).some(st => st.b === 1 || st.n > st.c);

/** b rows of a dots, with the running total at the end of each row (skip-counting). */
function dots(a, b) {
  return h('div', { class: 'fc-dots', style: { '--cols': String(a) }, 'aria-hidden': 'true' },
    Array.from({ length: b }, (_, r) => h('div', { class: 'fc-row' },
      h('span', { class: 'fc-row-dots' }, Array.from({ length: a }, () => h('i'))),
      h('b', { class: r === b - 1 ? 'last' : '' }, String(a * (r + 1))))));
}

/**
 * Run a deck. Resolves with { total, again, quit }.
 * player is only read (to show the fact's current level); nothing is recorded here.
 */
export function runFlashcards({ title, cards, player }) {
  return new Promise(resolve => {
    const queue = [...cards];
    const total = cards.length;
    let known = 0;
    let again = 0;
    let card = null;
    let flipped = false;
    let busy = false;

    const countEl = h('div', { class: 'hud-stat' });
    const fill = h('i');
    const front = h('div', { class: 'fc-face fc-front' });
    const back = h('div', { class: 'fc-face fc-back' });
    const cardEl = h('div', { class: 'fc-card', role: 'button', tabindex: '0', 'aria-label': 'Flash card. Tap to flip.' },
      h('div', { class: 'fc-inner' }, front, back));
    const actions = h('div', { class: 'fc-actions' });
    const el = h('div', { class: 'screen flash' },
      h('header', { class: 'g-top' },
        h('button', { class: 'g-quit', type: 'button', 'aria-label': 'Close', onclick: () => done(true) }, '✕'),
        h('div', { class: 'g-hud' }, h('div', { class: 'hud-title' }, title), h('div', { class: 'hud-progress' }, fill), countEl)),
      h('div', { class: 'fc-stage' }, cardEl),
      actions);

    const btn = (cls, label, fn) => h('button', { class: `btn ${cls}`, type: 'button', onclick: fn }, label);

    function show() {
      card = queue.shift();
      if (!card) return done(false);
      flipped = false;
      // Reset without animating, so the next card's answer never shows while it turns back.
      cardEl.classList.add('instant');
      cardEl.classList.remove('flipped', 'fly-left', 'fly-right', 'deal');
      void cardEl.offsetWidth;
      cardEl.classList.remove('instant');
      cardEl.classList.add('deal');
      countEl.textContent = `✓ ${known}/${total}`;
      fill.style.width = `${(known / total) * 100}%`;
      const p = card.a * card.b;
      const level = player ? factState(player, { key: card.a <= card.b ? `${card.a}x${card.b}` : `${card.b}x${card.a}` }).b : 0;
      front.replaceChildren(...[
        h('div', { class: 'fc-q' }, `${card.a} × ${card.b}`),
        h('div', { class: 'fc-hint' }, '🗣️ Say the answer, then tap to flip'),
        level >= MEMORIZED_BOX && h('div', { class: 'fc-badge' }, '⭐ You know this one!'),
      ].filter(Boolean));
      const trick = trickFor(card.a, card.b);
      back.replaceChildren(...[
        h('div', { class: 'fc-eq' }, `${card.a} × ${card.b} = `, h('b', null, String(p))),
        dots(card.a, card.b),
        h('div', { class: 'fc-count' }, `${card.b} ${card.b === 1 ? 'row' : 'rows'} of ${card.a} = ${p}`),
        trick && h('div', { class: 'fc-trick' }, `💡 ${trick}`),
        h('button', {
          class: 'fc-say', type: 'button', 'aria-label': 'Hear it',
          onclick: e => { e.stopPropagation(); speak(`${card.a} times ${card.b} is ${p}`); },
        }, '🔊 Hear it'),
      ].filter(Boolean));
      actions.replaceChildren(btn('btn-primary btn-big', 'Flip card ↺', flip));
    }

    function flip() {
      if (flipped || busy) return;
      flipped = true;
      cardEl.classList.add('flipped');
      sfx.tick();
      actions.replaceChildren(
        btn('btn-ghost fc-again', '↻ Again', () => rate(false)),
        btn('btn-primary fc-got', '✓ Got it', () => rate(true)));
    }

    function rate(gotIt) {
      if (!flipped || busy) return;
      busy = true;
      if (gotIt) {
        known++;
        sfx.correct(0);
      } else {
        again++;
        sfx.slow();
        // See it again soon, but not immediately.
        queue.splice(Math.min(queue.length, 3), 0, card);
      }
      cardEl.classList.add(gotIt ? 'fly-right' : 'fly-left');
      setTimeout(() => { busy = false; show(); }, 260);
    }

    // Tap to flip; once flipped, swipe right = got it, left = again.
    let startX = null;
    cardEl.addEventListener('pointerdown', e => { startX = e.clientX; });
    cardEl.addEventListener('pointerup', e => {
      const dx = startX == null ? 0 : e.clientX - startX;
      startX = null;
      if (flipped && Math.abs(dx) > 60) return rate(dx > 0);
      if (Math.abs(dx) < 10) flip();
    });
    const onKey = e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipped ? rate(true) : flip(); }
      else if (e.key === 'ArrowRight') rate(true);
      else if (e.key === 'ArrowLeft') rate(false);
    };
    document.addEventListener('keydown', onKey);
    const noScroll = e => e.preventDefault();
    el.addEventListener('touchmove', noScroll, { passive: false });

    function done(quit) {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('in-game');
      resolve({ total, again, quit, known });
    }

    document.getElementById('app').replaceChildren(el);
    document.documentElement.classList.add('in-game');
    show();
  });
}
