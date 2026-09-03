'use strict';
// Tests for the roadmap's Phase 2 (Match-Scoring UX): a "Next up" banner pointing at the first
// unplayed league match, a distinct LIVE badge/border on a match card whose timer is running, and
// the quickAddGoal/quickAddAssist (+ KO equivalents) 2-tap scoring flow that chains the existing
// team-pick popup straight into a player picker built on the custom-select-overlay.
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

test('nextUpMatchInfo finds the first unplayed league match, returns null for knockout format or when everything is played', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    window.__results.firstUnplayed = nextUpMatchInfo();
    state.results[0].played = true;
    window.__results.secondUnplayed = nextUpMatchInfo();
    state.results[1].played = true;
    window.__results.noneLeft = nextUpMatchInfo();
    state.formatType = 'knockout';
    state.results[0].played = false;
    window.__results.knockoutSkipped = nextUpMatchInfo();
  `);
  assert.strictEqual(r.firstUnplayed.mi, 0);
  assert.strictEqual(r.secondUnplayed.mi, 1);
  assert.strictEqual(r.noneLeft, null, 'once every match is played, there is nothing left to point at');
  assert.strictEqual(r.knockoutSkipped, null, 'a pure knockout tournament has no flat fixture list -- must not crash or misreport');
});

test('nextUpMatchBannerHtml renders the two team names for the next match, and is empty when there is none or the next match is already live', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    window.__results.withNext = nextUpMatchBannerHtml();
    state.results[0].timer = { running: true };
    window.__results.whileLive = nextUpMatchBannerHtml();
    state.results[0].timer = { running: false };
    state.results[0].played = true;
    state.results[1].played = true;
    window.__results.noneLeft = nextUpMatchBannerHtml();
  `);
  assert.ok(r.withNext.includes('Red FC') && r.withNext.includes('Blue FC'), 'banner should name both teams of the next unplayed match');
  assert.ok(r.withNext.includes('next-up-banner'));
  assert.strictEqual(r.whileLive, '', 'once that match actually starts (timer running), the LIVE badge on its own card covers it -- the banner should step aside');
  assert.strictEqual(r.noneLeft, '', 'nothing to point at once every match is played');
});

test('renderMatches marks a match card LIVE (badge + match-card-live class) only while its timer is running, and gives every card a stable scrollable id', () => {
  const { window } = freshWindow({ extraHtml: '<div id="matches-container"></div>' });
  const r = runInOneEval(window, `
    matchTimerHtml=function(){return'';};
    matchFeedHtml=function(){return'';};
    squadPickerHtml=function(){return'';};
    rivalryHtml=function(){return'';};
    isFriendlyMode=function(){return false;};
    knockoutSectionHtml=function(){return'';};
    potmVoteHtml=function(){return'';};
    predictionHtml=function(){return'';};
    defStatsPanelHtml=function(){return'';};
    state = ${JSON.stringify(baseState())};
    state.results[0].timer = { running: true };
    currentUser = null; sharedMeta = null;
    renderMatches();
    window.__results.html = document.getElementById('matches-container').innerHTML;
  `);
  assert.ok(r.html.includes('class="match-card match-card-live" id="match-card-0"'),
    'match 0 (timer running) should carry both the match-card-live class and its stable id');
  const card0 = r.html.slice(r.html.indexOf('id="match-card-0"'), r.html.indexOf('id="match-card-1"'));
  const card1 = r.html.slice(r.html.indexOf('id="match-card-1"'));
  assert.ok(card0.includes('live-badge') && card0.includes('🔴 LIVE'), 'match 0 (timer running) should show the LIVE badge');
  assert.ok(!card1.includes('live-badge'), 'match 1 (no timer running) should NOT show the LIVE badge');
  assert.ok(card1.includes('id="match-card-1"'), 'every card should have its own stable id for the next-up banner to scroll to');
});

test('quickPickerRoster prefers the match squad (sorted by jersey) when set, falls back to the full team roster otherwise', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({
      players: [{ name: 'Keith', team: 0 }, { name: 'Densil', team: 0 }, { name: 'Sam', team: 0 }]
    }))};
    window.__results.fallbackToFullRoster = quickPickerRoster('league', '0', 0).slice().sort();
    state.results[0].squad = { 0: ['Densil', 'Sam'] };
    window.__results.usesMatchSquad = quickPickerRoster('league', '0', 0).slice().sort();
  `);
  assert.deepStrictEqual(Array.from(r.fallbackToFullRoster), ['Densil', 'Keith', 'Sam'], 'with no squad marked for this match yet, fall back to everyone on the team roster');
  assert.deepStrictEqual(Array.from(r.usesMatchSquad), ['Densil', 'Sam'], 'once a squad is marked for this match, only those players should be offered');
});

test('openQuickPlayerPicker calls onPick("") immediately (no popup) when the roster is empty, matching the original flow\'s "blank row" fallback', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    let pickedWith = 'not-called';
    openQuickPlayerPicker('league', '0', 0, 'Who scored?', (name) => { pickedWith = name; });
    window.__results.pickedWith = pickedWith;
    window.__results.overlayShown = document.getElementById('custom-select-overlay').style.display;
  `);
  assert.strictEqual(r.pickedWith, '', 'with nobody on the roster yet, it should hand back an empty name right away instead of showing an empty picker');
  assert.notStrictEqual(r.overlayShown, 'flex', 'the picker overlay should never have been opened');
});

