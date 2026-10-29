// Duel: two players on one phone or iPad, face to face. Each half of the screen
// has its own question and keypad (the top half is upside down for the player
// across the table). Any Versus mode (versus.js) can be played this way: both
// halves get the same questions in the same order, and the mode's referee
// decides the rest.

import { h, keypadKeys } from './util.js';
import { raceStream, newSeed, fmtRace } from './race.js';
import { PENALTY_MS, act, laneInfo, verdictTitle } from './versus.js';
import { sfx, music } from './sfx.js';
import { confetti, shake } from './fx.js';

/**
 * players: [{ name, avatar, keypad }] (index 0 = bottom, 1 = top); mode: from versus.js.
 * onAnswer(index, q, result) lets the caller record answers for real players.
 * Resolves with { winners: [index], title, st, stats: [{ correct, wrong }], quit, rematch }.
 */
export function runDuel({ players, mode, onAnswer }) {
  return new Promise(resolve => {
    const seed = newSeed();
    const st = mode.init(['0', '1'], { duel: true });
    const people = Object.fromEntries(players.map((p, i) => [String(i), p]));
    let startedAt = 0;
    let pausedAt = 0;
    let done = false;
    let raf = 0;
    const at = () => (startedAt ? (pausedAt || Date.now()) - startedAt : 0);
    const sides = players.map((p, i) => makeSide(p, i));

    const clock = h('b', { class: 'duel-clock' }, '');
    const overlay = h('div', { class: 'duel-overlay', hidden: true });
    const el = h('div', { class: `screen duel mode-${mode.id}` },
      sides[1].el,
      h('div', { class: 'duel-mid' },
        h('button', { class: 'g-quit', type: 'button', 'aria-label': 'Stop the duel', onclick: () => end(true) }, '✕'),
        h('span', { class: 'duel-vs' }, `${mode.icon} VS`),
        clock),
      sides[0].el,
      overlay);

    function makeSide(p, i) {
      const s = { p, i, id: String(i), stream: raceStream(seed), q: null, input: '', correct: 0, wrong: 0, lockUntil: 0, t0: 0, limit: 0, combo: 0, asking: false, armed: false };
      s.fill = h('i');
      s.score = h('b', { class: 'duel-score' });
      s.qEl = h('div', { class: 'duel-q' });
      s.ansEl = h('div', { class: 'duel-ans empty' }, '?');
      s.msg = h('div', { class: 'duel-msg' });
      s.timer = h('i');
      if (mode.potions) {
        s.potionBtn = h('button', { class: 'potion-btn', type: 'button' });
        s.potionBtn.addEventListener('pointerdown', e => {
          e.preventDefault();
          if (done || !startedAt || pausedAt || !st.p[s.id].potions) return;
          s.armed = !s.armed;
          sfx.coin();
          showHead(s);
        });
      }
      const pad = h('div', { class: 'pad duel-pad' },
        keypadKeys(p.keypad).map(k => h('button', { class: `key key-${k}`, type: 'button', 'data-k': k, 'aria-label': k === 'del' ? 'Delete' : k === 'ok' ? 'Enter' : k },
          k === 'del' ? '⌫' : k === 'ok' ? '✓' : k)));
      pad.addEventListener('pointerdown', e => {
        const b = e.target.closest('button');
        if (!b) return;
        e.preventDefault();
        b.classList.add('down');
        setTimeout(() => b.classList.remove('down'), 110);
        key(s, b.dataset.k);
      });
      s.card = h('div', { class: 'duel-card' }, s.qEl, h('div', { class: 'duel-ans-row' }, '= ', s.ansEl), s.msg, h('div', { class: 'duel-timer' }, s.timer));
      s.el = h('section', { class: `duel-half side-${i}` },
        h('header', { class: 'duel-head' },
          h('span', { class: 'duel-av' }, p.avatar), h('b', { class: 'duel-name' }, p.name),
          h('span', { class: 'duel-bar' }, s.fill), s.score, s.potionBtn || ''),
        s.card, pad);
      return s;
    }

    function showHead(s) {
      const lane = laneInfo(mode, st, people, s.id).find(l => l.me);
      s.fill.style.width = `${Math.max(0, Math.min(1, lane.frac)) * 100}%`;
      s.score.textContent = lane.text;
      s.el.className = `duel-half side-${s.i} ${lane.cls}`;
      if (s.potionBtn) {
        const n = st.p[s.id].potions;
        if (!n) s.armed = false;
        s.potionBtn.textContent = s.armed ? '🧪 Heal ready!' : `🧪 Heal ×${n}`;
        s.potionBtn.classList.toggle('armed', s.armed);
        s.potionBtn.disabled = !n;
      }
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
      s.limit = mode.limit(st, at());
      s.timer.style.transform = 'scaleX(1)';
      s.t0 = performance.now();
      s.asking = true;
    }

    function key(s, k) {
      if (done || !startedAt || pausedAt || !s.asking || performance.now() < s.lockUntil) return;
      if (k === 'del') s.input = s.input.slice(0, -1);
      else if (k === 'ok') { if (s.input) return submit(s); }
      else if (s.input.length < 3) s.input += k;
      s.ansEl.textContent = s.input || '?';
      s.ansEl.classList.toggle('empty', !s.input);
      if (k !== 'del' && k !== 'ok' && s.input.length >= String(s.q.answer).length) submit(s);
    }

    function submit(s, timeout = false) {
      const ms = performance.now() - s.t0;
      const given = timeout ? null : Number(s.input);
      const correct = !timeout && given === s.q.answer;
      const fast = correct && ms < 3000;
      s.asking = false;
      onAnswer?.(s.i, s.q, { correct, fast, ms, given, timeout, combo: correct ? s.combo + 1 : 0 });
      const heal = !!(mode.potions && s.armed && correct);
      if (heal) s.armed = false;
      const fx = act(mode, st, s.id, { correct, fast, timeout, heal }, at()) || {};
      sides.forEach(showHead);
      s.msg.textContent = fx.text || '';
      for (const id of fx.hit || []) if (id !== s.id) shake(sides[Number(id)].card);
      if (correct) {
        s.correct++;
        s.combo++;
        s.card.classList.add('good');
        if (heal) sfx.coin();
        else if (fx.hit?.length) sfx.hit();
        else sfx.correct(s.combo);
      } else {
        s.wrong++;
        s.combo = 0;
        sfx.wrong();
        shake(s.card);
        s.card.classList.add('bad');
        s.ansEl.textContent = String(s.q.answer);
      }
      if (mode.over(st, at())) return end();
      const wait = correct ? 220 : PENALTY_MS;
      s.lockUntil = performance.now() + wait;
      setTimeout(() => !done && ask(s), wait);
    }

    function tick() {
      if (done) return;
      if (startedAt && !pausedAt) {
        clock.textContent = mode.clock ? mode.clock(at()) : fmtRace(at());
        if (mode.over(st, at())) return end();
        for (const s of sides) {
          if (!s.asking) continue;
          const el = performance.now() - s.t0;
          s.timer.style.transform = `scaleX(${Math.max(0, 1 - el / s.limit)})`;
          if (el >= s.limit) submit(s, true);
        }
      }
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

    function end(quit = false) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      music.stop();
      const stats = sides.map(s => ({ correct: s.correct, wrong: s.wrong }));
      const finish = extra => {
        document.documentElement.classList.remove('in-game');
        resolve({ ...result, ...extra });
      };
      const winners = mode.verdict(st).winners.map(Number);
      const result = { winners, title: verdictTitle(mode, st, Object.fromEntries(players.map((p, i) => [String(i), p.name])), null), st, stats, quit };
      if (quit) return finish();
      if (winners.length) { sfx.win(); confetti(140); } else sfx.slow();
      const banner = s => {
        const won = winners.includes(s.i);
        return h('div', { class: `duel-result ${won ? 'won' : 'lost'} side-${s.i}` },
          h('div', { class: 'duel-result-emoji' }, won ? '🏆' : winners.length ? '😅' : '🤝'),
          h('b', null, won ? `${s.p.name} wins!` : winners.length ? 'So close!' : 'It\'s a draw!'),
          h('small', null, mode.score(st, s.id)));
      };
      overlay.hidden = false;
      overlay.classList.add('final');
      overlay.replaceChildren(
        banner(sides[1]),
        h('div', { class: 'duel-result-buttons' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => finish({ rematch: true }) }, '🔁 Rematch'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => finish() }, 'Done')),
        banner(sides[0]));
    }

    document.getElementById('app').replaceChildren(el);
    document.documentElement.classList.add('in-game');
    sides.forEach(showHead);
    tick();
    countdown(() => {
      startedAt = Date.now();
      music.play(mode.music);
      sides.forEach(ask);
    });
  });
}
