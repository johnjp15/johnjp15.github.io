// The Mastery Check results page. Used in the app right after a test and by
// results.html, which renders a shared link on any device.

import { h, fmtDateTime, fmtDuration, fmtSec, fmtShortDate, fmtDate, shortId, plural } from './util.js';
import { TOTAL, MAX, keyOf } from './facts.js';
import { REASON, REASON_TEXT, DEVICES, summarize } from './codec.js';
import { AVATARS } from './store.js';
import { factGrid, stackedBars, lineChart, tipValue } from './charts.js';
import { fpText, confirmSeal } from './certs.js';

const STATUS = {
  fast: { cls: 'st-fast', icon: '⚡', name: 'Instant (under 3s)' },
  slow: { cls: 'st-slow', icon: '🐢', name: 'Slow (3–6s)' },
  miss: { cls: 'st-miss', icon: '✗', name: 'Missed' },
  none: { cls: 'st-none', icon: '·', name: 'Not asked' },
};

const statusOf = it => (!it ? 'none' : it.fast ? 'fast' : it.correct ? 'slow' : 'miss');

function itemDetail(it) {
  if (!it) return 'Not asked (test stopped early)';
  if (it.left) return 'Missed — left the app';
  if (it.timeout) return 'Missed — ran out of time';
  if (it.given == null) return 'Missed — skipped';
  if (!it.correct) return `Missed — answered ${it.given}`;
  return `${it.fast ? 'Instant' : 'Slow'} — ${fmtSec(it.ms)}`;
}

/**
 * link: { data: { test, history }, app, seal } from certs.readLink
 * opts.onSealChange: re-render after a passphrase confirms the seal
 */
export function resultsView(link, opts = {}) {
  const { test, history, meta } = link.data;
  const sum = summarize(test);
  const byKey = new Map(test.items.map(it => [keyOf(it.a, it.b), it]));
  const avgFast = (() => {
    const ok = test.items.filter(i => i.correct);
    return ok.length ? ok.reduce((a, i) => a + i.ms, 0) / ok.length : null;
  })();
  const done = test.reason === REASON.DONE;
  const prev = [...history].reverse().find(r => r.reason === REASON.DONE);

  return h('div', { class: `results ${link.app === 'ok' ? '' : 'tampered'}` },
    verifyBanner(link, test, opts),
    meta.latestSeq > test.seq && h('div', { class: 'warn-box' },
      `⚠ This is Mastery Check #${test.seq}, but ${plural(meta.latestSeq - test.seq, 'newer test')} had been taken when this link was made (latest: #${meta.latestSeq}). Ask for the newest one!`),
    h('section', { class: 'card r-player' },
      h('div', { class: 'r-avatar', 'aria-hidden': 'true' }, AVATARS[test.avatar] || '🙂'),
      h('div', null,
        h('h1', null, test.name),
        h('div', { class: 'muted' }, `Mastery Check #${test.seq} · ${fmtDateTime(test.start)}`),
        h('div', { class: 'chip' }, `Player ID ${shortId(test.pid)}`))),

    h('section', { class: 'card r-hero' },
      h('div', { class: 'hero-num' }, String(sum.instant), h('span', null, ` / ${TOTAL}`)),
      h('div', { class: 'hero-label' }, 'facts memorized'),
      h('div', { class: 'muted small' }, 'Answered correctly in under 3 seconds — fast enough that it\'s memory, not counting.'),
      !done && h('div', { class: 'warn-box' }, `⚠ ${REASON_TEXT[test.reason]} after ${sum.asked} of ${TOTAL} questions.`),
      h('div', { class: 'tiles' },
        tile('Correct', `${sum.correct}/${sum.asked}`, sum.asked ? `${Math.round((sum.correct / sum.asked) * 100)}%` : ''),
        tile('Avg answer', avgFast != null ? fmtSec(avgFast) : '—', 'correct answers'),
        tile('Test time', fmtDuration(test.dur), `${test.limit / 1000}s per question`)),
      prev && done && h('div', { class: 'delta' }, deltaText(sum.instant - prev.instant, prev.start))),

    h('section', { class: 'card' },
      h('h2', null, 'Every fact, 1 × 1 to 12 × 12'),
      legend(),
      factGrid((r, c) => {
        const it = byKey.get(keyOf(r, c));
        const st = statusOf(it);
        return {
          cls: STATUS[st].cls,
          aria: `${r} × ${c} = ${r * c}: ${itemDetail(it)}`,
          tip: () => [h('strong', null, `${r} × ${c} = ${r * c}`), h('span', null, `${STATUS[st].icon} ${itemDetail(it)}`)],
        };
      }, { label: 'Mastery Check results grid' }),
      h('p', { class: 'muted small' }, 'Tap any square for details. Each fact was asked once (3 × 7 and 7 × 3 are the same fact).')),

    h('section', { class: 'card' },
      h('h2', null, 'By times table'),
      stackedBars(tableRows(byKey), [STATUS.fast, STATUS.slow, STATUS.miss].concat(done ? [] : [STATUS.none]))),

    practiceList(test),
    progressCard(history, test, sum),
    integrityCard(test, link));
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value), sub && h('div', { class: 'tile-sub' }, sub));
}

