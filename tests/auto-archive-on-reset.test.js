'use strict';
// Tests for autoArchiveUnsavedProgress() -- resetAll() (Reset Tournament / Reset Match, shared
// by both appModes) used to permanently wipe out any ratings/stats that hadn't been explicitly
// saved via "Save Tournament" first, with only a warning in the confirm dialog telling the
// person to remember to save first. Now resetAll() calls this automatically right before
// wiping state, so unsaved progress is rescued into the Archive (and therefore into Career
// stats/the global verified card, via the exact same archiveTournamentSnapshot() path
// saveTournamentToHistory() uses) instead of silently disappearing if someone forgets.
//
// snapshotCurrentTournament() itself is exercised elsewhere (career-stats.test.js and others via
// the tournament/verified-player tests) -- these tests stub it out and focus purely on
// autoArchiveUnsavedProgress()'s own decision logic: when it should and shouldn't create an
// Archive entry, and that it never double-saves.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function stubHeavyDeps(){
  return `
    renderArchive=function(){};
    publishArchivedTournamentToFollowers=function(){};
    syncRatingPoolWithLocalHistory=function(){return Promise.resolve();};
    syncVerifiedContributionsForHistory=function(){return Promise.resolve();};
    saveState=function(){};
  `;
}

test('autoArchiveUnsavedProgress does nothing when nothing has been played yet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${stubHeavyDeps()}
    snapshotCurrentTournament=function(){return{teamNames:['Red FC','Blue FC'],table:[{p:0},{p:0}],playerStats:[]};};
    state = { careerSnapshotSaved:false, tournamentHistory:[] };
    window.__results.rescued = autoArchiveUnsavedProgress();
    window.__results.historyLength = state.tournamentHistory.length;
  `);
  assert.strictEqual(r.rescued, false);
  assert.strictEqual(r.historyLength, 0, 'nothing played -- no Archive entry should be created');
});

test('autoArchiveUnsavedProgress rescues unsaved played-match stats into the Archive with an auto-generated label/date', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${stubHeavyDeps()}
    snapshotCurrentTournament=function(){return{
      teamNames:['Red FC','Blue FC'],
      table:[{name:'Red FC',p:1},{name:'Blue FC',p:1}],
      playerStats:[{name:'Alex',team:'Red FC',position:'FWD',avg:8,count:1,goals:2,assists:0,cleanSheets:0}]
    };};
    state = { careerSnapshotSaved:false, tournamentHistory:[] };
    window.__results.rescued = autoArchiveUnsavedProgress();
    window.__results.entry = state.tournamentHistory[0];
    window.__results.flagAfter = state.careerSnapshotSaved;
  `);
  assert.strictEqual(r.rescued, true);
  assert.ok(r.entry, 'an Archive entry should have been created');
  assert.strictEqual(r.entry.label, 'Red FC vs Blue FC', 'label auto-generated from team names when nobody typed one');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.entry.date), 'date auto-generated as today in YYYY-MM-DD form');
  assert.strictEqual(r.entry.playerStats[0].goals, 2, 'the actual player stats must be preserved, not just a placeholder');
  assert.strictEqual(r.flagAfter, true, 'careerSnapshotSaved must flip so Career stats stop double-counting the now-archived live data');
});

test('autoArchiveUnsavedProgress never double-saves a match that was already archived (manually or automatically)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${stubHeavyDeps()}
    snapshotCurrentTournament=function(){return{
      teamNames:['Red FC','Blue FC'],
      table:[{name:'Red FC',p:1},{name:'Blue FC',p:1}],
      playerStats:[{name:'Alex',team:'Red FC',position:'FWD',avg:8,count:1,goals:2,assists:0,cleanSheets:0}]
    };};
    state = { careerSnapshotSaved:true, tournamentHistory:[{id:'already-saved'}] };
    window.__results.rescued = autoArchiveUnsavedProgress();
    window.__results.historyLength = state.tournamentHistory.length;
  `);
  assert.strictEqual(r.rescued, false, 'already saved -- must not create a second entry');
  assert.strictEqual(r.historyLength, 1, 'the pre-existing archive entry should be untouched, no duplicate added');
});
