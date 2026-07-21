'use strict';
// Tests for read-only lineups/per-match ratings on SAVED tournaments -- previously only the live
// Lineups tab (editable, drag-and-drop) could show a match's squad/formation/ratings; a follower
// looking at an archived/published tournament via a host's profile had no way to see any of that,
// only the final table + aggregate player stats. snapshotCurrentTournament() now also captures
// each match's lineup+formation (see its own comment), and savedLineupPitchHtml()/
// savedLineupSectionHtml()/renderSavedLineupPitch() render a static (non-draggable) version of
// the same pitch view from that saved data, wired into viewArchivedTournamentSnapshot().
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function minimalTwoTeamState(overrides){
  return Object.assign({
    numTeams: 2,
    teamNames: ['Red FC', 'Blue FC'],
    legs: 1,
    fixtures: [[0, 1]],
    captains: ['', ''],
    players: [
      { name: 'Alex', team: 0 },
      { name: 'Jordan', team: 0 },
      { name: 'Sam', team: 1 },
    ],
    playerDB: [],
    customKO: { enabled: false, stages: [] },
    page3: null, koRounds: null,
    results: [
      { played: true, g: [2, 1], scorers: [{ name: 'Alex', team: 0, goals: 2 }], assists: [], formation: 'standard' },
    ],
  }, overrides || {});
}

test('snapshotCurrentTournament captures per-match lineup (squad + position + rating) and formation, not just scorers', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(minimalTwoTeamState())};
    window.__results.snap = snapshotCurrentTournament();
  `);
  const match = r.snap.matches[0];
  assert.strictEqual(match.formation, 'standard');
  assert.ok(match.lineup, 'a lineup field should be present');
  // Array.from() rehomes each array into this file's own Node realm -- see
  // team-names-in-draft.test.js's comment for why a jsdom-realm array otherwise fails
  // deepStrictEqual against a Node-realm literal despite having identical contents.
  const namesA = Array.from(match.lineup.A.map(p => p.name)).sort();
  const namesB = Array.from(match.lineup.B.map(p => p.name));
  assert.deepStrictEqual(namesA, ['Alex', 'Jordan']);
  assert.deepStrictEqual(namesB, ['Sam']);
  const alex = match.lineup.A.find(p => p.name === 'Alex');
  assert.strictEqual(alex.goals, 2, "Alex's 2 goals in this match should carry through to the lineup entry");
  assert.ok(alex.rating != null, 'a computed rating should be attached to each lineup entry');
  assert.ok(['GK','DEF','MID','FWD'].includes(alex.pos));
});

test('savedLineupPitchHtml renders team names, score, and every squad member with a rating badge', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(minimalTwoTeamState())};
    const snap = snapshotCurrentTournament();
    window.__results.html = savedLineupPitchHtml(snap.matches[0]);
  `);
  assert.ok(r.html.includes('Red FC') && r.html.includes('Blue FC'));
  assert.ok(r.html.includes('2') && r.html.includes('1'), 'the scoreline should show');
  assert.ok(r.html.includes('Alex') && r.html.includes('Jordan') && r.html.includes('Sam'));
  assert.ok(r.html.includes('lp-rating'), 'rating badges should be present');
  assert.ok(!r.html.includes('ondragstart'), 'the saved/read-only pitch must not offer drag-and-drop editing');
  assert.ok(!r.html.includes('onclick'), 'the saved/read-only pitch must not offer any editing interactions');
});

test('savedLineupPitchHtml is a safe no-op for a match with no recorded lineup (older saved tournaments)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.empty = savedLineupPitchHtml({ teamA:'A', teamB:'B', scoreA:1, scoreB:0 });
    window.__results.missing = savedLineupPitchHtml(null);
  `);
  assert.strictEqual(r.empty, '');
  assert.strictEqual(r.missing, '');
});

test('savedLineupSectionHtml only offers matches that actually have lineup data, and renders the last one by default', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.withData = savedLineupSectionHtml([
      { teamA:'A', teamB:'B', scoreA:1, scoreB:0, stage:'League', lineup:{ A:[{name:'P1',pos:'MID',rating:7,goals:0,assists:0}], B:[] } },
      { teamA:'A', teamB:'C', scoreA:2, scoreB:2, stage:'Final', lineup:{ A:[], B:[] } }, // no squad recorded
    ]);
    window.__results.none = savedLineupSectionHtml([{ teamA:'A', teamB:'B', scoreA:1, scoreB:0, stage:'League' }]);
    window.__results.emptyList = savedLineupSectionHtml([]);
    window.__results.missingList = savedLineupSectionHtml(undefined);
  `);
  assert.ok(r.withData.includes('Lineups'));
  assert.ok(r.withData.includes('saved-lineup-select'));
  assert.ok(r.withData.includes('P1'), 'the only match with recorded lineup data should be selectable and shown');
  assert.strictEqual(r.none, '', 'no section should render when nothing has lineup data');
  assert.strictEqual(r.emptyList, '');
  assert.strictEqual(r.missingList, '');
});

