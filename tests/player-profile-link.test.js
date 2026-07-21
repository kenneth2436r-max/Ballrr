'use strict';
// Tests for linking a player's name to their OWN host profile (getPlayerLinkedCode()/
// setPlayerLinkedCode()/linkPlayerProfile()) -- lets a player card offer a "Visit profile"
// button so a viewer can jump straight to following that person as an organizer too, if they
// also happen to host their own tournaments. The link lives on the persistent playerDB (same
// place as tagged positions), and has to be threaded through computeRatingStats() ->
// snapshotCurrentTournament()'s playerStats -> collapsePlayerStatsByName() ->
// computeHostCareerLeaderboard() so it survives all the way out to a FOLLOWER's view of a
// published tournament, not just the organizer's own local player card.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(extra){
  return Object.assign({
    numTeams: 2, teamNames: ['Red FC', 'Blue FC'], legs: 1,
    fixtures: [[0, 1]], captains: ['', ''],
    players: [{ name: 'Alex', team: 0 }, { name: 'Sam', team: 1 }],
    playerDB: [],
    customKO: { enabled: false, stages: [] }, page3: null, koRounds: null,
    results: [{ played: true, g: [2, 1], scorers: [{ name: 'Alex', team: 0, goals: 2 }], assists: [] }],
    tournamentHistory: [],
  }, extra || {});
}

test('getPlayerLinkedCode/setPlayerLinkedCode round-trip, uppercasing the code and creating a playerDB entry if none existed', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState = function(){};
    state = ${JSON.stringify(baseState())};
    window.__results.beforeAny = getPlayerLinkedCode('Alex');
    setPlayerLinkedCode('Alex', 'abc123');
    window.__results.afterSet = getPlayerLinkedCode('Alex');
    window.__results.dbEntry = state.playerDB.find(p => p.name === 'Alex');
    setPlayerLinkedCode('Alex', '');
    window.__results.afterUnlink = getPlayerLinkedCode('Alex');
  `);
  assert.strictEqual(r.beforeAny, null, 'unlinked by default');
  assert.strictEqual(r.afterSet, 'ABC123', 'the code should be normalized to uppercase');
  assert.ok(r.dbEntry, 'a playerDB entry should be created to hold the link');
  assert.strictEqual(r.afterUnlink, null, 'an empty code should clear the link');
});

test('setPlayerLinkedCode reuses an existing playerDB entry (e.g. one already holding tagged positions) instead of creating a duplicate', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState = function(){};
    state = ${JSON.stringify(baseState({ playerDB: [{ name: 'Alex', positions: ['FWD'] }] }))};
    setPlayerLinkedCode('Alex', 'XYZ999');
    window.__results.count = state.playerDB.filter(p => p.name === 'Alex').length;
    window.__results.positionsKept = state.playerDB.find(p => p.name === 'Alex').positions;
  `);
  assert.strictEqual(r.count, 1, 'linking should not create a second playerDB row for the same name');
  // Array.from() rehomes the array into this file's own Node realm -- a jsdom-realm array
  // survives window.eval() with identical contents but a different Array constructor, which
  // deepStrictEqual treats as a mismatch even though the values are the same (see
  // team-names-in-draft.test.js for the same gotcha).
  assert.deepStrictEqual(Array.from(r.positionsKept), ['FWD'], 'existing tagged positions must survive the link');
});

