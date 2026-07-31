'use strict';
// Tests for the Inactive/Retired player flag. Marking someone inactive must NEVER touch their
// historical stats (Archive/Career/Trophy Cabinet/player card all keep reading every tournament
// they already played in) -- it only stops them being offered for NEW picks: excluded from the
// wheel's random draw and autoFillTeams()'s bulk assign, while state.playerPool itself (and its
// chip-list UI) stays untouched so they can still be managed/removed/reactivated manually.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('setPlayerInactive/isPlayerInactive round-trip, creating a playerDB entry if none exists yet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { playerDB: [] };
    window.__results.beforeAnyEntry = isPlayerInactive('Sam');
    setPlayerInactive('Sam', true);
    window.__results.afterMarking = isPlayerInactive('Sam');
    window.__results.entryCreated = state.playerDB.some(p => p.name === 'Sam');
    setPlayerInactive('Sam', false);
    window.__results.afterUnmarking = isPlayerInactive('Sam');
  `);
  assert.strictEqual(r.beforeAnyEntry, false, 'a player with no playerDB entry at all should default to active');
  assert.strictEqual(r.afterMarking, true);
  assert.ok(r.entryCreated, 'should lazily create a playerDB entry, same pattern as setPlayerPosition()');
  assert.strictEqual(r.afterUnmarking, false);
});

test('togglePlayerInactive flips the current state', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    renderDraft = function(){}; // stub, this test doesn't care about the re-render
    state = { playerDB: [ { name:'Sam', positions:['MID'] } ] };
    togglePlayerInactive('Sam');
    window.__results.first = isPlayerInactive('Sam');
    togglePlayerInactive('Sam');
    window.__results.second = isPlayerInactive('Sam');
  `);
  assert.strictEqual(r.first, true);
  assert.strictEqual(r.second, false);
});

test('activeDraftPool excludes inactive players from the pool without removing them from state.playerPool itself', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { playerPool:['Sam','Robin','Jason'], playerDB:[ { name:'Robin', positions:['MID'], inactive:true } ] };
    window.__results.active = activeDraftPool();
    window.__results.fullPoolUntouched = state.playerPool.slice();
  `);
  // Array.from(): jsdom's Array constructor differs from this test file's own realm, so
  // assert.deepStrictEqual fails on an otherwise-identical array unless normalized first (see
  // helpers/harness.js's own comment on this).
  assert.deepStrictEqual(Array.from(r.active), ['Sam', 'Jason'], 'Robin is inactive and should be excluded from the draw');
  assert.deepStrictEqual(Array.from(r.fullPoolUntouched), ['Sam', 'Robin', 'Jason'], 'the underlying pool array itself must be untouched -- chips/removal still work normally');
});

test('marking a player inactive does not affect their already-recorded career stats', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { careerSnapshotSaved:true, results:[], playerDB:[ { name:'Sam', positions:['MID'], inactive:true } ],
      tournamentHistory: [ { id:'t1', playerStats:[ { name:'Sam', avg:8, count:3, goals:2, assists:1, cleanSheets:0 } ] } ] };
    ratingPoolHistory = [];
    window.__results.avg = playerCareerAvg('Sam');
    window.__results.leaderboardRow = computeCareerLeaderboard().find(p => p.name === 'Sam');
  `);
  assert.strictEqual(r.avg, 8, 'inactive flag must not zero out or hide historical rating data');
  assert.ok(r.leaderboardRow, 'inactive player should still appear in the career leaderboard with their real stats');
  assert.strictEqual(r.leaderboardRow.goals, 2);
});
