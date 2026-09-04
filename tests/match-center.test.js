'use strict';
// Tests for the Match Center feature (user request: "click on a match and see the details or
// log", comparing Ballrr's old single-scroll Matches list unfavorably to a cleaner competitor).
// The scrolling Matches list now shows only glanceable info per match (score, LIVE badge, timer,
// predictions, feed) plus a "View match & log" button; scorer/assist entry, the squad picker, and
// defensive stats moved into a modal (Match Center) opened per match. Covers: the compact card no
// longer clutters the list with all of that, the modal opens/closes/populates correctly, and
// editing while the modal is open keeps its content in sync (since renderMatches() now also
// refreshes the modal on every pass if one is open).
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(overrides){
  return Object.assign({
    formatType: 'league', numTeams: 2, teamNames: ['Red FC','Blue FC'], legs: 1,
    fixtures: [[0,1],[0,1]],
    results: [
      { played: false, g:[0,0], scorers: [], assists: [] },
      { played: false, g:[0,0], scorers: [], assists: [] }
    ],
    predictions: {}, potmVotes: {}, resultsCompact: false, appMode: 'quickmatch',
    players: [], captains: {}, playerPool: []
  }, overrides || {});
}

const STUBS = `
  matchTimerHtml=function(){return'';};
  matchFeedHtml=function(){return'';};
  rivalryHtml=function(){return'';};
  isFriendlyMode=function(){return false;};
  knockoutSectionHtml=function(){return'';};
  potmVoteHtml=function(){return'';};
  matchAutoPOTMHtml=function(){return'';};
  predictionHtml=function(){return'';};
  squadPickerHtml=function(){return'<div id="squad-marker">SQUAD</div>';};
  defStatsPanelHtml=function(){return'<div id="defstats-marker">DEFSTATS</div>';};
  currentUser=null; sharedMeta=null;
`;

test('the compact match card in the list no longer contains scorer/assist/squad/defensive-stats content, only a "View match & log" button', () => {
  const { window } = freshWindow({ extraHtml: '<div id="matches-container"></div>' });
  const r = runInOneEval(window, `
    ${STUBS}
    state = ${JSON.stringify(baseState())};
    renderMatches();
    window.__results.html = document.getElementById('matches-container').innerHTML;
  `);
  assert.ok(!r.html.includes('squad-marker'), 'squad picker must not render inline in the list anymore');
  assert.ok(!r.html.includes('defstats-marker'), 'defensive stats panel must not render inline in the list anymore');
  assert.ok(!r.html.includes('scorer-row'), 'scorer/assist input rows must not render inline in the list anymore');
  assert.ok(!r.html.includes('promptAddScorer'), '"+ Add scorer" must not be in the compact list card');
  assert.ok(r.html.includes("openMatchCenter('league','0')"), 'the compact card must have a way to open the Match Center for that match');
  assert.ok(r.html.includes('View match'));
});

test('the compact card\'s "View match & log" button shows how many scorers are already logged', () => {
  const { window } = freshWindow({ extraHtml: '<div id="matches-container"></div>' });
  const r = runInOneEval(window, `
    ${STUBS}
    state = ${JSON.stringify(baseState({
      results: [
        { played: false, g:[0,0], scorers: [{team:0,name:'Keith',goals:1},{team:0,name:'',goals:1}], assists: [] },
        { played: false, g:[0,0], scorers: [], assists: [] }
      ]
    }))};
    renderMatches();
    window.__results.html = document.getElementById('matches-container').innerHTML;
  `);
  const card0 = r.html.slice(r.html.indexOf('id="match-card-0"'), r.html.indexOf('id="match-card-1"'));
  const card1 = r.html.slice(r.html.indexOf('id="match-card-1"'));
  assert.ok(/1 scorer logged/.test(card0), 'only the named scorer row should count -- the blank placeholder row should not be counted as "logged"');
  assert.ok(/No scorers logged yet/.test(card1));
});

test('openMatchCenter shows the overlay, sets the title, and fills the body with that match\'s full detail (scorer rows, squad picker, defensive stats)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState({
      results: [
        { played: false, g:[0,0], scorers: [{team:0,name:'Keith',goals:1}], assists: [] },
        { played: false, g:[0,0], scorers: [], assists: [] }
      ]
    }))};
    openMatchCenter('league', 0);
    window.__results.overlayDisplay = document.getElementById('match-center-overlay').style.display;
    window.__results.title = document.getElementById('match-center-title').textContent;
    window.__results.body = document.getElementById('match-center-body').innerHTML;
  `);
  assert.strictEqual(r.overlayDisplay, 'flex');
  assert.ok(r.title.includes('Red FC') && r.title.includes('Blue FC'));
  assert.ok(r.body.includes('squad-marker'));
  assert.ok(r.body.includes('defstats-marker'));
  assert.ok(r.body.includes('Keith'), 'the already-logged scorer should show up in the detail view');
  assert.ok(/id="scorers-0"/.test(r.body) && /id="toast-0"/.test(r.body), 'the detail view should carry the same ids the app\'s save/update logic targets');
});

test('closeMatchCenter hides the overlay and clears the open-match state', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    openMatchCenter('league', 0);
    closeMatchCenter();
    window.__results.overlayDisplay = document.getElementById('match-center-overlay').style.display;
    window.__results.matchCenterOpen = matchCenterOpen;
  `);
  assert.strictEqual(r.overlayDisplay, 'none');
  assert.strictEqual(r.matchCenterOpen, null);
});

test('editing a match while its Match Center is open keeps the modal in sync -- adding a scorer through the real addScorer() flow shows up in the modal without needing to reopen it', () => {
  const { window } = freshWindow({ extraHtml: '<div id="matches-container"></div>' });
  const r = runInOneEval(window, `
    ${STUBS}
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    openMatchCenter('league', 0);
    window.__results.beforeScorerRows = (document.getElementById('match-center-body').innerHTML.match(/class="scorer-row"/g) || []).length;
    addScorer(0, 0); // real addScorer() -- pushes a row + calls the real saveState/renderMatches
    window.__results.afterScorerRows = (document.getElementById('match-center-body').innerHTML.match(/class="scorer-row"/g) || []).length;
  `);
  assert.strictEqual(r.beforeScorerRows, 0);
  assert.strictEqual(r.afterScorerRows, 1, 'renderMatches() (called by addScorer) should have refreshed the open modal to include the new scorer row');
});

test('renderMatches() does NOT touch the Match Center modal when none is open (no unnecessary DOM writes to a hidden/absent modal)', () => {
  const { window } = freshWindow({ extraHtml: '<div id="matches-container"></div>' });
  const r = runInOneEval(window, `
    ${STUBS}
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    let renderMatchCenterModalCalls = 0;
    const real = renderMatchCenterModal;
    renderMatchCenterModal = function(){ renderMatchCenterModalCalls++; return real(); };
    renderMatches();
    window.__results.calls = renderMatchCenterModalCalls;
  `);
  assert.strictEqual(r.calls, 0, 'with no match center open, renderMatches() should not call renderMatchCenterModal at all');
});

test('openMatchCenter for a match index that no longer exists closes itself instead of showing broken/stale content', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUBS}
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    openMatchCenter('league', 5); // out of range -- only 2 fixtures exist
    window.__results.overlayDisplay = document.getElementById('match-center-overlay').style.display;
    window.__results.matchCenterOpen = matchCenterOpen;
  `);
  assert.strictEqual(r.overlayDisplay, 'none');
  assert.strictEqual(r.matchCenterOpen, null);
});
