'use strict';
// Regression test for: opening the shared #player-card-modal (player cards, archetype ranking,
// trophy cabinet, followers list, rivalries, home stories -- over a dozen call sites) right
// after viewing a long piece of content in it (e.g. a player card with a big Trophy Cabinet)
// could leave the NEXT thing shown already scrolled down, since only #player-card-content's
// innerHTML gets replaced -- neither it nor the outer overlay's own scroll position was ever
// reset. That visually "hid" the top of the new content (name/OVR/avatar) behind the old scroll
// offset. openPlayerCardModal() (the single shared open path every call site now uses) resets
// scrollTop on both elements every time it opens.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('openPlayerCardModal resets scroll position on both the overlay and the card content every time it opens', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  const r = runInOneEval(window, `
    const modal = document.getElementById('player-card-modal');
    const content = document.getElementById('player-card-content');
    modal.scrollTop = 500;
    content.scrollTop = 500;
    openPlayerCardModal();
    window.__results.modalScroll = modal.scrollTop;
    window.__results.contentScroll = content.scrollTop;
    window.__results.display = modal.style.display;
  `);
  assert.strictEqual(r.modalScroll, 0, 'the outer overlay must scroll back to the top on every open, not just the first');
  assert.strictEqual(r.contentScroll, 0);
  assert.strictEqual(r.display, 'flex');
});

test('showPlayerCard resets a stale scroll position left over from a previous, longer card', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    haptic = function(){};
    document.getElementById('player-card-modal').scrollTop = 500;
    document.getElementById('player-card-content').scrollTop = 500;
    state = { results: [], fixtures: [], numTeams: 2, teamNames: ['Red FC','Blue FC'],
      captains: ['',''], players: [], playerDB: [],
      careerSnapshotSaved: true, tournamentHistory: [] };
    showPlayerCard('Nobody');
  `);
  const modal = window.document.getElementById('player-card-modal');
  const content = window.document.getElementById('player-card-content');
  assert.strictEqual(modal.scrollTop, 0);
  assert.strictEqual(content.scrollTop, 0);
});
