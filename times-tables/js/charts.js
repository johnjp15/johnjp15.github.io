// Charts: the 12 × 12 fact grid, per-table stacked bars and the progress line.
// Hand-built SVG/HTML, interactive by tap or hover, one shared tooltip.

import { h, s } from './util.js';
import { MAX } from './facts.js';

// ---------- tooltip ----------

let tip = null;
function ensureTip() {
  if (tip) return tip;
  tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  const hide = e => { if (!e || !e.target.closest?.('[data-tip]')) hideTip(); };
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('scroll', () => hideTip(), { passive: true });
  window.addEventListener('resize', () => hideTip());
  return tip;
}

export function showTip(x, y, ...content) {
  const t = ensureTip();
  t.replaceChildren(...content.filter(Boolean));
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  t.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

export function hideTip() { if (tip) tip.hidden = true; }

/** Wire an element so tap (mobile) or hover (desktop) shows a tooltip built by fn(). */
function tipOn(el, fn) {
  el.setAttribute('data-tip', '');
  el.tabIndex = 0;
  const show = () => {
    const r = el.getBoundingClientRect();
    showTip(r.left + r.width / 2, r.top, ...fn());
  };
  el.addEventListener('click', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(); });
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
}

export const tipValue = (value, label) => [h('strong', null, value), label && h('span', null, label)];

// ---------- 12 × 12 grid ----------

/**
 * cell(r, c) → { cls, text, tip: () => nodes }
 */
export function factGrid(cell, { label = 'Times table grid' } = {}) {
  const grid = h('div', { class: 'fgrid', role: 'grid', 'aria-label': label });
  grid.append(h('div', { class: 'fg-head fg-corner' }, '×'));
  for (let c = 1; c <= MAX; c++) grid.append(h('div', { class: 'fg-head' }, String(c)));
  for (let r = 1; r <= MAX; r++) {
    grid.append(h('div', { class: 'fg-head' }, String(r)));
    for (let c = 1; c <= MAX; c++) {
      const info = cell(r, c);
      const el = h('div', { class: `fg-cell ${info.cls || ''}`, role: 'gridcell', 'aria-label': info.aria || `${r} × ${c}` }, info.text ?? String(r * c));
      if (info.tip) tipOn(el, info.tip);
      grid.append(el);
    }
  }
  return grid;
}

// ---------- stacked bars (one row per table) ----------

/**
 * rows: [{ label, segments: [{ value, cls, name }], total, end }]
 * legend: [{ cls, name, icon }]
 */
export function stackedBars(rows, legend) {
  return h('div', { class: 'sbars' },
    h('div', { class: 'legend', role: 'list' },
      legend.map(l => h('span', { class: 'legend-item', role: 'listitem' }, h('i', { class: `swatch ${l.cls}` }), `${l.icon} ${l.name}`))),
    rows.map(row => {
      const track = h('div', { class: 'sbar-track' },
        row.segments.filter(sg => sg.value > 0).map(sg =>
          h('i', { class: `sbar-seg ${sg.cls}`, style: { flexGrow: String(sg.value) } })));
      const el = h('div', { class: 'sbar-row' },
        h('span', { class: 'sbar-label' }, row.label), track, h('span', { class: 'sbar-end' }, row.end));
      tipOn(el, () => [h('strong', null, row.label),
        ...row.segments.map(sg => h('span', null, `${sg.icon} ${sg.name}: ${sg.value}`))]);
      return el;
    }));
}

// ---------- progress line ----------

/**
 * points: [{ y, xLabel, tip: () => nodes, current }]
 * Redraws to fit its container width.
 */
export function lineChart(points, { max, goal, ticks, height = 170, unit = '' }) {
  const box = h('div', { class: 'lchart' });
  const draw = () => {
    const W = Math.max(240, box.clientWidth);
    const H = height;
    const pad = { l: 30, r: 34, t: 14, b: 26 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const x = i => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = v => pad.t + ih - (v / max) * ih;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Progress over time' });

    for (const t of ticks) {
      svg.append(s('line', { class: 'lc-grid', x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t) }));
      svg.append(s('text', { class: 'lc-tick', x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, String(t)));
    }
    if (goal != null) {
      svg.append(s('line', { class: 'lc-goal', x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal) }));
      svg.append(s('text', { class: 'lc-tick', x: W - pad.r + 4, y: y(goal) + 4 }, `${goal}${unit}`));
    }
    svg.append(s('line', { class: 'lc-axis', x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) }));

    const labelIdx = new Set([0, points.length - 1]);
    if (points.length > 4) labelIdx.add(Math.floor((points.length - 1) / 2));
    for (const i of labelIdx) {
      const anchor = points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
      svg.append(s('text', { class: 'lc-tick', x: x(i), y: H - 6, 'text-anchor': anchor }, points[i].xLabel));
    }

    if (points.length > 1) {
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
      svg.append(s('path', { class: 'lc-area', d: `${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z` }));
      svg.append(s('path', { class: 'lc-line', d }));
    }
    const cross = s('line', { class: 'lc-cross', y1: pad.t, y2: y(0), visibility: 'hidden' });
    svg.append(cross);
    points.forEach((p, i) => {
      svg.append(s('circle', { class: `lc-dot ${p.current ? 'current' : ''}`, cx: x(i), cy: y(p.y), r: p.current ? 5.5 : 4 }));
    });
    const last = points[points.length - 1];
    svg.append(s('text', { class: 'lc-end', x: x(points.length - 1) + 8, y: y(last.y) - 8, 'text-anchor': points.length === 1 ? 'start' : 'end' }, String(last.y)));

    // Crosshair: the nearest point to the pointer, anywhere over the plot.
    const hit = s('rect', { x: pad.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' });
    const at = e => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      let best = 0;
      points.forEach((p, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      cross.setAttribute('x1', x(best));
      cross.setAttribute('x2', x(best));
      cross.setAttribute('visibility', 'visible');
      showTip(r.left + x(best), r.top + y(points[best].y), ...points[best].tip());
    };
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerleave', e => {
      if (e.pointerType !== 'mouse') return;
      cross.setAttribute('visibility', 'hidden');
      hideTip();
    });
    hit.setAttribute('data-tip', '');
    svg.append(hit);
    box.replaceChildren(svg);
  };
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    if (box.clientWidth && box.clientWidth !== lastW) { lastW = box.clientWidth; draw(); }
  });
  ro.observe(box);
  return box;
}

// ---------- ring meter (home screen) ----------

export function ring(value, max, { size = 112, stroke = 12 } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = max ? Math.min(1, value / max) : 0;
  return s('svg', { class: 'ring', width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
    s('circle', { class: 'ring-track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }),
    f > 0 && s('circle', {
      class: 'ring-fill', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke,
      'stroke-dasharray': `${(c * f).toFixed(2)} ${c.toFixed(2)}`,
      transform: `rotate(-90 ${size / 2} ${size / 2})`,
    }));
}
