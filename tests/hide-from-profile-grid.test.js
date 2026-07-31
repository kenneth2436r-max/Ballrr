'use strict';
// Tests for toggleHideFromProfileGrid()/renderProfileGrid() -- a purely LOCAL, cosmetic flag for
// hiding one saved tournament from THIS device's own Profile tab grid. This is deliberately a
// SEPARATE concern from setArchivedTournamentVisibility() (the followers-facing public/private
// toggle, see host-follow-archive.test.js): "I don't want it on my profile" turned out to mean
// two different things depending on which view someone means -- what OTHER people following you
// can see (already covered), vs what YOU see of your own saved data on your own device (this).
// Hiding an entry here must never affect the Archive tab's own list, or Career stats/ratings --
// it only ever changes what renderProfileGrid() renders.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function historyEntry(overrides){
  return Object.assign({
    id: 't1', label: 'Summer Cup', date: '2026-07-01',
    playerStats: [{ name:'Densil', team:'Red FC', position:'MID', avg:7, count:3, goals:2, assists:1, cleanSheets:0 }],
  }, overrides || {});
}

test('renderProfileGrid hides an entry once toggleHideFromProfileGrid marks it, but leaves it fully in tournamentHistory', () => {
  const { window } = freshWindow({ extraHtml: '<div id="profile-grid-container"></div><div id="profile-highlights-strip"></div>' });
  const r = runInOneEval(window, `
    saveState=function(){}; renderArchive=function(){};
    state = { tournamentHistory: [ ${JSON.stringify(historyEntry())} ] };
    renderProfileGrid();
    window.__results.beforeHtml = document.getElementById('profile-grid-container').innerHTML;
    toggleHideFromProfileGrid('t1');
    window.__results.afterHtml = document.getElementById('profile-grid-container').innerHTML;
    window.__results.historyStillThere = state.tournamentHistory.length;
    window.__results.flagSet = state.tournamentHistory[0].hiddenFromProfileGrid;
  `);
  assert.ok(r.beforeHtml.includes('Summer Cup'), 'should show up before hiding');
  assert.ok(!r.afterHtml.includes('Summer Cup'), 'must be gone from the Profile grid once hidden');
  assert.strictEqual(r.historyStillThere, 1, 'the entry itself must NOT be removed from tournamentHistory');
  assert.strictEqual(r.flagSet, true);
});

test('toggleHideFromProfileGrid is a toggle -- calling it twice un-hides the entry again', () => {
  const { window } = freshWindow({ extraHtml: '<div id="profile-grid-container"></div><div id="profile-highlights-strip"></div>' });
  const r = runInOneEval(window, `
    saveState=function(){}; renderArchive=function(){};
    state = { tournamentHistory: [ ${JSON.stringify(historyEntry())} ] };
    toggleHideFromProfileGrid('t1');
    toggleHideFromProfileGrid('t1');
    renderProfileGrid();
    window.__results.html = document.getElementById('profile-grid-container').innerHTML;
  `);
  assert.ok(r.html.includes('Summer Cup'), 'toggling twice should show it again');
});

test('hiding a tournament from the Profile grid does not change its contribution to Career stats', () => {
  const { window } = freshWindow({ extraHtml: '<div id="profile-grid-container"></div><div id="profile-highlights-strip"></div>' });
  const r = runInOneEval(window, `
    saveState=function(){}; renderArchive=function(){};
    state = { tournamentHistory: [ ${JSON.stringify(historyEntry())} ], careerSnapshotSaved: true };
    window.__results.before = computeCareerLeaderboard().find(p => p.name === 'Densil');
    toggleHideFromProfileGrid('t1');
    window.__results.after = computeCareerLeaderboard().find(p => p.name === 'Densil');
  `);
  assert.ok(r.before, 'Densil should be in the Career leaderboard before hiding');
  assert.ok(r.after, 'Densil should STILL be in the Career leaderboard after hiding from the Profile grid');
  assert.strictEqual(r.after.goals, r.before.goals);
  assert.strictEqual(r.after.tournaments, r.before.tournaments);
});
