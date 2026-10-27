// Signing finished tests and building / checking shareable result links.
//
// Two layers:
//  1. App signature — every test is signed with a key built into the app the moment it
//     finishes. Editing any number in the link (or faking a screenshot of a link-less
//     page) fails the check. This app has no server, so a determined adult reading the
//     source could in principle forge one; a kid editing a link cannot.
//  2. Parent seal (optional) — a grown-up sets a passphrase on the kid's device. Results
//     are then also signed with a key derived from it, which is not in the app's code.
//     The derived key is kept in that device's browser storage: out of reach on an
//     iPhone/iPad (no developer tools without a Mac), but not a hardware secret.

import { b64uEncode, b64uDecode, encodeTest, decodeTest, Reader, encodeHistory, encodeShareMeta, decodePayload, summarize } from './codec.js';
import { lsGet, lsSet } from './store.js';

const enc = new TextEncoder();
const SIG_BYTES = 12;
const SEAL_FP_BYTES = 4;

// The app key is stored as two halves XORed together at runtime.
const K1 = 'e3c86ec3ab7114fcb5273e3b8a23d3425c8c6767672bdaa82ce76caf21b96363';
const K2 = '8aed013c2ff5284ae29469b8d4db08dc183ff77d69ba552dc79a5bff30b17b48';
const appRaw = Uint8Array.from({ length: 32 }, (_, i) => parseInt(K1.substr(i * 2, 2), 16) ^ parseInt(K2.substr(i * 2, 2), 16));

export const cryptoReady = () => !!globalThis.crypto?.subtle;

const keyCache = new Map();
function hmacKey(raw) {
  const id = b64uEncode(raw);
  if (!keyCache.has(id)) {
    keyCache.set(id, crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keyCache.get(id);
}

async function mac(raw, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(raw), data);
  return new Uint8Array(sig).slice(0, SIG_BYTES);
}

const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

export const appSign = data => mac(appRaw, data);

// ---------- parent seal ----------

const normalizePass = p => p.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

export async function deriveSeal(passphrase) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizePass(passphrase)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('times-table-quest/seal/v1'), iterations: 200000 },
    base, 256);
  const raw = new Uint8Array(bits);
  const fp = new Uint8Array(await crypto.subtle.digest('SHA-256', raw)).slice(0, SEAL_FP_BYTES);
  return { raw, fp };
}