test('openQuickPlayerPicker populates the picker with the roster (jersey-labelled) plus a custom-name option, and picking one calls onPick with that name', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({ players: [{ name: 'Keith', team: 0 }, { name: 'Densil', team: 0 }] }))};
    let pickedWith = null;
    openQuickPlayerPicker('league', '0', 0, 'Who scored?', (name) => { pickedWith = name; });
    window.__results.optionsText = document.getElementById('custom-select-options').innerHTML;
    pickCustomSelectOption(0);
    window.__results.pickedWith = pickedWith;
  `);
  assert.ok(r.optionsText.includes('Keith') && r.optionsText.includes('Densil') && /Custom name/.test(r.optionsText), 'the picker should list every roster player plus a custom-name escape hatch');
  assert.strictEqual(r.pickedWith, 'Keith', 'picking the first option should hand back that player\'s name');
});

test('openQuickPlayerPicker routes the custom-name option through showThemedPrompt and hands the typed name to onPick', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({ players: [{ name: 'Keith', team: 0 }] }))};
    window.prompt = () => 'Ad-hoc Sub';
    let pickedWith = null;
    openQuickPlayerPicker('league', '0', 0, 'Who scored?', (name) => { pickedWith = name; });
    const opts = document.getElementById('custom-select-options').querySelectorAll('.custom-select-opt');
    pickCustomSelectOption(opts.length - 1);
    window.__results.pickedWith = pickedWith;
  `);
  assert.strictEqual(r.pickedWith, 'Ad-hoc Sub', 'choosing "Custom name..." should prompt for a name and hand it to onPick once submitted');
});

test('quickAddGoal (league): picking a team then a player adds a scorer row and applies the name through the SAME updateScorer path a manual pick would use', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState = function(){};
    renderMatches = function(){};
    const updateScorerCalls = [];
    const realUpdateScorer = updateScorer;
    updateScorer = function(mi, si, field, val){ updateScorerCalls.push([mi, si, field, val]); };
    state = ${JSON.stringify(baseState({ players: [{ name: 'Keith', team: 0 }] }))};
    quickAddGoal(0);
    pickTeamForScorer(0); // team A = Red FC (id 0)
    pickCustomSelectOption(0); // first roster option = Keith
    window.__results.scorerPushed = state.results[0].scorers[0];
    window.__results.updateScorerCalls = updateScorerCalls;
  `);
  // r.scorerPushed is an object built inside the jsdom vm context, which has its own realm-local
  // Object constructor/prototype -- deepStrictEqual treats that as unequal to a same-shaped
  // literal from THIS (Node main-realm) file even though every property matches. Spreading it
  // into a fresh object here rebuilds it with the outer realm's Object, sidestepping that.
  assert.deepStrictEqual({ ...r.scorerPushed }, { team: 0, name: '', goals: 1 }, 'addScorer() should have pushed a real blank row for team 0, exactly like the manual flow');
  assert.strictEqual(r.updateScorerCalls.length, 1);
  assert.deepStrictEqual(Array.from(r.updateScorerCalls[0]), [0, 0, 'name', 'Keith'], 'updateScorer(mi, si, "name", val) should be called with the correct match/row index and the picked name -- the same call a manual dropdown pick would make');
});

test('quickAddKOGoal: picking a team then a player adds a scorer to the right knockout match object and applies the name through updateKOScorer', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState = function(){};
    renderKnockout = function(){};
    const updateKOScorerCalls = [];
    updateKOScorer = function(pathKey, si, field, val, teamIds){ updateKOScorerCalls.push([pathKey, si, field, val, teamIds]); };
    state = ${JSON.stringify(baseState({ players: [{ name: 'Densil', team: 1 }], customKO: { enabled: true, stages: [{ name: 'Final', matches: [{}] }] }, customResults: [[{ scorers: [], assists: [] }]] }))};
    getMatchObjByPath = function(pathKey){ return state.customResults[0][0]; };
    quickAddKOGoal('0.0', [0, 1]);
    pickTeamForScorer(1); // team B = Blue FC (id 1)
    pickCustomSelectOption(0); // only roster option = Densil
    window.__results.scorerPushed = state.customResults[0][0].scorers[0];
    window.__results.calls = updateKOScorerCalls;
  `);
  assert.deepStrictEqual({ ...r.scorerPushed }, { team: 1, name: '', goals: 1 });
  assert.strictEqual(r.calls.length, 1);
  // JSON round-trip (rather than a spread/Array.from, which only fix the outer level) to get a
  // genuinely plain, same-realm structure for this nested [string, number, string, string, array]
  // call-args tuple -- see the scorerPushed comment above for why cross-realm objects/arrays trip
  // up deepStrictEqual here.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.calls[0])), ['0.0', 0, 'name', 'Densil', [0, 1]]);
});
