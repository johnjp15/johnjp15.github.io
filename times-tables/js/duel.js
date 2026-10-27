// Duel: two players on one phone or iPad, face to face. Each half of the screen
// has its own question and keypad (the top half is upside down for the player
// across the table). Same questions in the same order for both; first to 15
// correct wins; a wrong answer locks that player's keypad for 1.5 s.

import { h } from './util.js';
import { RACE_TARGET, PENALTY_MS, raceStream, newSeed, fmtRace } from './race.js';
import { sfx, music } from './sfx.js';
import { confetti, shake } from './fx.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];

/**
 * players: [{ name, avatar }] (index 0 = bottom, 1 = top).
 * onAnswer(index, q, result) lets the caller record answers for real players.
 * Resolves with { winner, stats: [{ correct, wrong, ms }], quit }.
 */
export function runDuel({ players, onAnswer }) {
  return new Promise(resolve => {
    const seed = newSeed();
    let startedAt = 0;
    let pausedAt = 0;
    let done = false;
    let raf = 0;
    const sides = players.map((p, i) => makeSide(p, i));

    const clock = h('b', { class: 'duel-clock' }, '0.0s');
    const overlay = h('div', { class: 'duel-overlay', hidden: true });
    const el = h('div', { class: 'screen duel' },
      sides[1].el,
      h('div', { class: 'duel-mid' },
        h('button', { class: 'g-quit', type: 'button', 'aria-label': 'Stop the duel', onclick: () => end(null, true) }, '✕'),
        h('span', { class: 'duel-vs' }, 'VS'),
        clock),
      sides[0].el,
      overlay);

    function makeSide(p, i) {
      const stream = raceStream(seed);
      const s = { p, i, stream, q: null, input: '', correct: 0, wrong: 0, lockUntil: 0, t0: 0, combo: 0 };
      const fill = h('i');
      s.score = h('b', null, `0/${RACE_TARGET}`);
      s.qEl = h('div', { class: 'duel-q' });
      s.ansEl = h('div', { class: 'duel-ans empty' }, '?');
      s.msg = h('div', { class: 'duel-msg' });
      s.fill = fill;
      const pad = h('div', { class: 'pad duel-pad' },
        KEYS.map(k => h('button', { class: `key key-${k}`, type: 'button', 'data-k': k, 'aria-label': k === 'del' ? 'Delete' : k === 'ok' ? 'Enter' : k },
          k === 'del' ? '⌫' : k === 'ok' ? '✓' : k)));
      pad.addEventListener('pointerdown', e => {
        const b = e.target.closest('button');
        if (!b) return;
        e.preventDefault();
        b.classList.add('down');
        setTimeout(() => b.classList.remove('down'), 110);
        key(s, b.dataset.k);
      });
      s.card = h('div', { class: 'duel-card' }, s.qEl, h('div', { class: 'duel-ans-row' }, '= ', s.ansEl), s.msg);
      s.el = h('section', { class: `duel-half side-${i}` },
        h('header', { class: 'duel-head' },
          h('span', { class: 'duel-av' }, p.avatar), h('b', { class: 'duel-name' }, p.name),
          h('span', { class: 'duel-bar' }, fill), s.score),
        s.card, pad);
      return s;
    }

    function ask(s) {
      s.q = s.stream();
      s.q.answer = s.q.a * s.q.b;
      s.input = '';
      s.qEl.textContent = `${s.q.a} × ${s.q.b}`;
      s.ansEl.textContent = '?';
      s.ansEl.classList.add('empty');
      s.card.classList.remove('good', 'bad');
      s.msg.textContent = '';
      s.t0 = performance.now();
    }

    function key(s, k) {
      if (done || !startedAt || pausedAt || performance.now() < s.lockUntil) return;
      if (k === 'del') s.input = s.input.slice(0, -1);
      else if (k === 'ok') { if (s.input) return submit(s); }
      else if (s.input.length < 3) s.input += k;
      s.ansEl.textContent = s.input || '?';
      s.ansEl.classList.toggle('empty', !s.input);
      if (k !== 'del' && k !== 'ok' && s.input.length >= String(s.q.answer).length) submit(s);
    }

    function submit(s) {
      const ms = performance.now() - s.t0;
      const given = Number(s.input);
      const correct = given === s.q.answer;
      onAnswer?.(s.i, s.q, { correct, fast: correct && ms < 3000, ms, given, timeout: false, combo: correct ? s.combo + 1 : 0 });
      if (correct) {
        s.correct++;
        s.combo++;
        sfx.correct(s.combo);
        s.card.classList.add('good');
        s.score.textContent = `${s.correct}/${RACE_TARGET}`;
        s.fill.style.width = `${(s.correct / RACE_TARGET) * 100}%`;
        if (s.correct >= RACE_TARGET) return end(s.i);
        s.lockUntil = performance.now() + 180;
        setTimeout(() => !done && ask(s), 180);
      } else {
        s.wrong++;
        s.combo = 0;
        sfx.wrong();
        shake(s.card);
        s.card.classList.add('bad');
        s.ansEl.textContent = String(s.q.answer);
        s.msg.textContent = '⏳ +1.5s';
        s.lockUntil = performance.now() + PENALTY_MS;
        setTimeout(() => !done && ask(s), PENALTY_MS);
      }
    }

    function tick() {
      if (done) return;
      if (startedAt && !pausedAt) clock.textContent = fmtRace(Date.now() - startedAt);
      raf = requestAnimationFrame(tick);
    }

    function countdown(then, alive = () => true) {
      let n = 3;
      overlay.hidden = false;
      const step = () => {
        if (done || !alive()) return;
        if (n === 0) {
          overlay.hidden = true;
          sfx.go();
          return then();
        }
        overlay.replaceChildren(h('div', { class: 'duel-count flip' }, String(n)), h('div', { class: 'duel-count' }, String(n)));
        sfx.tick();
        n--;
        setTimeout(step, 700);
      };
      step();
    }

    // Leaving the app pauses the duel; it resumes with a fresh countdown.
    let resume = 0;
    const onVis = () => {
      if (done || !startedAt) return;
      if (document.visibilityState === 'hidden') {
        resume++;
        if (!pausedAt) pausedAt = Date.now();
      } else if (pausedAt) {
        const mine = ++resume;
        countdown(() => {
          startedAt += Date.now() - pausedAt;
          pausedAt = 0;
          sides.forEach(ask);
        }, () => mine === resume);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const noScroll = e => e.preventDefault();
    el.addEventListener('touchmove', noScroll, { passive: false });

    function end(winner, quit = false) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      music.stop();
      const ms = startedAt ? Date.now() - startedAt : 0;
      const stats = sides.map(s => ({ correct: s.correct, wrong: s.wrong, ms }));
      if (quit) {
        document.documentElement.classList.remove('in-game');
        return resolve({ winner: null, stats, quit: true });
      }
      sfx.win();
      confetti(140);
      const banner = s => h('div', { class: `duel-result ${s.i === winner ? 'won' : 'lost'} side-${s.i}` },
        h('div', { class: 'duel-result-emoji' }, s.i === winner ? '🏆' : '😅'),
        h('b', null, s.i === winner ? `${s.p.name} wins!` : 'So close!'),
        h('small', null, `${s.correct}/${RACE_TARGET} · ${fmtRace(ms)}`));
      overlay.hidden = false;
      overlay.classList.add('final');
      overlay.replaceChildren(
        banner(sides[1]),
        h('div', { class: 'duel-result-buttons' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { document.documentElement.classList.remove('in-game'); resolve({ winner, stats, quit: false, rematch: true }); } }, '🔁 Rematch'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { document.documentElement.classList.remove('in-game'); resolve({ winner, stats, quit: false }); } }, 'Done')),
        banner(sides[0]));
    }

    document.getElementById('app').replaceChildren(el);
    document.documentElement.classList.add('in-game');
    tick();
    countdown(() => {
      startedAt = Date.now();
      music.play('race');
      sides.forEach(ask);
    });
  });
}
