'use strict';
// Tests for Quick Match now sharing the same Draft/Scorers/Lineups/Archive pipeline as
// Tournament mode (see switchAppMode()'s and snapshotMainSlots()'s comments in public/index.html)
// -- a quick 2-team match can be drafted, logged and saved to the Archive so its ratings count
// toward Career stats and the global verified card exactly like a tournament's do.
//
// The one real correctness risk this introduces: careerSnapshotSaved is a single flag that
// gates whether the CURRENT live (unsaved) match's stats also get counted on top of the Archive
// (see computeCareerLeaderboard()'s comment). Tournament and Quick Match each have their own
// separate live match sitting in the swapped "main slots" (state.results/players/etc, see
// snapshotMainSlots()/restoreMainSlots()), so this flag has to travel with each slot instead of
// staying global -- otherwise saving one mode's match would wrongly mark the OTHER mode's
// still-unsaved match as "already saved" the moment you switch back, silently dropping its stats
// out of the live Career count.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(overrides){
  return Object.assign({
    appMode: 'tournament',
    numTeams: 2, legs: 1, formatType: 'league',
    teamNames: ['Red FC','Blue FC'], teamCrests: ['',''],
    fixtures: [[0,1]], results: [{ played:false, g:[0,0], scorers:[], assists:[] }],
    page3: undefined, koRounds: null, koThird: undefined,
    captains: ['',''], goalkeepers: ['',''], playerPool: [], rotationalPool: [], players: [],
    draftTurnIndex: 0, draftBalanced: false, draftSnake: false, draftPickCount: 0,
    customKO: { enabled:false, stages:[] }, customResults: [],
    careerSnapshotSaved: false,
    quickMatchData: null, tournamentBackup: null,
    tournamentHistory: [],
  }, overrides || {});
}

test('switchAppMode gives a brand new Quick Match its own careerSnapshotSaved=false, independent of the tournament\'s own flag', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ensureShape=function(){}; saveState=function(){}; renderAll=function(){}; haptic=function(){};
    state = ${JSON.stringify(baseState({ careerSnapshotSaved: true }))};
    switchAppMode('quickmatch');
    window.__results.modeAfterSwitch = state.appMode;
    window.__results.quickCareerFlag = state.careerSnapshotSaved;
  `);
  assert.strictEqual(r.modeAfterSwitch, 'quickmatch');
  assert.strictEqual(r.quickCareerFlag, false, 'a fresh Quick Match has nothing archived yet, regardless of whether the tournament side was already saved');
});

test('saving Quick Match to the Archive does not falsely mark the tournament\'s own still-unsaved match as archived when switching back', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ensureShape=function(){}; saveState=function(){}; renderAll=function(){}; haptic=function(){};
    // Tournament in progress, deliberately NOT yet saved to the Archive.
    state = ${JSON.stringify(baseState({ careerSnapshotSaved: false }))};
    switchAppMode('quickmatch');
    // Simulate saveTournamentToHistory() having just archived the quick match.
    state.careerSnapshotSaved = true;
    switchAppMode('tournament');
    window.__results.tournamentCareerFlag = state.careerSnapshotSaved;
    switchAppMode('quickmatch');
    window.__results.quickCareerFlagAfterReturn = state.careerSnapshotSaved;
  `);
  assert.strictEqual(r.tournamentCareerFlag, false, 'the tournament\'s own unsaved match must not be marked as archived just because Quick Match was saved');
  assert.strictEqual(r.quickCareerFlagAfterReturn, true, 'Quick Match should still remember its own match was already archived');
});

test('a fresh Quick Match starts with an empty roster (draftable from scratch) and does not touch the tournament\'s own players', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ensureShape=function(){}; saveState=function(){}; renderAll=function(){}; haptic=function(){};
    state = ${JSON.stringify(baseState({ players: [{ name:'Alex', team:0 }, { name:'Sam', team:1 }] }))};
    switchAppMode('quickmatch');
    window.__results.quickPlayers = state.players;
    window.__results.quickNumTeams = state.numTeams;
    state.players = [{ name:'Quickie', team:0 }];
    switchAppMode('tournament');
    window.__results.tournamentPlayersRestored = state.players.map(p => p.name);
  `);
  assert.strictEqual(r.quickPlayers.length, 0, 'Quick Match starts with a blank roster to draft into');
  assert.strictEqual(r.quickNumTeams, 2);
  assert.deepStrictEqual(Array.from(r.tournamentPlayersRestored), ['Alex','Sam'], 'the tournament\'s own roster must be restored untouched, not overwritten by whoever was drafted into the quick match');
});
