'use strict';
// Tests for the automatic, rating-based Player of the Match (computeMatchPOTM()/
// matchAutoPOTMHtml() in public/index.html) -- separate from the existing community jury vote
// (potmVoteHtml(), opt-in and shared-tournaments-only). This one is computed automatically for
// every played match, any format, solo or shared, straight from the same computeMatchPlayerRatings()
// the Lineup tab and saved snapshot already use, so it's guaranteed to agree with whatever rating
// a player's card shows for that match.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(overrides){
  return Object.assign({
    numTeams: 2, teamNames: ['Red FC','Blue FC'],
    players: [
      { name:'Hero', team:0 }, { name:'Sidekick', team:0 },
      { name:'Loser1', team:1 }, { name:'Loser2', team:1 },
    ],
    captains: ['',''], playerDB: [],
  }, overrides || {});
}

function playedMatch(overrides){
  return Object.assign({
    played: true, g: [3,0],
    scorers: [{ team:0, name:'Hero', goals:3 }],
    assists: [], squad: {}, rotational: {}, posOverrides: {},
    ratingOverrides: {}, contributions: {}, formation: 'standard',
  }, overrides || {});
}

test('computeMatchPOTM picks the single highest-rated player across both squads, with their team attributed correctly', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    window.__results.potm = computeMatchPOTM(${JSON.stringify(playedMatch())}, [0,1]);
  `);
  assert.ok(r.potm, 'should find a POTM for a played match with a clear standout');
  assert.strictEqual(r.potm.name, 'Hero', 'the hat-trick hero on the winning side should be rated highest');
  assert.strictEqual(r.potm.team, 'Red FC');
  assert.ok(typeof r.potm.rating === 'number' && r.potm.rating > 0);
});

test('matchAutoPOTMHtml shows nothing for a match that has not been played yet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    window.__results.html = matchAutoPOTMHtml(0, ${JSON.stringify(playedMatch({ played:false }))}, [0,1]);
  `);
  assert.strictEqual(r.html, '', 'no POTM should be shown before the match is marked played');
});

test('matchAutoPOTMHtml renders the automatic POTM once the match is over, distinct from the jury vote section', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    window.__results.html = matchAutoPOTMHtml(0, ${JSON.stringify(playedMatch())}, [0,1]);
  `);
  assert.ok(r.html.includes('Hero'), 'the winning standout should be named');
  assert.ok(r.html.includes('Player of the Match'));
});

test('snapshotCurrentTournament persists the automatic POTM per match, so it survives into the Archive', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({
      legs: 1,
      fixtures: [[0,1]],
      results: [playedMatch()],
      koRounds: null, customKO: { enabled:false, stages:[] }, page3: undefined,
      rotationalPool: [],
    }))};
    window.__results.snap = snapshotCurrentTournament();
  `);
  const match = r.snap.matches[0];
  assert.ok(match, 'the played match should be captured in the snapshot');
  assert.ok(match.potm, "the snapshot's match entry should carry the automatic POTM");
  assert.strictEqual(match.potm.name, 'Hero');
  assert.strictEqual(match.potm.team, 'Red FC');
});
