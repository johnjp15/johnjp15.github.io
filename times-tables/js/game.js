// The question loop shared by every mode: shows a fact, reads the on-screen
// keypad, times the answer, and watches for the player leaving the app.
//
// Anti-cheat: the moment the page loses focus or is hidden (app switcher,
// Calculator, Control Center, Siri…) the question is hidden. When the player
// comes back, that question is gone — practice modes skip it, a test counts it
// as missed and logs the leave. A calculator can't help with a question you
// can no longer see.

import { h, keypadKeys } from './util.js';
import { FAST_MS } from './facts.js';
import { sfx, haptic, music, toggleMusic, musicOn } from './sfx.js';
import { floatText, shake, dialog } from './fx.js';

/** Run one round. mode: see modes.js. Resolves with mode.finish()'s result. */
export function play(mode) {
  return new Promise(resolve => new Round(mode, resolve));
}

const BLIP_MS = 400; // focus losses shorter than this (and not hidden) aren't leaving

let keypad = 'calc';
/** 'calc' (7 8 9 on top) or 'phone' (1 2 3 on top), from the player's settings. */
export const setKeypad = layout => { keypad = layout === 'phone' ? 'phone' : 'calc'; };

class Round {
  constructor(mode, resolve) {
    this.m = mode;
    this.resolve = resolve;
    this.limit = mode.limit || null;
    this.phase = 'intro';
    this.input = '';
    this.q = null;
    this.combo = 0;
    this.done = false;
    this.started = false;
    this.away = null;
    this.pauseId = 0;
    this.pendingQ = null;
    this.timers = new Set();
    this.build();
    this.watch();
    mode.init?.(this);
    this.loop();
    this.countdown();
  }

  // ---------- layout ----------

  build() {
    const pad = h('div', { class: 'pad', role: 'group', 'aria-label': 'Number pad' },
      keypadKeys(keypad).map(k =>
        h('button', {
          class: `key key-${k}`, 'data-k': k, type: 'button',
          'aria-label': k === 'del' ? 'Delete' : k === 'ok' ? 'Enter' : k,
        }, k === 'del' ? '⌫' : k === 'ok' ? '✓' : k)));
    pad.addEventListener('pointerdown', e => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      if (this.away) return this.cameBack(); // a tap means they're back (in case no focus event fired)
      b.classList.add('down');
      setTimeout(() => b.classList.remove('down'), 110);
      sfx.key();
      this.key(b.dataset.k);
    });

