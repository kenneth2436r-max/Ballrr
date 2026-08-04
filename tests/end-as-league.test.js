'use strict';
// Tests for the "End as League" option (state.leagueOnly / toggleLeagueOnly()) -- lets the
// organizer explicitly stop a league-format tournament at the group stage instead of it
// automatically expecting a knockout playoff once every match is played. Once set,
// computeTournamentChampion() crowns the table leader directly, and renderTable() stops
// auto-generating/showing the knockout bracket -- both previously assumed a knockout stage was
// always coming next for anything but pure knockout format.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function twoTeamLeagueState(overrides){
  return Object.assign({
    formatType: 'league', leagueOnly: false,
    numTeams: 2, legs: 1,
    teamNames: ['Team A', 'Team B'], teamCrests: ['', ''],
    fixtures: [[0, 1]],
    results: [{ played: true, g: [2, 1], scorers: [], assists: [] }],
    customKO: { enabled: false, stages: [] },
    page3: undefined, koRounds: null, koThird: undefined,
  }, overrides || {});
}

test('computeTournamentChampion falls back to the league table leader once leagueOnly is set, without needing a knockout bracket', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(twoTeamLeagueState({ leagueOnly: true }))};
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, 'Team A', 'Team A won 2-1, so should be crowned champion straight off the table');
});

test('computeTournamentChampion still waits on the knockout bracket when leagueOnly is NOT set', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(twoTeamLeagueState({
      leagueOnly: false,
      // A generated-but-not-yet-played bracket (as if the Table tab had already been viewed
      // once the group stage completed, lazily creating it via ensureKORounds()) -- this is the
      // state computeTournamentChampion() must NOT bypass unless leagueOnly is set.
      koRounds: [[{ played: false, g: [null, null], scorers: [], assists: [] }]],
    }))};
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, null, 'should not crown a champion off the table alone while an undecided knockout stage is still attached');
});

test('toggleLeagueOnly() flips the flag and is fully reversible', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(twoTeamLeagueState())};
    saveState = function(){};
    renderTable = function(){};
    toggleLeagueOnly();
    window.__results.afterFirstToggle = state.leagueOnly;
    toggleLeagueOnly();
    window.__results.afterSecondToggle = state.leagueOnly;
  `);
  assert.strictEqual(r.afterFirstToggle, true);
  assert.strictEqual(r.afterSecondToggle, false, 'toggling twice should return to the normal knockout-expected behaviour');
});

test('endAsLeagueHtml offers to end as a league once the group stage is complete, and shows the ended state once leagueOnly is set', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(twoTeamLeagueState())};
    window.__results.beforeComplete = endAsLeagueHtml();
    state.leagueOnly = false;
    window.__results.offered = endAsLeagueHtml();
    state.leagueOnly = true;
    window.__results.ended = endAsLeagueHtml();
  `);
  assert.ok(r.offered.includes('End as League'), 'should offer the option once the group stage is complete');
  assert.ok(r.ended.includes('Ended as a league'), 'should show the final state once leagueOnly is set');
  assert.ok(r.ended.includes('Team A'), 'should name the table leader as champion in the ended message');
});

test('endAsLeagueHtml stays empty for a pure knockout format tournament (nothing to end)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(twoTeamLeagueState({ formatType: 'knockout' }))};
    window.__results.html = endAsLeagueHtml();
  `);
  assert.strictEqual(r.html, '');
});

test('endAsLeagueHtml stays empty before the group stage is actually complete', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(twoTeamLeagueState({ results: [{ played: false, g: [null, null], scorers: [], assists: [] }] }))};
    window.__results.html = endAsLeagueHtml();
  `);
  assert.strictEqual(r.html, '');
});
