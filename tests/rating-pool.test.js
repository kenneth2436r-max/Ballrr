'use strict';
// Tests for the shared rating pool -- lets ratings/career stats stay consistent no matter which
// of a trusted group of people (an owner + their standingCoHosts) actually organizes a given
// tournament, instead of each person's own private tournaments/{uid} archive silently
// disagreeing (see firestore.rules' ratingPools/{uid} comment for the trust model, and
// public/index.html's own comment above ratingPoolDocRef()/effectiveTournamentHistory()).
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('currentRatingPoolOwnerUid resolves to the shared tournament organizer when inside one, or this device\'s own uid otherwise', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    window.__results.solo = currentRatingPoolOwnerUid();
    sharedMeta = { ownerId:'akhilUid', members:['akhilUid','myUid'] };
    window.__results.insideShared = currentRatingPoolOwnerUid();
  `);
  assert.strictEqual(r.solo, 'myUid');
  assert.strictEqual(r.insideShared, 'akhilUid');
});

test('mergeIntoRatingPool merges tournamentHistory-shaped entries into ratingPools/{uid}, deduped by id', async () => {
  const dbStore = {};
  dbStore['ratingPools/akhilUid'] = { tournamentHistory: [ { id:'t1', playerStats:[{name:'Sam',avg:7,count:2}] } ] };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    window.__testDone = mergeIntoRatingPool('akhilUid', [
      { id:'t1', playerStats:[{name:'Sam',avg:7,count:2}] },
      { id:'t2', playerStats:[{name:'Robin',avg:8,count:1}] },
    ]);
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const ids = dbStore['ratingPools/akhilUid'].tournamentHistory.map(t => t.id).sort();
  assert.deepStrictEqual(ids, ['t1', 't2'], 't1 should not be duplicated, t2 should be added');
});

test('effectiveTournamentHistory unions local state.tournamentHistory with the cached rating pool, deduped by id', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { tournamentHistory: [ { id:'local1' }, { id:'shared1' } ] };
    ratingPoolHistory = [ { id:'shared1' }, { id:'pool-only' } ];
    window.__results.ids = effectiveTournamentHistory().map(t => t.id).sort();
  `);
  assert.deepStrictEqual(r.ids, ['local1', 'pool-only', 'shared1']);
});

test('playerCareerAvg reads from the pool too, so a player with no local history but pool history still gets a real average', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { tournamentHistory: [] };
    ratingPoolHistory = [ { id:'p1', playerStats:[ { name:'Akhil', avg:8, count:2 } ] } ];
    window.__results.avg = playerCareerAvg('Akhil');
    window.__results.unknown = playerCareerAvg('Nobody');
  `);
  assert.strictEqual(r.avg, 8);
  assert.strictEqual(r.unknown, null);
});

test('computeCareerLeaderboard combines local and pool-only tournaments without double-counting a tournament present in both', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { careerSnapshotSaved: true, tournamentHistory: [
      { id:'both', playerStats:[ { name:'Sam', avg:7, count:2, goals:1, assists:0, cleanSheets:0 } ] },
      { id:'local-only', playerStats:[ { name:'Sam', avg:9, count:1, goals:2, assists:0, cleanSheets:0 } ] },
    ] };
    ratingPoolHistory = [
      { id:'both', playerStats:[ { name:'Sam', avg:7, count:2, goals:1, assists:0, cleanSheets:0 } ] },
      { id:'pool-only', playerStats:[ { name:'Sam', avg:5, count:1, goals:0, assists:1, cleanSheets:0 } ] },
    ];
    window.__results.sam = computeCareerLeaderboard().find(p => p.name === 'Sam');
  `);
  assert.strictEqual(r.sam.tournaments, 3, 'both + local-only + pool-only = 3 distinct tournaments, "both" counted once');
  assert.strictEqual(r.sam.matches, 4, '2 (both) + 1 (local-only) + 1 (pool-only) = 4');
  assert.strictEqual(r.sam.goals, 3, '1 (both) + 2 (local-only) + 0 (pool-only) = 3');
});

test('syncRatingPoolWithLocalHistory is a no-op when there\'s nothing local to contribute, and merges when there is', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    state = { tournamentHistory: [] };
    window.__testDone = syncRatingPoolWithLocalHistory();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(!dbStore['ratingPools/myUid'], 'nothing to sync, should not create a doc');

  const r2 = runInOneEval(window, `
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    state = { tournamentHistory: [ { id:'t1', playerStats:[] } ] };
    window.__testDone = syncRatingPoolWithLocalHistory();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(dbStore['ratingPools/myUid'], 'should create the pool doc once there is something to contribute');
  assert.strictEqual(dbStore['ratingPools/myUid'].tournamentHistory.length, 1);
});