test('renderSavedLineupPitch updates the pitch container to match whichever index is currently selected', () => {
  // Both selections are made inside ONE runInOneEval() call: a second, separate eval() call
  // re-runs the whole app source from scratch, which would reset savedLineupSelIdx back to its
  // initial `null` before the second selection ever took effect (same jsdom quirk documented at
  // the top of tests/helpers/harness.js, and hit earlier with toggleLiveAnnounced).
  const { window } = freshWindow({ extraHtml: '<div id="saved-lineup-pitch"></div>' });
  const r = runInOneEval(window, `
    lastViewedRecapEntry = { snapshot: { matches: [
      { teamA:'Red', teamB:'Blue', scoreA:1, scoreB:0, stage:'League', lineup:{ A:[{name:'Alex',pos:'FWD',rating:8,goals:1,assists:0}], B:[] } },
      { teamA:'Red', teamB:'Green', scoreA:3, scoreB:1, stage:'Final', lineup:{ A:[{name:'Jordan',pos:'MID',rating:6,goals:0,assists:1}], B:[] } },
    ] } };
    savedLineupSelIdx = 0;
    renderSavedLineupPitch();
    window.__results.firstHtml = document.getElementById('saved-lineup-pitch').innerHTML;
    savedLineupSelIdx = 1;
    renderSavedLineupPitch();
    window.__results.secondHtml = document.getElementById('saved-lineup-pitch').innerHTML;
  `);
  assert.ok(r.firstHtml.includes('Alex'));
  assert.ok(r.secondHtml.includes('Jordan'), 'switching the selection should re-render the pitch for the newly picked match');
  assert.ok(!r.secondHtml.includes('Alex'), 'the previous match\'s pitch should no longer be shown');
});

test('viewArchivedTournamentSnapshot shows the Lineups section when the published snapshot has per-match lineup data', () => {
  const { window } = freshWindow({ extraHtml: '<div id="recap-modal" style="display:none"><div id="recap-card-content"></div></div>' });
  const r = runInOneEval(window, `
    lastViewedHostUid = 'hostUid';
    const entry = { label:'Summer Cup', dateStr:'2026-07-01', historyId:'hist1', visibility:'public',
      snapshot: { table:[], playerStats:[], matches:[
        { teamA:'Red', teamB:'Blue', scoreA:2, scoreB:1, stage:'League', lineup:{ A:[{name:'Alex',pos:'FWD',rating:8,goals:2,assists:0}], B:[{name:'Sam',pos:'DEF',rating:5,goals:0,assists:0}] } },
      ] } };
    viewArchivedTournamentSnapshot(entry);
    window.__results.html = document.getElementById('recap-card-content').innerHTML;
  `);
  assert.ok(r.html.includes('Lineups'));
  assert.ok(r.html.includes('Alex'));
});

test('viewArchivedTournamentSnapshot omits the Lineups section for an older snapshot with no lineup data', () => {
  const { window } = freshWindow({ extraHtml: '<div id="recap-modal" style="display:none"><div id="recap-card-content"></div></div>' });
  const r = runInOneEval(window, `
    lastViewedHostUid = 'hostUid';
    const entry = { label:'Old Cup', dateStr:'2025-01-01', historyId:'hist0', visibility:'public',
      snapshot: { table:[], playerStats:[], matches:[
        { teamA:'Red', teamB:'Blue', scoreA:2, scoreB:1, stage:'League' },
      ] } };
    viewArchivedTournamentSnapshot(entry);
    window.__results.html = document.getElementById('recap-card-content').innerHTML;
  `);
  assert.ok(!r.html.includes('Lineups & Match Ratings'));
});