export const fpText = fp => {
  const hex = Array.from(fp, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`.toUpperCase();
};

/** The seal set on this device (used to sign new tests). */
export function deviceSeal() {
  const s = lsGet('seal');
  return s ? { raw: b64uDecode(s.raw), fp: b64uDecode(s.fp) } : null;
}

export function setDeviceSeal(seal) {
  lsSet('seal', seal ? { raw: b64uEncode(seal.raw), fp: b64uEncode(seal.fp), at: Date.now() } : null);
  if (seal) rememberSeal(seal);
}

/** Whether this device has confirmed (or set) any parent seal. */
export const hasKnownSeal = () => lsGet('verifiers', []).length > 0;

/** Seals this device can confirm without asking for the passphrase. */
function knownSeals() {
  return lsGet('verifiers', []).map(s => ({ raw: b64uDecode(s.raw), fp: b64uDecode(s.fp) }));
}

export function rememberSeal(seal) {
  const list = lsGet('verifiers', []).filter(s => s.fp !== b64uEncode(seal.fp));
  list.push({ raw: b64uEncode(seal.raw), fp: b64uEncode(seal.fp) });
  lsSet('verifiers', list);
}

// ---------- tests ----------

/** Sign a finished test and turn it into a record kept on the player. */
export async function signTest(t) {
  const core = encodeTest(t);
  const rec = {
    seq: t.seq,
    start: t.start,
    cert: b64uEncode(core),
    sig: b64uEncode(await appSign(core)),
    sum: summarize(decodeTest(new Reader(core))),
  };
  const seal = deviceSeal();
  if (seal) rec.seal = b64uEncode([...seal.fp, ...(await mac(seal.raw, core))]);
  return rec;
}

/** Decode a stored record, or null if it was edited after signing. */
export async function openRecord(rec) {
  try {
    const core = b64uDecode(rec.cert);
    if (!same(await appSign(core), b64uDecode(rec.sig))) return null;
    return { core, test: decodeTest(new Reader(core)) };
  } catch {
    return null;
  }
}

/** Build the shareable link for one test, with earlier tests as its progress history. */
export async function shareLink(player, rec) {
  const opened = await openRecord(rec);
  if (!opened) throw new Error('This test record failed its signature check.');
  const earlier = [];
  for (const r of player.tests) {
    if (r.seq >= rec.seq) continue;
    const o = await openRecord(r);
    if (o && o.test.pid === opened.test.pid) earlier.push({ seq: o.test.seq, start: o.test.start, ...summarize(o.test) });
  }
  const history = encodeHistory(earlier.sort((a, b) => a.seq - b.seq).slice(-30));
  const meta = encodeShareMeta({ sharedAt: Date.now(), latestSeq: player.testSeq });
  const payload = new Uint8Array([...opened.core, ...history, ...meta]);
  const parts = [b64uEncode(payload), b64uEncode(await appSign(payload))];

  // Re-seal only with the key the test itself was sealed with (even if the passphrase changed since).
  if (rec.seal) {
    const stored = b64uDecode(rec.seal);
    const key = knownSeals().find(k => same(k.fp, stored.slice(0, SEAL_FP_BYTES)));
    if (key && same(stored.slice(SEAL_FP_BYTES), await mac(key.raw, opened.core))) {
      parts.push(b64uEncode([...key.fp, ...(await mac(key.raw, payload))]));
    }
  }
  return new URL(`results.html#${parts.join('.')}`, location.href).href;
}

/**
 * Read a results link fragment.
 * Returns { data, payload, app: 'ok'|'bad', seal: { state: 'none'|'ok'|'unknown'|'bad', fp, sig } }
 * or { error } when the link can't be read at all.
 */
export async function readLink(fragment) {
  const parts = fragment.replace(/^#/, '').split('.');
  if (parts.length < 2 || parts.length > 3) return { error: 'This link is incomplete. Ask for the link to be sent again.' };
  let payload, data;
  try {
    payload = b64uDecode(parts[0]);
    data = decodePayload(payload);
  } catch {
    return { error: 'This link is damaged or incomplete. Ask for the link to be sent again.' };
  }
  let app = 'bad';
  try {
    app = same(await appSign(payload), b64uDecode(parts[1])) ? 'ok' : 'bad';
  } catch { /* stays bad */ }

  const seal = { state: 'none' };
  if (parts[2]) {
    try {
      const raw = b64uDecode(parts[2]);
      seal.fp = raw.slice(0, SEAL_FP_BYTES);
      seal.sig = raw.slice(SEAL_FP_BYTES);
      seal.state = 'unknown';
      for (const k of knownSeals()) {
        if (same(k.fp, seal.fp)) seal.state = same(await mac(k.raw, payload), seal.sig) ? 'ok' : 'bad';
      }
    } catch {
      seal.state = 'bad';
    }
  }
  return { data, payload, app, seal };
}

/** Confirm a sealed link with a typed passphrase. Returns 'ok' | 'wrong-pass' | 'bad'. */
export async function confirmSeal(link, passphrase, remember) {
  const key = await deriveSeal(passphrase);
  if (!same(key.fp, link.seal.fp)) return 'wrong-pass';
  const ok = same(await mac(key.raw, link.payload), link.seal.sig);
  if (ok && remember) rememberSeal(key);
  return ok ? 'ok' : 'bad';
}

// ---------- backups (move a player to another device) ----------

async function deflate(bytes) {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // no CompressionStream (iOS < 16.4): store uncompressed
  }
}

async function inflate(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('This backup needs a newer browser (iOS 16.4 or later) to open.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function backupLink(player) {
  const json = enc.encode(JSON.stringify({ ...player, tests: player.tests.slice(-40) }));
  const packed = await deflate(json);
  const body = packed ? new Uint8Array([1, ...packed]) : new Uint8Array([0, ...json]);
  const sig = await appSign(body);
  return new URL(`./#restore=${b64uEncode(body)}.${b64uEncode(sig)}`, location.href).href;
}

export async function readBackup(fragment) {
  const [body64, sig64] = fragment.split('.');
  const body = b64uDecode(body64);
  if (!same(await appSign(body), b64uDecode(sig64 || ''))) throw new Error('This backup link was changed or is incomplete.');
  const json = body[0] === 1 ? await inflate(body.slice(1)) : body.slice(1);
  const player = JSON.parse(new TextDecoder().decode(json));
  if (!/^[0-9a-f]{16}$/.test(player.id)) throw new Error('This backup link is not valid.');
  return player;
}
