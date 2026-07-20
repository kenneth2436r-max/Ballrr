'use strict';
// Tests for cross-user reactions (toggleReaction()/loadAndRenderReaction()) -- one tiny doc per
// reaction under hostProfiles/{hostUid}/reactions, id '{historyId}_{followerUid}'. See
// firestore.rules for why this shape (not an array field) is what makes it safe: a signed-in
// user can only ever create/delete the ONE doc whose id embeds their own uid.
//
// Harness gotcha (same one documented in helpers/harness.js): every call in a chain that reads
// a shared top-level `let` like `currentUser` must run inside the SAME eval() call, so each test
// below chains its steps in one async IIFE rather than issuing separate runInOneEval() calls.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('toggleReaction creates a reaction doc with the composite id, and loadAndRenderReaction shows the reacted state + count', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="profile-entry-reaction"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    window.__testDone = toggleReaction('hostUid','hist1');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const doc = dbStore['hostProfiles/hostUid/reactions/hist1_followerUid'];
  assert.ok(doc, 'a reaction doc should exist under the composite id');
  assert.strictEqual(doc.followerUid, 'followerUid');
  assert.strictEqual(doc.historyId, 'hist1');

  const html = window.document.getElementById('profile-entry-reaction').innerHTML;
  assert.ok(html.includes('❤️'), 'reacting should flip the button to the reacted state');
  assert.ok(html.includes('1'), 'the count should show 1');
});

test('reacting again toggles it off, removing the doc', async () => {
  const dbStore = {
    'hostProfiles/hostUid/reactions/hist1_followerUid': { historyId: 'hist1', followerUid: 'followerUid', ts: 1000 },
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="profile-entry-reaction"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    window.__testDone = toggleReaction('hostUid','hist1');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok(!dbStore['hostProfiles/hostUid/reactions/hist1_followerUid'], 'the doc should be removed on the second tap');
  const html = window.document.getElementById('profile-entry-reaction').innerHTML;
  assert.ok(html.includes('🤍'), 'the button should flip back to the un-reacted state');
});

test('the reaction count reflects everyone who has reacted, and a different tournament\'s reactions do not bleed in', async () => {
  const dbStore = {
    'hostProfiles/hostUid/reactions/hist1_alice': { historyId: 'hist1', followerUid: 'alice', ts: 1000 },
    'hostProfiles/hostUid/reactions/hist1_bob': { historyId: 'hist1', followerUid: 'bob', ts: 1001 },
    'hostProfiles/hostUid/reactions/hist2_carol': { historyId: 'hist2', followerUid: 'carol', ts: 1002 },
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="recap-reaction"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'devyanee', displayName:'Devyanee' };
    window.__testDone = loadAndRenderReaction('hostUid','hist1','recap-reaction');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const html = window.document.getElementById('recap-reaction').innerHTML;
  assert.ok(html.includes('2'), 'only the 2 reactions for hist1 (alice + bob) should count, not hist2\'s');
  assert.ok(html.includes('🤍'), 'a viewer who has not reacted themselves should see the un-reacted state, even though others have reacted');
});

test('loadAndRenderReaction does nothing when signed out or the target element is missing (never throws)', async () => {
  const { window } = freshWindow({ extraHtml: '<div id="profile-entry-reaction"></div>' });
  runInOneEval(window, `
    currentUser = null;
    window.__testDone = loadAndRenderReaction('hostUid','hist1','profile-entry-reaction');
  `);
  await window.__testDone;
  const html = window.document.getElementById('profile-entry-reaction').innerHTML;
  assert.strictEqual(html, '', 'nothing should render for a signed-out viewer');
});