test('linkPlayerProfile prompts for a code (pre-filled with the current one) and saves whatever is entered', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState = function(){}; renderDraft = function(){};
    let seenDefault = null;
    window.prompt = (msg, def) => { seenDefault = def; return 'CODE01'; };
    state = ${JSON.stringify(baseState({ playerDB: [{ name: 'Alex', positions: ['MID'], linkedHostCode: 'OLDCODE' }] }))};
    linkPlayerProfile('Alex');
    window.__results.seenDefault = seenDefault;
    window.__results.newCode = getPlayerLinkedCode('Alex');
  `);
  assert.strictEqual(r.seenDefault, 'OLDCODE', 'the prompt should be pre-filled with whatever is currently linked');
  assert.strictEqual(r.newCode, 'CODE01');
});

test('renderPlayerPositionsSection shows a link button per known player, styled differently once linked', () => {
  // draft-container must be a REAL attached element (not the harness's detached auto-stub) --
  // see team-names-in-draft.test.js for why. Full draft-shaped state fixture copied from there
  // too, since renderDraft() touches playerPool/rotationalPool/draft-order fields well beyond
  // what this test cares about.
  const { window } = freshWindow({ extraHtml: '<div id="draft-container"></div>' });
  runInOneEval(window, `
    drawWheel=function(){};
    state = {
      numTeams: 2, teamNames: ['Reds', 'Blues'], teamCrests: ['', ''], captains: ['', ''], goalkeepers: ['', ''],
      players: [{ name: 'Alex', team: 0 }, { name: 'Sam', team: 1 }], playerPool: [], rotationalPool: [],
      playerDB: [{ name: 'Alex', positions: ['MID'], linkedHostCode: 'HOSTCODE' }, { name: 'Sam', positions: ['DEF'] }],
      draftTurnIndex: 0, draftBalanced: false, draftSnake: false, draftPickCount: 0,
      draftManualEntryVisible: true, mode: 'friendly', tournamentHistory: [],
      results: [], fixtures: [], customKO: { enabled: false, stages: [] }, koRounds: null, page3: null,
    };
    renderDraft();
  `);
  const html = window.document.getElementById('draft-container').innerHTML;
  assert.ok(html.includes("linkPlayerProfile('Alex')"));
  assert.ok(html.includes("linkPlayerProfile('Sam')"));
  assert.ok(html.includes('Linked to host code HOSTCODE'), "Alex's linked state should be visible in the tooltip");
});

test('computeRatingStats and snapshotCurrentTournament carry the linked code through into playerStats', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({ playerDB: [{ name: 'Alex', positions: ['FWD'], linkedHostCode: 'ALEXCODE' }] }))};
    window.__results.ratingStats = computeRatingStats();
    window.__results.snap = snapshotCurrentTournament();
  `);
  const alexRating = r.ratingStats.find(s => s.name === 'Alex');
  assert.strictEqual(alexRating.code, 'ALEXCODE');
  const alexStats = r.snap.playerStats.find(s => s.name === 'Alex');
  assert.strictEqual(alexStats.code, 'ALEXCODE', 'the published playerStats entry should carry the link too');
  const samStats = r.snap.playerStats.find(s => s.name === 'Sam');
  assert.strictEqual(samStats.code, null, 'a player with no link should publish a null code, not be omitted');
});

test('collapsePlayerStatsByName and computeHostCareerLeaderboard preserve the code across a published snapshot, for a follower viewing it', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    const collapsed = collapsePlayerStatsByName([
      { name:'Alex', team:'Red FC', position:'FWD', goals:2, assists:0, cleanSheets:0, avg:8, count:1, code:'ALEXCODE' },
    ]);
    window.__results.collapsedCode = collapsed[0].code;
    const leaderboard = computeHostCareerLeaderboard([
      { startedAt: 1000, snapshot: { playerStats: [
        { name:'Alex', team:'Red FC', position:'FWD', goals:2, assists:0, cleanSheets:0, avg:8, count:1, code:'ALEXCODE' },
      ] } },
    ]);
    window.__results.leaderboardCode = leaderboard.find(p => p.name === 'Alex').code;
  `);
  assert.strictEqual(r.collapsedCode, 'ALEXCODE');
  assert.strictEqual(r.leaderboardCode, 'ALEXCODE');
});

test("showPlayerCard offers a Visit profile button wired to previewHostProfile when the player is linked, and omits it otherwise", () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    haptic = function(){};
    state = ${JSON.stringify(baseState({ playerDB: [{ name: 'Alex', positions: ['FWD'], linkedHostCode: 'ALEXCODE' }] }))};
    showPlayerCard('Alex');
  `);
  let html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('Visit profile'));
  assert.ok(html.includes("previewHostProfile('ALEXCODE')"));

  runInOneEval(window, `
    haptic = function(){};
    state = ${JSON.stringify(baseState())};
    showPlayerCard('Sam');
  `);
  html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(!html.includes('Visit profile'), 'a player with no linked profile should not get the button');
});

test('showHostPlayerCard offers Visit profile too, sourced from the host\'s published career leaderboard rather than local playerDB', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  const r = runInOneEval(window, `
    lastPastTournamentsList = [
      { startedAt: 1000, snapshot: { playerStats: [
        { name:'Alex', team:'Red FC', position:'FWD', goals:2, assists:0, cleanSheets:0, avg:8, count:1, code:'ALEXCODE', matchRatings:[8] },
      ] } },
    ];
    showHostPlayerCard('Alex');
    window.__results.html = document.getElementById('player-card-content').innerHTML;
  `);
  assert.ok(r.html.includes('Visit profile'));
  assert.ok(r.html.includes("previewHostProfile('ALEXCODE')"));
});
