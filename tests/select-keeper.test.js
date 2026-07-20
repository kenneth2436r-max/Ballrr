'use strict';
// Tests for the Draft Board "Select Keeper" control (hidden under the same Manual toggle as the
// paste-roster inputs): lets an organizer fix one player as a team's permanent keeper instead of
// having to place them in goal by hand in the Lineup tab for every match. Under the hood this
// just sets the player's primary Player Position to GK (the same mechanism effectivePlayerPosition()
// already falls back to for every match with no per-match override), so the existing Lineup tab
// drag-and-drop swap still works unchanged for a one-off, single-match keeper change.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

const STUBS = `saveState=function(){};renderDraft=function(){};renderAll=function(){};`;

test('setTeamKeeper tags the chosen player GK as their primary position', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    state = { numTeams:2, captains:['',''], players:[{name:'Alice',team:0},{name:'Bob',team:0}], playerDB:[] };
    setTeamKeeper(0,'Alice');
    window.__results.aliceIsGK = getPlayerPosition('Alice')==='GK';
    window.__results.bobUnaffected = getPlayerPosition('Bob');
  `);
  assert.strictEqual(r.aliceIsGK, true);
  assert.strictEqual(r.bobUnaffected, 'MID', 'an untagged player still defaults to MID, unaffected by someone else being made keeper');
});

test('picking a new keeper demotes the team\'s previous keeper back to MID', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    state = { numTeams:2, captains:['',''], players:[{name:'Alice',team:0},{name:'Bob',team:0}], playerDB:[{name:'Alice',positions:['GK']}] };
    setTeamKeeper(0,'Bob');
    window.__results.alicePos = getPlayerPosition('Alice');
    window.__results.bobPos = getPlayerPosition('Bob');
  `);
  assert.strictEqual(r.bobPos, 'GK');
  assert.strictEqual(r.alicePos, 'MID', 'the old keeper must be demoted so a team never has two players simultaneously tagged GK');
});

test('demoting a keeper on one team never touches a same-named/other keeper on a different team', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    state = { numTeams:2, captains:['',''], players:[{name:'Alice',team:0},{name:'Carl',team:1}], playerDB:[{name:'Alice',positions:['GK']},{name:'Carl',positions:['GK']}] };
    setTeamKeeper(0,''); // clear team 0's keeper
    window.__results.alicePos = getPlayerPosition('Alice');
    window.__results.carlPos = getPlayerPosition('Carl');
  `);
  assert.strictEqual(r.alicePos, 'MID');
  assert.strictEqual(r.carlPos, 'GK', "team 1's keeper must be untouched by a change scoped to team 0");
});

test('passing an empty name just clears the current keeper without assigning anyone new', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    state = { numTeams:1, captains:[''], players:[{name:'Alice',team:0}], playerDB:[{name:'Alice',positions:['GK']}] };
    setTeamKeeper(0,'');
    window.__results.alicePos = getPlayerPosition('Alice');
  `);
  assert.strictEqual(r.alicePos, 'MID');
});

test('a per-match Lineup swap (posOverrides) still takes priority over the permanent keeper tag for that one match', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    state = { numTeams:1, captains:[''], players:[{name:'Alice',team:0},{name:'Bob',team:0}], playerDB:[] };
    setTeamKeeper(0,'Alice');
    const matchObj = { posOverrides: { Alice:'DEF', Bob:'GK' } }; // referee covered mid-match
    window.__results.aliceMatchPos = effectivePlayerPosition(matchObj,'Alice');
    window.__results.bobMatchPos = effectivePlayerPosition(matchObj,'Bob');
    window.__results.alicePermanentPos = getPlayerPosition('Alice'); // untouched by the one-match override
  `);
  assert.strictEqual(r.aliceMatchPos, 'DEF');
  assert.strictEqual(r.bobMatchPos, 'GK');
  assert.strictEqual(r.alicePermanentPos, 'GK', "a one-match swap must not change Alice's permanent keeper status for future matches");
});

// Regression test for: "the captain's name doesn't show up in the set keeper box". Root cause:
// the dropdown and badge were built from `picks` (state.players filtered by team) only, but a
// captain is set by name directly in the Captains section and doesn't have to also be drafted
// onto state.players -- fullTeamRoster() already knows to fall back to including the captain,
// the roster-card just wasn't using it for the keeper controls.
test('the Set Keeper dropdown includes the team captain, not just drafted pool players', () => {
  // draft-container must be a real, document-attached element -- see the same note in
  // tests/team-names-in-draft.test.js. The harness's auto-stub for a missing id is a detached
  // div, so a nested id inside its innerHTML (like keeper-select-0) is otherwise unreachable via
  // a later document.getElementById() call even though it's really there in the HTML string.
  const { window } = freshWindow({ extraHtml: '<div id="draft-container"></div>' });
  const r = runInOneEval(window, `
    drawWheel=function(){};
    state = {
      numTeams:1, teamNames:['Reds'], captains:['Alice'], goalkeepers:[''],
      players:[{name:'Bob',team:0}], playerPool:[], rotationalPool:[], playerDB:[],
      draftTurnIndex:0, draftBalanced:false, draftSnake:false, draftPickCount:0,
      draftManualEntryVisible:true, mode:'friendly', tournamentHistory:[],
      results:[], fixtures:[], customKO:{enabled:false,stages:[]}, koRounds:null, page3:null
    };
    renderDraft();
    window.__results.selectHtml = document.getElementById('keeper-select-0').innerHTML;
  `);
  assert.ok(r.selectHtml.includes('Alice'), 'the captain must be selectable as keeper even though they were never separately drafted onto state.players');
  assert.ok(r.selectHtml.includes('Bob'), 'a normally-drafted player should still be listed too');
});
