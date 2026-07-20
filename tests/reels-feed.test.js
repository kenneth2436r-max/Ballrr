'use strict';
// Tests for the Instagram-style Reels feed (renderReelsFeed()/reelCardHtml()/
// matchTopPerformer()) -- a new, additive consumption view of played matches, separate from the
// classic Matches (score entry), Scorers (logging), and History (renderResults()) tabs, which
// are untouched. See public/index.html's "REELS" section.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function minimalTwoTeamState(overrides){
  return Object.assign({
    numTeams: 2,
    teamNames: ['Red FC', 'Blue FC'],
    fixtures: [[0, 1]],
    captains: ['', ''],
    players: [
      { name: 'Alex', team: 0 },
      { name: 'Sam', team: 1 },
    ],
    playerDB: [],
    results: [
      { played: true, g: [2, 1], scorers: [{ name: 'Alex', team: 0, goals: 2 }], assists: [] },
    ],
  }, overrides || {});
}

test('renderReelsFeed shows nothing-played state when no match has been played yet', () => {
  const { window } = freshWindow({ extraHtml: '<div id="reels-container"></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(minimalTwoTeamState({ results: [{ played: false, g: [0, 0], scorers: [], assists: [] }] }))};
    renderReelsFeed();
  `);
  const html = window.document.getElementById('reels-container').innerHTML;
  assert.ok(html.includes('No matches played yet'), 'an empty-state message should show, not a blank feed');
});

test('renderReelsFeed renders a card with the score, scorer, and a computed Man of the Match', () => {
  const { window } = freshWindow({ extraHtml: '<div id="reels-container"></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(minimalTwoTeamState())};
    renderReelsFeed();
  `);
  const html = window.document.getElementById('reels-container').innerHTML;
  assert.ok(html.includes('Red FC') && html.includes('Blue FC'), 'both team names should show');
  assert.ok(html.includes('2') && html.includes('1'), 'the scoreline should show');
  assert.ok(html.includes('Alex'), 'the scorer should be named');
  assert.ok(html.includes('Man of the Match'), 'a Man of the Match line should be computed for a played match');
  assert.ok(html.includes("showPlayerCard("), 'the Man of the Match name should be tappable, opening their player card');
});

test('matchTopPerformer picks the higher-rated player across both squads (goals should outweigh a quiet game)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(minimalTwoTeamState())};
    window.__results.top = matchTopPerformer(state.results[0], [0, 1]);
  `);
  assert.strictEqual(r.top.name, 'Alex', 'Alex scored twice and should outrate Sam, who did nothing notable');
});
