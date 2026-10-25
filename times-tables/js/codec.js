// Compact binary format for Mastery Check results, so a whole test (every question,
// answer and response time) fits in a link that opens on any device.

import { hexToBytes, bytesToHex } from './util.js';
import { FAST_MS } from './facts.js';

export const FORMAT = 1;
export const REASON = { DONE: 0, QUIT: 1, LEFT: 2, CLOSED: 3 };
export const REASON_TEXT = ['Completed', 'Stopped early', 'Stopped: left the app 3 times', 'Stopped: app was closed or reloaded'];
export const DEVICES = ['Unknown device', 'iPhone', 'iPad', 'Android phone', 'Android tablet', 'Mac', 'Windows PC', 'Other device'];

export function b64uEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad base64');
  let b = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Uint8Array.from(atob(b), c => c.charCodeAt(0));
}

export class Writer {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  u32(v) { return this.u16(Math.floor(v / 65536) & 0xffff).u16(v % 65536); }
  i16(v) { return this.u16(v & 0xffff); }
  bytes(b) { for (const x of b) this.u8(x); return this; }
  str(text, maxBytes = 48) {
    const enc = new TextEncoder();
    let chars = [...text];
    let b = enc.encode(text);
    while (b.length > maxBytes) b = enc.encode((chars = chars.slice(0, -1)).join(''));
    return this.u8(b.length).bytes(b);
  }
  done() { return Uint8Array.from(this.a); }
}

export class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  need(n) { if (this.i + n > this.b.length) throw new Error('truncated'); }
  u8() { this.need(1); return this.b[this.i++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  u32() { return this.u16() * 65536 + this.u16(); }
  i16() { const v = this.u16(); return v >= 32768 ? v - 65536 : v; }
  bytes(n) { this.need(n); const r = this.b.slice(this.i, this.i + n); this.i += n; return r; }
  str() { return new TextDecoder().decode(this.bytes(this.u8())); }
  get left() { return this.b.length - this.i; }
}

/**
 * The signed core of one Mastery Check (the benchmark test).
 * t: { pid, avatar, name, created, seq, before24, restores, start, dur, leaves, device,
 *      standalone, tz, limit, reason, total, items: [{ a, b, given, ms, timeout, left }] }
 */
export function encodeTest(t) {
  const w = new Writer();
  w.u8(FORMAT);
  w.bytes(hexToBytes(t.pid));
  w.u8(t.avatar).str(t.name);
  w.u32(Math.floor(t.created / 1000));
  w.u16(t.seq).u8(Math.min(255, t.before24)).u8(Math.min(255, t.restores || 0));
  w.u32(Math.floor(t.start / 1000));
  w.u16(Math.min(65535, Math.round(t.dur / 1000)));
  w.u8(Math.min(255, t.leaves)).u8(t.device).u8(t.standalone ? 1 : 0).i16(t.tz);
  w.u8(Math.round(t.limit / 100)).u8(t.reason).u8(t.total);
  w.u8(t.items.length);
  for (const it of t.items) {
    w.u8(((it.a - 1) << 4) | (it.b - 1));
    w.u16(it.given == null ? 0xffff : Math.min(9999, it.given));
    w.u16(Math.min(8191, Math.floor(it.ms / 10)) | (it.timeout ? 1 << 13 : 0) | (it.left ? 1 << 14 : 0));
  }
  return w.done();
}

export function decodeTest(r) {
  if (r.u8() !== FORMAT) throw new Error('unknown format');
  const t = {};
  t.pid = bytesToHex(r.bytes(8));
  t.avatar = r.u8();
  t.name = r.str();
  t.created = r.u32() * 1000;
  t.seq = r.u16();
  t.before24 = r.u8();
  t.restores = r.u8();
  t.start = r.u32() * 1000;
  t.dur = r.u16() * 1000;
  t.leaves = r.u8();
  t.device = r.u8();
  t.standalone = r.u8() === 1;
  t.tz = r.i16();
  t.limit = r.u8() * 100;
  t.reason = r.u8();
  t.total = r.u8();
  const n = r.u8();
  t.items = [];
  for (let i = 0; i < n; i++) {
    const ab = r.u8();
    const given = r.u16();
    const tm = r.u16();
    const a = (ab >> 4) + 1;
    const b = (ab & 15) + 1;
    const item = {
      a, b,
      given: given === 0xffff ? null : given,
      ms: (tm & 8191) * 10,
      timeout: !!(tm & (1 << 13)),
      left: !!(tm & (1 << 14)),
    };
    item.correct = !item.timeout && !item.left && item.given === a * b;
    item.fast = item.correct && item.ms < FAST_MS;
    t.items.push(item);
  }
  return t;
}

export function summarize(t) {
  const instant = t.items.filter(i => i.fast).length;
  const correct = t.items.filter(i => i.correct).length;
  return { instant, correct, asked: t.items.length, total: t.total, reason: t.reason };
}

/** History rows: earlier tests' headline numbers, shown as the progress line. */
export function encodeHistory(rows) {
  const w = new Writer();
  w.u8(rows.length);
  for (const h of rows) {
    w.u16(h.seq).u32(Math.floor(h.start / 1000)).u8(h.instant).u8(h.correct).u8(h.asked).u8(h.reason);
  }
  return w.done();
}

function decodeHistory(r) {
  const rows = [];
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    rows.push({ seq: r.u16(), start: r.u32() * 1000, instant: r.u8(), correct: r.u8(), asked: r.u8(), reason: r.u8() });
  }
  return rows;
}

/** When the link was made, and the newest test number at that moment (so an old test shared later shows it). */
export function encodeShareMeta({ sharedAt, latestSeq }) {
  return new Writer().u32(Math.floor(sharedAt / 1000)).u16(latestSeq).done();
}

/** payload = test core + history + share meta */
export function decodePayload(bytes) {
  const r = new Reader(bytes);
  const test = decodeTest(r);
  const history = decodeHistory(r);
  const meta = { sharedAt: r.u32() * 1000, latestSeq: r.u16() };
  if (r.left) throw new Error('trailing bytes');
  return { test, history, meta };
}
