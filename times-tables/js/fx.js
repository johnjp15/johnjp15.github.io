// Visual flourishes: confetti, floating "+10" text, toasts and modal dialogs.

import { h } from './util.js';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function confetti(amount = 120) {
  if (reduceMotion()) return;
  const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const c = canvas.getContext('2d');
  const colors = ['#ffc93c', '#ff5fa2', '#2ee6d6', '#8b6cff', '#7cf05a', '#ffffff'];
  const bits = Array.from({ length: amount }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 18 * dpr,
    vy: (-Math.random() * 16 - 6) * dpr,
    r: (Math.random() * 5 + 4) * dpr,
    spin: Math.random() * Math.PI,
    vs: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = now => {
    const t = now - start;
    c.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.55 * dpr;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.spin += b.vs;
      c.save();
      c.translate(b.x, b.y);
      c.rotate(b.spin);
      c.globalAlpha = Math.max(0, 1 - t / 2200);
      c.fillStyle = b.color;
      c.fillRect(-b.r, -b.r / 2, b.r * 2, b.r);
      c.restore();
    }
    if (t < 2200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

export function floatText(parent, text, cls = '') {
  const el = h('div', { class: `float-text ${cls}` }, text);
  parent.append(el);
  setTimeout(() => el.remove(), 900);
}

export function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
}

let toastQueue = Promise.resolve();

/** Show a message at the bottom of the screen; several in a row wait their turn. */
export function toast(text, ms = 2600) {
  toastQueue = toastQueue.then(() => new Promise(done => {
    const el = h('div', { class: 'toast', role: 'status' }, text);
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => { el.remove(); done(); }, 300);
    }, ms);
  }));
}

/**
 * In-page dialog (never window.alert/confirm: those blur the page and would
 * count as leaving a test). Resolves with the chosen button's value.
 */
export function dialog({ icon, title, body, buttons = [{ label: 'OK', value: true, primary: true }], dismissable = true }) {
  let closeWith = null;
  const done = new Promise(resolve => {
    let closed = false;
    const close = value => {
      if (closed) return;
      closed = true;
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 200);
      resolve(value);
    };
    const wrap = h('div', { class: 'modal-wrap', onclick: e => { if (dismissable && e.target === wrap) close(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        icon && h('div', { class: 'modal-icon' }, icon),
        title && h('h2', null, title),
        body && (body instanceof Node ? body : h('p', null, body)),
        h('div', { class: 'modal-buttons' },
          buttons.map(b => h('button', { class: `btn ${b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-ghost'}`, onclick: () => close(b.value) }, b.label)))));
    closeWith = close;
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
  });
  /** Close from code (resolves with null). */
  done.close = () => closeWith?.(null);
  return done;
}