    this.el = h('div', { class: `screen game mode-${this.m.id}` },
      h('header', { class: 'g-top' },
        h('button', { class: 'g-quit', type: 'button', 'aria-label': 'Quit', onclick: () => this.askQuit() }, '✕'),
        (this.hud = h('div', { class: 'g-hud' })),
        this.m.music && h('button', {
          class: 'g-mute', type: 'button', 'aria-label': 'Music on or off',
          onclick: e => { e.currentTarget.textContent = toggleMusic() ? '🎵' : '🔇'; },
        }, musicOn() ? '🎵' : '🔇')),
      (this.stage = h('div', { class: 'g-stage' })),
      (this.card = h('div', { class: 'g-card' },
        (this.qEl = h('div', { class: 'g-q', 'aria-live': 'polite' })),
        (this.fixEl = h('div', { class: 'g-fix' })),
        (this.ansWrap = h('div', { class: 'g-ans-row' },
          h('span', { class: 'g-eq' }, '='),
          (this.ansEl = h('span', { class: 'g-ans empty' }, '?')))),
        (this.bar = h('div', { class: 'g-bar', hidden: !this.limit },
          (this.fill = h('i')),
          h('b', { style: { left: `${(1 - FAST_MS / (this.limit || FAST_MS)) * 100}%` } }))),
        (this.msg = h('div', { class: 'g-msg', 'aria-live': 'polite' })))),
      pad,
      (this.overlay = h('div', { class: 'g-overlay', hidden: true })));
    document.getElementById('app').replaceChildren(this.el);
    document.documentElement.classList.add('in-game');
  }

  showOverlay({ icon, title, text, button, onclick, big }) {
    this.overlay.replaceChildren(
      h('div', { class: `g-pop ${big ? 'big' : ''}` },
        icon && h('div', { class: 'g-pop-icon' }, icon),
        title && h('h2', null, title),
        text && h('p', null, text),
        button && h('button', { class: 'btn btn-primary', type: 'button', onclick }, button)));
    this.overlay.hidden = false;
  }

  hideOverlay() { this.overlay.hidden = true; }

  // ---------- timing ----------

  later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }

  clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  loop() {
    const tick = () => {
      if (this.done) return;
      this.m.tick?.(this);
      if (this.done) return;
      if (this.phase === 'ask' && this.limit && !this.away) {
        const el = performance.now() - this.t0;
        this.fill.style.transform = `scaleX(${Math.max(0, 1 - el / this.limit)})`;
        if (el >= FAST_MS) this.bar.classList.add('late');
        if (el >= this.limit) this.submit(true);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  countdown() {
    if (!this.m.countdown) return this.begin();
    if (this.m.startAt) return this.countdownTo(this.m.startAt);
    const steps = ['3', '2', '1', 'Go!'];
    let i = 0;
    const step = () => {
      if (i === steps.length) {
        this.hideOverlay();
        return this.begin();
      }
      this.showOverlay({ title: steps[i], big: true });
      i < 3 ? sfx.tick() : sfx.go();
      i++;
      this.later(step, i === steps.length ? 400 : 650);
    };
    this.showOverlay({ icon: this.m.introIcon, title: this.m.introTitle || 'Get ready…', text: this.m.introText, big: false });
    this.later(step, this.m.introText ? 1600 : 500);
  }

  /** Live races: everyone starts at the same moment. */
  countdownTo(at) {
    let shown = null;
    const step = () => {
      const left = at - Date.now();
      if (left <= 0) {
        sfx.go();
        return this.begin();
      }
      const sec = Math.ceil(left / 1000);
      if (sec !== shown) {
        shown = sec;
        if (sec <= 3) {
          this.showOverlay({ title: String(sec), big: true });
          sfx.tick();
        } else {
          this.showOverlay({ icon: this.m.introIcon, title: this.m.introTitle || 'Get ready…', text: this.m.introText });
        }
      }
      this.later(step, Math.min(100, left));
    };
    step();
  }

  begin() {
    if (this.started || this.done) return;
    this.started = true;
    this.hideOverlay();
    if (this.m.music) music.play(this.m.music);
    this.m.start?.(this);
    this.next();
  }

  // ---------- questions ----------

  next() {
    if (this.done) return;
    this.clearTimers();
    this.cont = null;
    const q = this.m.next(this);
    if (!q) return this.finish();
    if (this.m.limitNow) {
      // Modes whose time per question changes as the game goes on.
      this.limit = this.m.limitNow();
      this.bar.querySelector('b').style.left = `${Math.max(0, 1 - FAST_MS / this.limit) * 100}%`;
    }
    this.q = { ...q, answer: q.a * q.b };
    this.input = '';
    this.phase = 'ask';
    this.card.classList.remove('good', 'slow', 'bad', 'fixing');
    this.bar.classList.remove('late');
    this.fill.style.transform = 'scaleX(1)';
    this.msg.textContent = '';
    this.fixEl.replaceChildren();
    this.qEl.replaceChildren(
      h('span', null, String(q.a)), h('span', { class: 'x' }, '×'), h('span', null, String(q.b)));
    this.card.classList.remove('pop');
    void this.card.offsetWidth;
    this.card.classList.add('pop');
    this.renderAns();
    this.m.shown?.(this, this.q);
    this.t0 = performance.now();
  }

  renderAns(text) {
    const v = text ?? this.input;
    this.ansEl.replaceChildren(v || '?');
    this.ansEl.classList.toggle('empty', !v);
  }

  key(k) {
    if (this.done || this.away || (this.phase !== 'ask' && this.phase !== 'fix')) return;
    if (k === 'del') {
      this.input = this.input.slice(0, -1);
      return this.renderAns();
    }
    if (k === 'ok') {
      if (this.input) this.phase === 'ask' ? this.submit() : this.checkFix();
      return;
    }
    if (this.input.length >= 3) return;
    this.input += k;
    this.renderAns();
    if (this.input.length >= String(this.q.answer).length) this.phase === 'ask' ? this.submit() : this.checkFix();
  }

  submit(timeout = false) {
    // 10 ms steps, exactly as stored in the signed results, so "fast" means the same everywhere.
    const ms = Math.floor((performance.now() - this.t0) / 10) * 10;
    const given = timeout ? null : Number(this.input);
    const correct = !timeout && given === this.q.answer;
    const fast = correct && ms < FAST_MS;
    this.combo = correct ? this.combo + 1 : 0;
    this.phase = 'feedback';
    const res = { correct, fast, ms, given, timeout, combo: this.combo };
    let fb = {};
    try {
      fb = this.m.answer(this, this.q, res) || {};
    } catch (err) {
      console.error(err);
    }

    this.card.classList.add(fast ? 'good' : correct ? 'slow' : 'bad');
    if (fast) sfx.correct(this.combo);
    else if (correct) sfx.slow();
    else {
      sfx.wrong();
      if (!timeout) haptic();
      shake(this.card);
    }
    if (fb.text) this.msg.textContent = fb.text;
    if (fb.points) floatText(this.card, fb.points, fast ? 'gold' : '');
    if (!correct && fb.reveal) {
      this.ansEl.replaceChildren(
        given != null ? h('s', null, String(given)) : '',
        given != null ? ' ' : '',
        h('span', { class: 'right' }, String(this.q.answer)));
      this.ansEl.classList.remove('empty');
    }
    // Kept so a pause during feedback resumes to the right place (end of battle, lock-in step…).
    this.cont = fb.end ? () => this.finish() : fb.fix ? () => this.startFix(fb.trick) : () => this.next();
    this.later(this.cont, fb.delay ?? (correct ? 450 : 1200));
  }

  /** After a miss in training: show the answer and make them type it. */
  startFix(trick) {
    const q = this.q;
    this.phase = 'fix';
    this.input = '';
    this.card.classList.remove('good', 'slow', 'bad');
    this.card.classList.add('fixing');
    this.msg.textContent = '';
    this.fixEl.replaceChildren(...[
      h('div', { class: 'fix-eq' }, `${q.a} × ${q.b} = ${q.answer}`),
      trick && h('div', { class: 'fix-trick' }, `💡 ${trick}`),
      h('div', { class: 'fix-ask' }, `Type ${q.answer} to lock it in 🔒`),
    ].filter(Boolean));
    this.renderAns();
  }

  checkFix() {
    if (Number(this.input) === this.q.answer) {
      this.phase = 'feedback';
      sfx.correct(0);
      this.msg.textContent = '🔒 Locked in!';
      this.cont = () => this.next();
      this.later(this.cont, 550);
    } else {
      sfx.wrong();
      shake(this.ansWrap);
      this.input = '';
      this.renderAns();
    }
  }

  // ---------- leaving, pausing, quitting ----------

  watch() {
    const onVis = () => (document.visibilityState === 'hidden' ? this.goneAway(true) : this.cameBack());
    const onBlur = () => this.goneAway(false);
    const onFocus = () => this.cameBack();
    const onHide = () => this.goneAway(true);
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) this.key(e.key);
      else if (e.key === 'Backspace') this.key('del');
      else if (e.key === 'Enter') this.key('ok');
      else return;
      e.preventDefault();
    };
    const noScroll = e => e.preventDefault();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('keydown', onKey);
    this.el.addEventListener('touchmove', noScroll, { passive: false });
    this.unwatch = () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('in-game');
    };
  }

  goneAway(hidden) {
    if (this.done) return;
    if (!this.away) {
      this.away = { at: Date.now(), hidden };
      this.el.classList.add('away'); // hide the question right away
    } else if (hidden) this.away.hidden = true;
  }

  cameBack() {
    if (this.done || !this.away || document.visibilityState === 'hidden') return;
    const a = this.away;
    this.away = null;
    this.el.classList.remove('away');
    const dur = Date.now() - a.at;
    if (!a.hidden && dur < BLIP_MS) return;
    this.left(dur);
  }

  pause() {
    if (this.phase !== 'paused') {
      this.resumeTo = this.phase;
      this.pendingQ = this.phase === 'ask' ? this.q : null;
      this.phase = 'paused';
      this.el.classList.add('paused');
    }
    this.clearTimers();
    return ++this.pauseId;
  }

  resume(id) {
    if (id !== this.pauseId || this.done) return;
    this.hideOverlay();
    this.el.classList.remove('paused');
    const to = this.resumeTo;
    if (to === 'intro') return this.m.startAt && Date.now() < this.m.startAt ? this.countdownTo(this.m.startAt) : this.begin();
    if (to === 'fix') {
      this.phase = 'fix';
      this.input = '';
      return this.renderAns();
    }
    if (to === 'feedback' && this.cont) return this.cont();
    this.next();
  }

  left(ms) {
    const id = this.pause();
    const q = this.pendingQ;
    this.pendingQ = null;
    this.combo = 0;
    const info = this.m.leave?.(this, q, ms) || {};
    this.showOverlay({
      icon: info.icon || '👀',
      title: info.title || 'Welcome back!',
      text: info.text || 'That question was skipped — no peeking allowed.',
      button: info.end ? 'See results' : 'Keep going',
      onclick: () => (info.end ? this.finish() : this.resume(id)),
    });
  }

  async askQuit() {
    if (this.done) return;
    const id = this.pause();
    const info = this.m.quitInfo?.() || {};
    this.dlg = dialog({
      icon: '🚪',
      title: info.title || 'Quit this round?',
      body: info.text || 'Everything you answered so far is saved.',
      buttons: [
        { label: 'Keep playing', value: false, primary: true },
        { label: info.quitLabel || 'Quit', value: true, danger: true },
      ],
      dismissable: false,
    });
    const quit = await this.dlg;
    this.dlg = null;
    if (this.done) return;
    const q = this.pendingQ;
    if (quit) {
      this.pendingQ = null;
      return this.finish({ quit: true, q });
    }
    if (id !== this.pauseId) return; // they left the app meanwhile; that overlay takes over
    this.pendingQ = null;
    this.m.skip?.(this, q);
    this.resume(id);
  }

  finish(extra = {}) {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';
    cancelAnimationFrame(this.raf);
    this.clearTimers();
    this.unwatch();
    this.dlg?.close();
    music.stop();
    Promise.resolve(this.m.finish(this, extra)).then(this.resolve);
  }
}