function deltaText(d, since) {
  const when = fmtShortDate(since);
  if (d > 0) return h('span', { class: 'delta-up' }, `▲ ${d} more than the last test (${when})`);
  if (d < 0) return h('span', { class: 'delta-down' }, `▼ ${-d} fewer than the last test (${when})`);
  return h('span', null, `Same as the last test (${when})`);
}

function legend() {
  return h('div', { class: 'legend', role: 'list' },
    [STATUS.fast, STATUS.slow, STATUS.miss].map(l =>
      h('span', { class: 'legend-item', role: 'listitem' }, h('i', { class: `swatch ${l.cls}` }), `${l.icon} ${l.name}`)));
}

function tableRows(byKey) {
  const rows = [];
  for (let t = 1; t <= MAX; t++) {
    const counts = { fast: 0, slow: 0, miss: 0, none: 0 };
    for (let o = 1; o <= MAX; o++) counts[statusOf(byKey.get(keyOf(t, o)))]++;
    rows.push({
      label: `${t}s`,
      end: `${counts.fast}/12`,
      segments: ['fast', 'slow', 'miss', 'none'].map(k => ({ value: counts[k], cls: STATUS[k].cls, name: STATUS[k].name, icon: STATUS[k].icon })),
    });
  }
  return rows;
}

function practiceList(test) {
  const misses = test.items.filter(i => !i.correct);
  const slow = test.items.filter(i => i.correct && !i.fast).sort((a, b) => b.ms - a.ms);
  const list = [...misses, ...slow];
  if (!list.length) {
    return h('section', { class: 'card' }, h('h2', null, 'Facts to practice'), h('p', null, '🎉 None! Every fact was instant.'));
  }
  const shown = list.slice(0, 24);
  return h('section', { class: 'card' },
    h('h2', null, 'Facts to practice'),
    h('p', { class: 'muted small' }, `${plural(misses.length, 'missed fact')}, ${plural(slow.length, 'slow fact')}.`),
    h('ul', { class: 'practice' },
      shown.map(it => h('li', { class: it.correct ? 'p-slow' : 'p-miss' },
        h('span', { class: 'p-eq' }, `${it.a} × ${it.b} = ${it.a * it.b}`),
        h('span', { class: 'p-why' }, `${it.correct ? '🐢' : '✗'} ${itemDetail(it).replace(/^(Missed|Slow) — /, '')}`)))),
    list.length > shown.length && h('p', { class: 'muted small' }, `…and ${list.length - shown.length} more.`));
}

