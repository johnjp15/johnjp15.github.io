// results.html: shows a shared Mastery Check link on any device, no player needed.

import { h } from './util.js';
import { readLink, cryptoReady } from './certs.js';
import { resultsView } from './results-view.js';

const app = document.getElementById('app');

async function render() {
  if (!cryptoReady()) {
    app.replaceChildren(message('😕', 'This page needs a secure (https) connection to check results.'));
    return;
  }
  if (!location.hash || location.hash.length < 10) {
    app.replaceChildren(message('🔗', 'No results in this link. Ask for the link to be shared again from the app.'));
    return;
  }
  const link = await readLink(location.hash);
  if (link.error) {
    app.replaceChildren(message('⛔', link.error));
    return;
  }
  const { test } = link.data;
  document.title = `${test.name} · Mastery Check #${test.seq} · Times Table Quest`;
  app.replaceChildren(h('div', { class: 'screen page' },
    h('header', { class: 'page-top' },
      h('span', { class: 'spacer' }),
      h('h1', null, '🏅 Mastery Check results'),
      h('span', { class: 'spacer' })),
    h('main', { class: 'page-body' },
      resultsView(link, { onSealChange: () => rerender(link) }),
      h('a', { class: 'btn btn-ghost wide', href: './' }, '✖️ Open Times Table Quest'))));
}

function rerender(link) {
  const main = app.querySelector('.page-body');
  main.firstChild.replaceWith(resultsView(link, { onSealChange: () => rerender(link) }));
}

function message(icon, text) {
  return h('div', { class: 'screen onboard' }, h('div', { class: 'sum-emoji' }, icon), h('p', { class: 'lead' }, text),
    h('a', { class: 'btn btn-ghost', href: './' }, 'Open Times Table Quest'));
}

window.addEventListener('hashchange', render);
render();
