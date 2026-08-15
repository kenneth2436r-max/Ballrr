'use strict';
// Tests for the Friendly/Competitive "separate environments" feature: entryMode()/
// effectiveTournamentHistory()/myTournamentHistoryForMode() mode filtering (local), hostEntryMode()/
// filterHostListByMode() (followed-host/verified-card side), the jersey number helpers
// (getPlayerJerseyNumber/jerseyLabel/sortNamesByJersey), the live defensive-stats tally
// (bumpContribAndRender/toggleDefStatsPanel), and the mode badge text.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function historyFixture(overrides){
  return Object.assign({
    careerSnapshotSaved: true, results: [], playerDB: [], numTeams: 2, teamNames: ['Red FC', 'Blue FC'],
    mode: 'friendly',
    tournamentHistory: [
      { id: 'f1', date: '2026-07-01', label: 'Friendly Cup', mode: 'friendly',
        playerStats: [{ name: 'Keith', team: 'Red FC', avg: 7, count: 2, goals: 1, assists: 1, cleanSheets: 0 }] },
      { id: 'c1', date: '2026-07-05', label: 'Competitive League', mode: 'competitive',
        playerStats: [{ name: 'Densil', team: 'Blue FC', avg: 8, count: 3, goals: 4, assists: 0, cleanSheets: 0 }] },
      { id: 'legacy1', date: '2026-06-01', label: 'Old Untagged Cup',
        playerStats: [{ name: 'Sam', team: 'Red FC', avg: 6, count: 2, goals: 0, assists: 0, cleanSheets: 1 }] }
    ]
  }, overrides || {});
}

test('entryMode defaults untagged/old entries to friendly, and respects an explicit competitive tag', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.untagged = entryMode({ id: 'x' });
    window.__results.friendly = entryMode({ id: 'x', mode: 'friendly' });
    window.__results.competitive = entryMode({ id: 'x', mode: 'competitive' });
    window.__results.nothing = entryMode(null);
    window.__results.garbage = entryMode({ id: 'x', mode: 'nonsense' });
  `);
  assert.strictEqual(r.untagged, 'friendly');
  assert.strictEqual(r.friendly, 'friendly');
  assert.strictEqual(r.competitive, 'competitive');
  assert.strictEqual(r.nothing, 'friendly');
  assert.strictEqual(r.garbage, 'friendly');
});

test('effectiveTournamentHistory and myTournamentHistoryForMode only surface entries matching the CURRENT state.mode, with old untagged entries bucketed as friendly', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(historyFixture({ mode: 'friendly' }))};
    window.__results.friendlyEffective = effectiveTournamentHistory().map(t => t.id);
    window.__results.friendlyLocal = myTournamentHistoryForMode().map(t => t.id);
    state.mode = 'competitive';
    window.__results.compEffective = effectiveTournamentHistory().map(t => t.id);
    window.__results.compLocal = myTournamentHistoryForMode().map(t => t.id);
  `);
  assert.deepStrictEqual(Array.from(r.friendlyEffective).sort(), ['f1', 'legacy1']);
  assert.deepStrictEqual(Array.from(r.friendlyLocal).sort(), ['f1', 'legacy1']);
  assert.deepStrictEqual(Array.from(r.compEffective), ['c1']);
  assert.deepStrictEqual(Array.from(r.compLocal), ['c1']);
});

test('computeCareerLeaderboard only shows players from the currently active mode\'s tournaments', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(historyFixture({ mode: 'friendly' }))};
    window.__results.friendlyNames = computeCareerLeaderboard().map(p => p.name).sort();
    state.mode = 'competitive';
    window.__results.compNames = computeCareerLeaderboard().map(p => p.name).sort();
  `);
  assert.deepStrictEqual(Array.from(r.friendlyNames), ['Keith', 'Sam'], 'friendly mode should see the friendly + legacy-untagged entries only');
  assert.deepStrictEqual(Array.from(r.compNames), ['Densil'], 'competitive mode should see only Densil\'s competitive entry, not Keith or Sam');
});

test('hostEntryMode/filterHostListByMode split a followed host\'s published list by mode where there IS snapshot data, while leaving snapshot-less entries (private, or pre-dating mode) visible in both -- matching pre-existing "show every archived tile regardless" behavior', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    const list = [
      { historyId: 'h1', archived: true, snapshot: { mode: 'friendly', playerStats: [] } },
      { historyId: 'h2', archived: true, snapshot: { mode: 'competitive', playerStats: [] } },
      { historyId: 'h3', archived: true, snapshot: null },
      { code: 'LIVE1', archived: false }
    ];
    hostViewMode = 'friendly';
    window.__results.friendly = filterHostListByMode(list).map(t => t.historyId || t.code);
    hostViewMode = 'competitive';
    window.__results.competitive = filterHostListByMode(list).map(t => t.historyId || t.code);
  `);
  assert.deepStrictEqual(Array.from(r.friendly), ['h1', 'h3', 'LIVE1'], 'friendly view: h1 (friendly snapshot) + the snapshot-less h3 (nothing to categorize, stays visible) + the always-visible live pointer, not h2');
  assert.deepStrictEqual(Array.from(r.competitive), ['h2', 'h3', 'LIVE1'], 'competitive view: h2 + the same always-visible snapshot-less h3 and live pointer');
});

