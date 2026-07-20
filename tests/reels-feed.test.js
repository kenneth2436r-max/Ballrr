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

// Streaks: a rough "still going" signal, counting back from the most recent tournament how many
// in a row were each within 10 days of the previous one.
test('computeTournamentStreak counts consecutive close-together tournaments and stops at the first big gap', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.threeInARow = computeTournamentStreak(['2026-07-01','2026-07-08','2026-07-15']);
    window.__results.brokenByGap = computeTournamentStreak(['2026-01-01','2026-07-08','2026-07-15']);
    window.__results.single = computeTournamentStreak(['2026-07-01']);
    window.__results.empty = computeTournamentStreak([]);
  `);
  assert.strictEqual(r.threeInARow, 3, 'three tournaments a week apart should all count');
  assert.strictEqual(r.brokenByGap, 2, 'a 6-month-old outlier should not extend the current streak');
  assert.strictEqual(r.single, 1, 'a single tournament is still a streak of 1');
  assert.strictEqual(r.empty, 0, 'no tournaments at all is a streak of 0');
});

test('streakBadgeHtml only shows for a streak of 2 or more', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.none = streakBadgeHtml(1);
    window.__results.some = streakBadgeHtml(3);
  `);
  assert.strictEqual(r.none, '', 'a lone tournament should not be advertised as a "streak"');
  assert.ok(r.some.includes('3-tournament streak'));
});
