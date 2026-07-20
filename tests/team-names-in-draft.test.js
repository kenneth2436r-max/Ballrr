'use strict';
// Regression test for: "can we move the set team names from settings to the draft tab?". The
// Team Names editor (name input + crest picker per team, "Save Names" button) used to live in
// Settings, populated by renderSettings() targeting a static #team-name-inputs div. It's now
// built directly inside renderDraft()'s generated HTML instead, so team identity (name, crest,
// captain, keeper, roster) all lives in one tab. saveTeamNames() itself is unchanged -- it just
// reads whatever #tname-N/#tcrest-N elements are currently in the DOM, so it keeps working no
// matter which tab renders them.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseDraftState(extra){
  return Object.assign({
    numTeams: 2, teamNames: ['Reds', 'Blues'], teamCrests: ['', ''], captains: ['', ''], goalkeepers: ['', ''],
    players: [], playerPool: [], rotationalPool: [], playerDB: [],
    draftTurnIndex: 0, draftBalanced: false, draftSnake: false, draftPickCount: 0,
    draftManualEntryVisible: true, mode: 'friendly', tournamentHistory: [],
    // teamAvgRating() -> playerCareerAvg() -> collectMatchRatings() walks every played match
    // across every format to compute career averages -- these keep it from crashing on an
    // empty/never-played tournament.
    results: [], fixtures: [], customKO: { enabled: false, stages: [] }, koRounds: null, page3: null,
  }, extra);
}

test('the Draft tab renders a team name input + crest picker per team, pre-filled with the current names', () => {
  // draft-container must be a REAL element attached to the document (not the harness's
  // auto-stub, which is a detached div) -- renderDraft() sets its innerHTML, and a detached
  // node's children are invisible to a later document.getElementById('tname-0') lookup even
  // though they're really there in the HTML string.
  const { window } = freshWindow({ extraHtml: '<div id="draft-container"></div>' });
  const r = runInOneEval(window, `
    drawWheel=function(){};
    state = ${JSON.stringify(baseDraftState())};
    renderDraft();
    window.__results.tname0 = document.getElementById('tname-0').value;
    window.__results.tname1 = document.getElementById('tname-1').value;
    window.__results.hasCrestPicker = !!document.getElementById('tcrest-0');
    window.__results.hasSaveButton = document.getElementById('draft-container').innerHTML.includes('Save Names');
  `);
  assert.strictEqual(r.tname0, 'Reds');
  assert.strictEqual(r.tname1, 'Blues');
  assert.strictEqual(r.hasCrestPicker, true);
  assert.strictEqual(r.hasSaveButton, true);
});

test('saveTeamNames() reads the Draft tab\'s inputs and updates state, same as it did from Settings', () => {
  // draft-container must be a REAL element attached to the document (not the harness's
  // auto-stub, which is a detached div) -- renderDraft() sets its innerHTML, and a detached
  // node's children are invisible to a later document.getElementById('tname-0') lookup even
  // though they're really there in the HTML string.
  const { window } = freshWindow({ extraHtml: '<div id="draft-container"></div>' });
  const r = runInOneEval(window, `
    drawWheel=function(){};saveState=function(){};renderAll=function(){};showToast=function(){};
    state = ${JSON.stringify(baseDraftState())};
    renderDraft();
    document.getElementById('tname-0').value = 'Renamed Reds';
    document.getElementById('tcrest-1').value = '⚽';
    saveTeamNames();
    window.__results.teamNames = state.teamNames;
    window.__results.teamCrests = state.teamCrests;
  `);
  // Array.from(...) here (not inside the eval) is what actually rehomes the array into this
  // file's own Node realm -- doing it inside window.eval() just builds another jsdom-realm
  // array, which deepStrictEqual still treats as not reference-equal to a Node-realm literal
  // even with identical contents. Same cross-realm gotcha noted in rotational-player.test.js.
  assert.deepStrictEqual(Array.from(r.teamNames), ['Renamed Reds', 'Blues']);
  assert.strictEqual(r.teamCrests[1], '⚽');
});