test('switchHostViewMode only accepts friendly/competitive and re-runs whatever refresh callback is currently registered', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    hostViewMode = 'friendly';
    let calls = 0;
    lastHostProfileRefresh = () => { calls++; };
    switchHostViewMode('competitive');
    window.__results.modeAfterValid = hostViewMode;
    window.__results.callsAfterValid = calls;
    switchHostViewMode('nonsense');
    window.__results.modeAfterInvalid = hostViewMode;
    window.__results.callsAfterInvalid = calls;
  `);
  assert.strictEqual(r.modeAfterValid, 'competitive');
  assert.strictEqual(r.callsAfterValid, 1);
  assert.strictEqual(r.modeAfterInvalid, 'competitive', 'an invalid mode string must be ignored, not silently accepted');
  assert.strictEqual(r.callsAfterInvalid, 1, 'refresh should not re-run again for a rejected mode change');
});

test('jersey number helpers: getPlayerJerseyNumber/jerseyLabel read the current roster, and sortNamesByJersey puts numbered players first ascending, unnumbered after in original order', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { players: [
      { name: 'Keith', team: 0, jerseyNumber: 7 },
      { name: 'Densil', team: 0 },
      { name: 'Sam', team: 0, jerseyNumber: 1 },
      { name: 'Alex', team: 0 }
    ] };
    window.__results.keithNum = getPlayerJerseyNumber('Keith', 0);
    window.__results.densilNum = getPlayerJerseyNumber('Densil', 0);
    window.__results.keithLabel = jerseyLabel('Keith', 0);
    window.__results.densilLabel = jerseyLabel('Densil', 0);
    window.__results.sorted = sortNamesByJersey(['Keith', 'Densil', 'Sam', 'Alex'], 0);
  `);
  assert.strictEqual(r.keithNum, 7);
  assert.strictEqual(r.densilNum, null);
  assert.strictEqual(r.keithLabel, '#7 Keith');
  assert.strictEqual(r.densilLabel, 'Densil');
  assert.deepStrictEqual(Array.from(r.sorted), ['Sam', 'Keith', 'Densil', 'Alex'], 'Sam (#1) then Keith (#7), then unnumbered Densil/Alex in their original order');
});

test('setPlayerJerseyNumber sets, clears, and rejects an out-of-range number', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { players: [{ name: 'Keith', team: 0 }] };
    window.prompt = () => '9';
    setPlayerJerseyNumber(0);
    window.__results.afterSet = state.players[0].jerseyNumber;
    window.prompt = () => '';
    setPlayerJerseyNumber(0);
    window.__results.afterClear = state.players[0].jerseyNumber;
    window.prompt = () => '5';
    setPlayerJerseyNumber(0);
    window.prompt = () => '1000';
    setPlayerJerseyNumber(0);
    window.__results.afterInvalid = state.players[0].jerseyNumber;
    window.__results.alerts = window.__alerts;
  `);
  assert.strictEqual(r.afterSet, 9);
  assert.strictEqual(r.afterClear, undefined);
  assert.strictEqual(r.afterInvalid, 5, 'an out-of-range number (1000) must be rejected, leaving the prior valid number in place');
  assert.ok(r.alerts.some(a => /between 0 and 999/i.test(a)));
});

test('bumpContribAndRender increments/decrements a live defensive stat and never goes below zero, without needing a full match-card render', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { results: [{ played: false, g: [0,0], scorers: [], assists: [] }], fixtures: [[0,1]], teamNames: ['Red FC','Blue FC'], numTeams: 2 };
    renderMatches = function(){};
    bumpContribAndRender('league', '0', 'Keith', 'saves', 1);
    bumpContribAndRender('league', '0', 'Keith', 'saves', 1);
    bumpContribAndRender('league', '0', 'Keith', 'tackles', 5);
    bumpContribAndRender('league', '0', 'Keith', 'tackles', -100);
    window.__results.contrib = state.results[0].contributions['Keith'];
  `);
  assert.strictEqual(r.contrib.saves, 2, 'two +1 taps should land on 2, not overwrite each other');
  assert.strictEqual(r.contrib.tackles, 0, 'decrementing far past zero must clamp at 0, never go negative');
});