function progressCard(history, test, sum) {
  const rows = history.filter(r => r.reason === REASON.DONE);
  const points = rows.map(r => ({
    y: r.instant,
    xLabel: fmtShortDate(r.start),
    tip: () => [...tipValue(`${r.instant} / ${TOTAL} memorized`, `Mastery Check #${r.seq} · ${fmtDate(r.start)}`), h('span', null, `${r.correct} correct`)],
  }));
  if (test.reason === REASON.DONE) {
    points.push({
      y: sum.instant, current: true, xLabel: fmtShortDate(test.start),
      tip: () => [...tipValue(`${sum.instant} / ${TOTAL} memorized`, `Mastery Check #${test.seq} (this one) · ${fmtDate(test.start)}`), h('span', null, `${sum.correct} correct`)],
    });
  }
  const stopped = history.filter(r => r.reason !== REASON.DONE);
  return h('section', { class: 'card' },
    h('h2', null, 'Progress over time'),
    h('p', { class: 'muted small' }, `Facts memorized on each completed Mastery Check (goal: all ${TOTAL}).`),
    points.length >= 2
      ? lineChart(points, { max: TOTAL, goal: TOTAL, ticks: [0, 20, 40, 60] })
      : h('p', null, points.length ? '📈 This is the first completed Mastery Check — the progress line appears after the next one.' : 'No completed Mastery Checks yet.'),
    stopped.length > 0 && h('p', { class: 'muted small' },
      `Also ${plural(stopped.length, 'earlier test')} stopped early: ${stopped.map(r => `#${r.seq}`).join(', ')}.`));
}

function integrityCard(test, link) {
  const leaves = test.leaves;
  const rows = [
    ['Started', fmtDateTime(test.start)],
    ['Test length', fmtDuration(test.dur)],
    ['Left the app', leaves ? `⚠ ${plural(leaves, 'time')} (each counted as a miss)` : '✓ Never'],
    ['Result', REASON_TEXT[test.reason]],
    ['Tests in the 24 h before', test.before24 ? `${test.before24} (this was attempt ${test.before24 + 1})` : 'None — first attempt'],
    ['Device', `${DEVICES[test.device] || DEVICES[0]}${test.standalone ? ' · home-screen app' : ' · browser'}`],
    ['Device time zone', tzText(test.tz)],
    ['Link made', fmtDateTime(link.data.meta.sharedAt)],
    ['Restored from backup', test.restores ? `${plural(test.restores, 'time')}` : 'Never'],
    ['Player since', fmtDate(test.created)],
    ['Player ID', shortId(test.pid)],
    ['Signature', link.app === 'ok' ? '✓ Valid' : '✗ Does not match'],
    ['Parent seal', sealText(link.seal)],
  ];
  return h('section', { class: 'card' },
    h('h2', null, 'Test details'),
    h('dl', { class: 'facts-list' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('details', { class: 'how' },
      h('summary', null, 'How do we know this is real?'),
      h('p', null, 'When the test ends, the app packs every question, answer and response time into this link and signs it. Change a single number and the signature no longer matches — this page checks it every time it opens.'),
      h('p', null, 'During the test, leaving the app (to open Calculator, for example) hides the question, counts it as missed and is recorded above. Three leaves stop the test. Closing or reloading the app mid-test is recorded as an incomplete attempt, so a bad test can\'t be quietly thrown away.'),
      h('p', null, '“Memorized” means correct in under 3 seconds — too fast to work it out or look it up.'),
      h('p', null, 'For the strongest check, a grown-up can turn on a Parent seal in the app (⚙️ → Parent corner). Sealed results can only be confirmed with the grown-up\'s passphrase, which isn\'t stored in the app\'s code.')));
}

function tzText(offset) {
  const total = -offset;
  const sign = total >= 0 ? '+' : '−';
  const hh = Math.floor(Math.abs(total) / 60);
  const mm = Math.abs(total) % 60;
  return `UTC${sign}${hh}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

function sealText(seal) {
  switch (seal.state) {
    case 'ok': return `🔒 Confirmed (seal ${fpText(seal.fp)})`;
    case 'unknown': return `🔒 Sealed (${fpText(seal.fp)}) — not yet confirmed on this device`;
    case 'bad': return '✗ Seal does not match';
    default: return 'None';
  }
}

function verifyBanner(link, test, opts) {
  if (link.app !== 'ok') {
    return h('div', { class: 'banner banner-bad', role: 'alert' },
      h('div', { class: 'banner-icon' }, '⛔'),
      h('div', null, h('strong', null, 'Not verified — this link was changed'),
        h('p', null, 'The numbers in this link don\'t match the signature the app created. Don\'t trust this result; ask for a fresh link straight from the app.')));
  }
  if (link.seal.state === 'bad') {
    return h('div', { class: 'banner banner-bad', role: 'alert' },
      h('div', { class: 'banner-icon' }, '⛔'),
      h('div', null, h('strong', null, 'Parent seal doesn\'t match'),
        h('p', null, 'This result claims a parent seal, but the seal signature is wrong. Treat it as not verified.')));
  }
  const unchecked = link.seal.state === 'unknown';
  const warn = test.leaves > 0 || test.reason !== REASON.DONE || unchecked;
  const children = [
    h('div', { class: 'banner-icon' }, link.seal.state === 'ok' ? '🔒' : warn ? '⚠️' : '✅'),
    h('div', null,
      h('strong', null, link.seal.state === 'ok' ? 'Verified & parent-sealed' : unchecked ? 'Signed by the app — seal not checked yet' : 'Verified result'),
      h('p', null, unchecked
        ? 'This result says it\'s parent-sealed. Enter the passphrase below to confirm the seal is real.'
        : warn
        ? `Signed by the app and not edited — but ${[
          test.leaves ? `the app was left ${plural(test.leaves, 'time')}` : '',
          test.reason !== REASON.DONE ? 'the test was not finished' : '',
        ].filter(Boolean).join(' and ')}. See details below.`
        : 'Signed by the app when the test finished. Nothing has been changed since.')),
  ];
  const banner = h('div', { class: `banner ${warn ? 'banner-warn' : 'banner-ok'}` }, ...children);
  if (link.seal.state !== 'unknown') return banner;
  return h('div', null, banner, sealForm(link, opts));
}

function sealForm(link, opts) {
  const input = h('input', {
    type: 'password', class: 'input', placeholder: 'Parent passphrase', autocomplete: 'current-password',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Parent passphrase',
  });
  const remember = h('input', { type: 'checkbox', checked: true, id: 'remember-seal' });
  const msg = h('p', { class: 'small', 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Confirm seal');
  return h('form', {
    class: 'card seal-form',
    onsubmit: async e => {
      e.preventDefault();
      if (!input.value) return;
      btn.disabled = true;
      msg.textContent = 'Checking…';
      const r = await confirmSeal(link, input.value, remember.checked);
      btn.disabled = false;
      if (r === 'ok') {
        link.seal.state = 'ok';
        opts.onSealChange?.();
      } else {
        msg.textContent = r === 'wrong-pass' ? 'That passphrase doesn\'t match this seal.' : '⛔ The passphrase is right, but the seal doesn\'t match. This result was changed.';
        if (r === 'bad') { link.seal.state = 'bad'; opts.onSealChange?.(); }
      }
    },
  },
  h('strong', null, `🔒 Parent-sealed result (seal ${fpText(link.seal.fp)})`),
  h('p', { class: 'small muted' }, 'Grown-ups: enter the passphrase you set in the Parent corner to confirm this result came from your kid\'s device.'),
  input,
  h('label', { class: 'check small', for: 'remember-seal' }, remember, ' Remember on this device'),
  btn, msg);
}
