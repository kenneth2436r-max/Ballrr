'use strict';
// Smoke test for the production minification step (see build.js's own comment for why it
// exists -- externalizing + minifying the main script/style so the browser can actually cache
// them). This runs a handful of representative tests -- mirroring real assertions from other
// test files -- against the code run through esbuild's minifier instead of the readable source,
// to catch the one real risk of adding a minification step: esbuild's identifier renaming/
// mangling silently changing behavior (e.g. a name collision, or code that relied on
// Function.prototype.toString()/a function's .name). This is intentionally NOT exhaustive --
// it's a canary, not a re-run of the whole suite -- covering a pure-logic test, a DOM-rendering
// test, and an async/Firestore-mock test so all three harness patterns used elsewhere are
// exercised at least once against actually-minified code.
process.env.BALLRR_TEST_DIST = '1';
const test = require('node:test');
const assert = require('node:assert');

test('minified build: pure logic (entryMode) matches source behavior', () => {
  const { freshWindow, runInOneEval } = require('./helpers/harness');
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.untagged = entryMode({ id: 'x' });
    window.__results.competitive = entryMode({ id: 'x', mode: 'competitive' });
  `);
  assert.strictEqual(r.untagged, 'friendly');
  assert.strictEqual(r.competitive, 'competitive');
});

test('minified build: pdfSafeText still strips emoji the same way as source', () => {
  const { freshWindow, runInOneEval } = require('./helpers/harness');
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.wordmark = pdfSafeText('⚽ BALLRR');
    window.__results.plain = pdfSafeText("Keith O'Brien");
  `);
  assert.strictEqual(r.wordmark, 'BALLRR');
  assert.strictEqual(r.plain, "Keith O'Brien");
});

test('minified build: DOM rendering (renderModeBadge) still finds elements and sets text correctly', () => {
  const { freshWindow, runInOneEval } = require('./helpers/harness');
  const { window } = freshWindow({ extraHtml: '<span id="app-mode-badge"></span>' });
  const r = runInOneEval(window, `
    state = { mode: 'competitive' };
    renderModeBadge();
    window.__results.text = document.getElementById('app-mode-badge').textContent;
  `);
  assert.ok(/competitive/i.test(r.text));
});

test('minified build: async/Firestore-mock flow (ensureVerifiedIdentity) still works end to end', async () => {
  const { freshWindow, runInOneEval } = require('./helpers/harness');
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'myUid', displayName:'Devyanee Chouhan' };
    window.__testDone = ensureVerifiedIdentity();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  const idx = dbStore['verifiedPlayers/myUid'];
  assert.ok(idx);
  assert.strictEqual(idx.name, 'Devyanee Chouhan');
});