test('toggleDefStatsPanel opens/closes per match, only one panel open at a time', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    renderMatches = function(){};
    renderKnockout = function(){};
    toggleDefStatsPanel('league', '0');
    window.__results.afterFirstOpen = defStatsOpenFor;
    toggleDefStatsPanel('league', '1');
    window.__results.afterSwitch = defStatsOpenFor;
    toggleDefStatsPanel('league', '1');
    window.__results.afterClose = defStatsOpenFor;
  `);
  assert.strictEqual(r.afterFirstOpen, 'league|0');
  assert.strictEqual(r.afterSwitch, 'league|1', 'opening a different match\'s panel should replace, not stack, the open one');
  assert.strictEqual(r.afterClose, null);
});

test('bumpCardAndRender caps yellow cards at 2 and red cards at 1 per match, and never goes below zero', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { results: [{ played: false, g: [0,0], scorers: [], assists: [] }], fixtures: [[0,1]], teamNames: ['Red FC','Blue FC'], numTeams: 2 };
    renderMatches = function(){};
    bumpCardAndRender('league', '0', 'Keith', 'yellowCards', 1);
    bumpCardAndRender('league', '0', 'Keith', 'yellowCards', 1);
    bumpCardAndRender('league', '0', 'Keith', 'yellowCards', 1);
    window.__results.yellowCapped = state.results[0].contributions['Keith'].yellowCards;
    bumpCardAndRender('league', '0', 'Keith', 'redCards', 1);
    bumpCardAndRender('league', '0', 'Keith', 'redCards', 1);
    window.__results.redCapped = state.results[0].contributions['Keith'].redCards;
    bumpCardAndRender('league', '0', 'Keith', 'redCards', -100);
    window.__results.redFloored = state.results[0].contributions['Keith'].redCards;
  `);
  assert.strictEqual(r.yellowCapped, 2, 'a 3rd yellow tap should not push the tally past 2');
  assert.strictEqual(r.redCapped, 1, 'a 2nd red tap should not push the tally past 1');
  assert.strictEqual(r.redFloored, 0, 'decrementing far past zero must clamp at 0');
});

test('playerDisciplineTotals sums yellow/red cards across every played match this tournament, optionally scoped to one team, and isPlayerSuspended flags a red card or 3+ accumulated yellows -- but only in competitive mode', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = {
      mode: 'competitive',
      results: [
        { played: true, g:[1,0], scorers:[], assists:[], contributions: { Keith: { yellowCards: 2, redCards: 0 } } },
        { played: true, g:[0,1], scorers:[], assists:[], contributions: { Keith: { yellowCards: 1, redCards: 0 }, Densil: { yellowCards: 0, redCards: 1 } } }
      ],
      fixtures: [[0,1],[0,1]], teamNames: ['Red FC','Blue FC'], numTeams: 2, customKO: null
    };
    window.__results.keithTotals = playerDisciplineTotals('Keith', 0);
    window.__results.keithSuspendedComp = isPlayerSuspended('Keith', 0);
    window.__results.densilSuspendedComp = isPlayerSuspended('Densil', 1);
    window.__results.unbookedSuspended = isPlayerSuspended('Nobody', 0);
    state.mode = 'friendly';
    window.__results.keithSuspendedFriendly = isPlayerSuspended('Keith', 0);
  `);
  assert.strictEqual(r.keithTotals.yellowCards, 3, '2 + 1 across two matches');
  assert.strictEqual(r.keithTotals.redCards, 0);
  assert.strictEqual(r.keithSuspendedComp, true, '3 accumulated yellows should flag a suspension in competitive mode');
  assert.strictEqual(r.densilSuspendedComp, true, 'a single red card should flag a suspension');
  assert.strictEqual(r.unbookedSuspended, false);
  assert.strictEqual(r.keithSuspendedFriendly, false, 'suspension tracking is competitive-mode only -- friendly mode must always read false');
});

test('renderModeBadge shows the active mode in words, not just color', () => {
  const { window } = freshWindow({ extraHtml: '<span id="app-mode-badge"></span>' });
  const r = runInOneEval(window, `
    state = { mode: 'friendly' };
    renderModeBadge();
    window.__results.friendlyText = document.getElementById('app-mode-badge').textContent;
    state.mode = 'competitive';
    renderModeBadge();
    window.__results.competitiveText = document.getElementById('app-mode-badge').textContent;
  `);
  assert.ok(/friendly/i.test(r.friendlyText));
  assert.ok(/competitive/i.test(r.competitiveText));
});
