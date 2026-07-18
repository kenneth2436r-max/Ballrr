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
