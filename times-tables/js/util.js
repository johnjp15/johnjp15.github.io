// Small DOM + formatting helpers shared by every screen.

export const $ = (sel, root = document) => root.querySelector(sel);

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an HTML element. Children are appended as text unless they are Nodes. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  setProps(el, props, false);
  append(el, kids);
  return el;
}

/** Create an SVG element (same API as h). */
export function s(tag, props, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props, true);
  append(el, kids);
  return el;
}

function setProps(el, props, svg) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') svg ? el.setAttribute('class', v) : (el.className = v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : String(k));
  }
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rand = n => Math.floor(Math.random() * n);
export const pick = list => list[rand(list.length)];
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Local calendar day, e.g. "2026-10-25". */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function yesterdayKey(ts = Date.now()) {
  const d = new Date(ts);
  d.setDate(d.getDate() - 1); // calendar math, so daylight-saving days still work
  return dayKey(d.getTime());
}

/** Trim to at most n characters without splitting an emoji. */
export const clip = (text, n) => [...String(text).trim()].slice(0, n).join('');

export const fmtSec = ms => `${(ms / 1000).toFixed(1)}s`;

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export const fmtDate = ts =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export const fmtShortDate = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const fmtDateTime = ts =>
  new Date(ts).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

export function fmtAgo(ts, now = Date.now()) {
  const m = Math.round((now - ts) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export const bytesToHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** Short, readable player id: "a1b2-c3d4". */
export const shortId = hex => `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;

export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
}

export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Device class code stored in test results (see DEVICES in codec.js). */
export function deviceCode() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 1;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 2;
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 3 : 4;
  if (/Macintosh/.test(ua)) return 5;
  if (/Windows/.test(ua)) return 6;
  return 7;
}
