'use strict';
// Tests for Fan Predictions (submitFanPrediction()/loadAndRenderFanPredictions()) -- lets
// FOLLOWERS guess a league match's scoreline, which the existing member-only prediction system
// (predictionHtml()/state.predictions, untested here since it's untouched) can't do since
// followers have read-only access to the shared payload. One tiny doc per person per match
// under shared/{code}/fanPredictions, id '{mi}_{uid}' -- see firestore.rules for why that shape
// makes the security rule airtight.
//
// Harness gotcha (documented in helpers/harness.js and reactions.test.js): every call in a chain
// that reads a shared top-level `let` like `currentUser`/`sharedMeta` must run inside the SAME
// eval() call, so each async test below chains its steps in one eval() using an async IIFE.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('submitFanPrediction creates a doc under the composite id, and loadAndRenderFanPredictions shows the pre-match form pre-filled with it', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="fan-predictions-0"></div><input id="fanpred-a-0" value="2"><input id="fanpred-b-0" value="1">' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan One' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid', members:['hostUid'], followers:['followerUid'] };
    state = { results: [ { played:false, g:[0,0], scorers:[], assists:[] } ] };
    window.__testDone = (async () => {
      await submitFanPrediction(0);
    })();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const doc = dbStore['shared/ABCD/fanPredictions/0_followerUid'];
  assert.ok(doc, 'a fan prediction doc should exist under the composite id');
  assert.strictEqual(doc.uid, 'followerUid');
  assert.strictEqual(doc.mi, '0');
  assert.strictEqual(doc.scoreA, 2);
  assert.strictEqual(doc.scoreB, 1);

  const html = window.document.getElementById('fan-predictions-0').innerHTML;
  assert.ok(html.includes('value="2"') && html.includes('value="1"'), 'the form should be pre-filled with the saved prediction');
  assert.ok(html.includes('>Update<'), 'a second visit should offer to Update, not Predict again');
});

test('loadAndRenderFanPredictions reveals everyone\'s guesses with a hit marker once the match is played', async () => {
  const dbStore = {
    'shared/ABCD/fanPredictions/0_alice': { mi:'0', uid:'alice', name:'Alice', scoreA:2, scoreB:1, ts:1000 },
    'shared/ABCD/fanPredictions/0_bob': { mi:'0', uid:'bob', name:'Bob', scoreA:0, scoreB:0, ts:1001 },
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="fan-predictions-0"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'devyanee', displayName:'Devyanee' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid', members:['hostUid'], followers:['devyanee'] };
    state = { results: [ { played:true, g:[2,1], scorers:[], assists:[] } ] };
    window.__testDone = loadAndRenderFanPredictions(0, 'fan-predictions-0');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const html = window.document.getElementById('fan-predictions-0').innerHTML;
  assert.ok(html.includes('Alice') && html.includes('Bob'), 'both fan predictions should be listed');
  assert.ok(html.includes('🎯'), 'the exact-match guess (Alice, 2-1) should be flagged');
  const bobRow = html.split('Bob')[1] || '';
  assert.ok(!bobRow.slice(0, 30).includes('🎯'), "Bob's wrong guess should not be marked as a hit");
});

test('loadAndRenderFanPredictions and submitFanPrediction are safe no-ops when signed out or not a shared tournament', async () => {
  const { window } = freshWindow({ extraHtml: '<div id="fan-predictions-0"></div>' });
  runInOneEval(window, `
    currentUser = null;
    sharedMeta = null;
    state = { results: [ { played:false, g:[0,0], scorers:[], assists:[] } ] };
    window.__testDone = (async () => {
      await loadAndRenderFanPredictions(0, 'fan-predictions-0');
      await submitFanPrediction(0);
    })();
  `);
  await window.__testDone;
  const html = window.document.getElementById('fan-predictions-0').innerHTML;
  assert.strictEqual(html, '', 'nothing should render or throw without a signed-in user and a shared tournament');
});

test('renderMatches inserts a fan-predictions placeholder per league match only when the tournament is shared', () => {
  // renderMatches() also renders match timers, the live feed, squad pickers, the rivalry meter,
  // POTM voting and the knockout section -- all irrelevant to what this test checks (whether the
  // fan-predictions placeholder appears) and each needing a much fuller state than set up here
  // (see rotational-player.test.js's harness note for the same issue with this function). Stub
  // them out to empty strings, same stub-the-heavy-stuff pattern the shared harness already uses
  // for startApp/renderAll/ensureShape.
  const { window } = freshWindow({ extraHtml: '<div id="matches-container"></div>' });
  const r = runInOneEval(window, `
    matchTimerHtml=function(){return'';};
    matchFeedHtml=function(){return'';};
    squadPickerHtml=function(){return'';};
    rivalryHtml=function(){return'';};
    isFriendlyMode=function(){return false;};
    knockoutSectionHtml=function(){return'';};
    potmVoteHtml=function(){return'';};
    predictionHtml=function(){return'';};
    state = {
      formatType: 'league', numTeams: 2, teamNames: ['Red FC','Blue FC'], legs: 1,
      fixtures: [[0,1]], results: [ { played:false, g:[0,0], scorers:[], assists:[] } ],
      predictions: {}, potmVotes: {}, resultsCompact: false, appMode: 'quickmatch',
    };
    currentUser = null;
    sharedMeta = null;
    renderMatches();
    window.__results.soloHtml = document.getElementById('matches-container').innerHTML;

    sharedMeta = { code:'ABCD', ownerId:'hostUid', members:['hostUid'], followers:[] };
    renderMatches();
    window.__results.sharedHtml = document.getElementById('matches-container').innerHTML;
  `);
  assert.ok(!r.soloHtml.includes('fan-predictions-0'), 'a solo (non-shared) tournament should not show a fan predictions section');
  assert.ok(r.sharedHtml.includes('id="fan-predictions-0"'), 'a shared tournament should have a fan predictions placeholder per match');
  // Regression check: the fan-predictions wrapper must carry its own `fan-prediction-section`
  // class (in addition to the shared `prediction-section` layout class it happens to reuse from
  // the separate member-only prediction league) -- see the body.viewer-mode CSS rule in the
  // <style> block. Without this distinct class, a follower's read-only lockdown (which correctly
  // disables the member-only prediction league's inputs) would ALSO disable fan predictions,
  // even though those are specifically meant to be followers-submittable.
  assert.ok(r.sharedHtml.includes('class="prediction-section fan-prediction-section"'), 'the fan-predictions wrapper needs its own class so viewer-mode CSS can unlock it without also reopening the real edit-access prediction league to followers');
});
