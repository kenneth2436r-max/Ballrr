'use strict';
// Tests for the archive-fork fix: saveState()'s private (non-shared) cloud write used to
// blindly overwrite the whole tournaments/{uid} doc with whatever this device's local `state`
// currently held. Used on two devices without a full reload in between, that let whichever
// device saved last silently wipe out any tournamentHistory entries the OTHER device had added
// since they last synced -- discovered when a real user's app had 6 saved tournaments and their
// website session only showed 3, each missing entries the other had. savePrivateStateToCloudMerged()
// (now called from saveState()) fixes this by reading the cloud copy's tournamentHistory first
// and merging it (union by id) into what's about to be saved, adopting the merged list back into
// local `state` too. syncNowFromCloud() is the manual "Sync Archive now" Settings button that
// wraps the same merge for one-time recovery of an archive that already forked before this fix
// existed.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('savePrivateStateToCloudMerged pulls in cloud-only tournamentHistory entries the local device is missing, and pushes the merged union back', async () => {
  const dbStore = {};
  dbStore['tournaments/hostUid'] = {
    data: JSON.stringify({ tournamentHistory: [
      { id: 'cloud-only', label: 'Website Cup', savedAt: 3 },
      { id: 'shared-one', label: 'Shared Cup', savedAt: 1 },
    ] }),
    updatedAt: 1,
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [
      { id:'local-only-a', label:'App Cup A', savedAt:4 },
      { id:'local-only-b', label:'App Cup B', savedAt:2 },
      { id:'shared-one', label:'Shared Cup', savedAt:1 },
    ] };
    window.__testDone = savePrivateStateToCloudMerged();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const saved = JSON.parse(dbStore['tournaments/hostUid'].data);
  const ids = saved.tournamentHistory.map(t => t.id).sort();
  assert.deepStrictEqual(ids, ['cloud-only', 'local-only-a', 'local-only-b', 'shared-one'],
    'the saved cloud copy should be the union of both devices\' histories, deduped by id, nothing dropped');
});

test('savePrivateStateToCloudMerged is a safe no-op merge-wise when the cloud has nothing this device is missing', async () => {
  const dbStore = {};
  dbStore['tournaments/hostUid'] = { data: JSON.stringify({ tournamentHistory: [ { id:'a', savedAt:1 } ] }), updatedAt: 1 };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [ { id:'a', savedAt:1 }, { id:'b', savedAt:2 } ] };
    window.__testDone = savePrivateStateToCloudMerged();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const saved = JSON.parse(dbStore['tournaments/hostUid'].data);
  assert.strictEqual(saved.tournamentHistory.length, 2, 'nothing new from the cloud, local history should pass through unchanged');
});

test('savePrivateStateToCloudMerged handles no prior cloud doc at all (first-ever save) without erroring', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [ { id:'a', savedAt:1 } ] };
    window.__testDone = savePrivateStateToCloudMerged();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok(dbStore['tournaments/hostUid'], 'should create the doc on first save');
  const saved = JSON.parse(dbStore['tournaments/hostUid'].data);
  assert.strictEqual(saved.tournamentHistory.length, 1);
});

test('syncNowFromCloud refuses when signed out, and refuses while inside a shared tournament', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  window.__alertsSeen = [];
  runInOneEval(window, `
    window.alert = (m) => { window.__alertsSeen.push(m); };
    currentUser = null;
    window.__testDone = syncNowFromCloud();
  `);
  await window.__testDone;
  assert.ok(window.__alertsSeen.some(m => m.includes('Sign in')), 'should refuse and explain when signed out');

  const r2 = runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    window.localStorage.setItem('ballrr_shared_code_v1','ABCD');
    window.alert = (m) => { window.__results.lastAlert = m; };
    window.__testDone = syncNowFromCloud();
  `);
  await window.__testDone;
  assert.ok(r2.lastAlert.includes('shared tournament'), `expected a refusal mentioning the shared tournament, got: ${r2.lastAlert}`);
  assert.ok(!dbStore['tournaments/hostUid'], 'must not touch the private archive doc while still inside a shared session');
});

test('syncNowFromCloud reports how many new tournaments were pulled in from the cloud', async () => {
  const dbStore = {};
  dbStore['tournaments/hostUid'] = { data: JSON.stringify({ tournamentHistory: [
    { id:'cloud-only-1', savedAt:1 }, { id:'cloud-only-2', savedAt:2 },
  ] }), updatedAt: 1 };
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [ { id:'local-only', savedAt:3 } ] };
    window.alert = (m) => { window.__results.lastAlert = m; };
    window.__testDone = syncNowFromCloud();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok(r.lastAlert.includes('2 tournaments'), `expected alert to mention pulling in 2 tournaments, got: ${r.lastAlert}`);
});

test('syncNowFromCloud also retroactively re-checks every saved tournament against the universal player search', async () => {
  // Covers the "existing player signs up later" case: syncVerifiedContributionsForHistory()
  // only runs automatically when a NEW tournament is first saved, so an already-tracked player
  // who verifies their name afterward needs this button to catch up on OLDER tournaments too.
  const dbStore = {};
  dbStore['tournaments/hostUid'] = { data: JSON.stringify({ tournamentHistory: [] }), updatedAt: 1 };
  dbStore['verifiedPlayers/samUid'] = { uid:'samUid', name:'Samuel', nameLower:'samuel' };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [
      { id:'old-tournament', playerStats:[ { name:'Samuel', avg:7, count:2, goals:1, assists:0, cleanSheets:0 } ] }
    ] };
    window.__testDone = (async () => {
      await syncNowFromCloud();
      for(let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
    })();
  `);
  await window.__testDone;

  const contrib = dbStore['verifiedPlayers/samUid/contributions/hostUid_old-tournament'];
  assert.ok(contrib, 'an already-saved tournament should retroactively contribute once the player is verified');
  assert.strictEqual(contrib.playerStats.goals, 1);
});
