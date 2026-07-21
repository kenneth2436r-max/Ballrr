'use strict';
// Tests for shareable tournament recap cards (drawTournamentRecapCanvas()/
// shareMyTournamentRecap()/shareHostTournamentRecap()/fitCanvasText()) -- exports a finished
// tournament's final table + star player + top scorer as a PNG via the existing
// shareCanvasAsImage() share-sheet plumbing (see shareStandings() for the established pattern).
//
// jsdom has no real <canvas> 2D context (the 'canvas' npm package isn't a project dependency),
// so these tests stub out drawTournamentRecapCanvas() and shareCanvasAsImage() themselves (same
// stub-the-heavy-stuff approach the harness already uses for renderAll/ensureShape/etc.) and
// assert on what they were CALLED with -- i.e. that the right data gets wired to the right
// place -- rather than exercising real canvas drawing. fitCanvasText() takes its ctx as a plain
// argument, so that one is tested directly with a fake ctx object.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('shareMyTournamentRecap draws the recap canvas from the matching saved tournament and shares it', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__drawCalls = [];
    window.__shareCalls = [];
    drawTournamentRecapCanvas = function(label, dateStr, table, playerStats, champion, matches){
      window.__drawCalls.push({ label, dateStr, table, playerStats, champion, matches });
      return { fake: 'canvas' };
    };
    shareCanvasAsImage = function(canvas, filename, title, text){
      window.__shareCalls.push({ canvas, filename, title, text });
    };
    state = { tournamentHistory: [
      { id:'hist1', label:'Summer Cup', date:'2026-07-01', table:[{name:'Red',pts:9}], playerStats:[{name:'Alex',goals:3,avg:8.1}],
        champion:'Red FC', matches:[{teamA:'Red FC',teamB:'Blue FC',scoreA:3,scoreB:1,stage:'Final',scorers:[]}] },
    ] };
    shareMyTournamentRecap('hist1');
    window.__results.draws = window.__drawCalls;
    window.__results.shares = window.__shareCalls;
  `);
  assert.strictEqual(r.draws.length, 1, 'the recap canvas should be drawn exactly once');
  assert.strictEqual(r.draws[0].label, 'Summer Cup');
  assert.strictEqual(r.draws[0].dateStr, '2026-07-01');
  assert.strictEqual(r.draws[0].table[0].name, 'Red');
  assert.strictEqual(r.draws[0].playerStats[0].name, 'Alex');
  assert.strictEqual(r.draws[0].champion, 'Red FC', 'the saved champion should be passed through to the canvas');
  assert.strictEqual(r.draws[0].matches[0].stage, 'Final', 'the saved per-match knockout data should be passed through to the canvas');
  assert.strictEqual(r.shares.length, 1, 'the drawn canvas should be handed to the share plumbing exactly once');
  assert.ok(r.shares[0].text.includes('Summer Cup'), 'the share text should reference the tournament');
});

test('shareMyTournamentRecap is a safe no-op for an id with no matching saved tournament', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__drawCalls = [];
    drawTournamentRecapCanvas = function(){ window.__drawCalls.push(1); };
    state = { tournamentHistory: [] };
    shareMyTournamentRecap('nope');
    window.__results.draws = window.__drawCalls;
  `);
  assert.strictEqual(r.draws.length, 0, 'nothing should be drawn for an unknown id');
});

test('openProfileEntry renders a Share recap card button wired to shareMyTournamentRecap for this tournament', () => {
  const { window } = freshWindow({ extraHtml: '<div id="profile-entry-modal" style="display:none"><div id="profile-entry-content"></div></div>' });
  runInOneEval(window, `
    currentUser = null;
    state = { tournamentHistory: [
      { id:'hist1', label:'Summer Cup', date:'2026-07-01', table:[], playerStats:[] },
    ] };
    openProfileEntry('hist1');
  `);
  const html = window.document.getElementById('profile-entry-content').innerHTML;
  assert.ok(html.includes("shareMyTournamentRecap('hist1')"), 'a share button wired to this tournament should be present');
  assert.ok(html.includes('Share recap card'));
});

test('viewArchivedTournamentSnapshot renders a Share button, and shareHostTournamentRecap draws from its snapshot', () => {
  const { window } = freshWindow({ extraHtml: '<div id="recap-modal" style="display:none"><div id="recap-card-content"></div></div>' });
  const r = runInOneEval(window, `
    window.__drawCalls = [];
    window.__shareCalls = [];
    drawTournamentRecapCanvas = function(label, dateStr, table, playerStats, champion, matches){
      window.__drawCalls.push({ label, dateStr, table, playerStats, champion, matches });
      return { fake: 'canvas' };
    };
    shareCanvasAsImage = function(canvas, filename, title, text){
      window.__shareCalls.push({ canvas, filename, title, text });
    };
    lastViewedHostUid = 'hostUid';
    const entry = { label:'Winter Cup', dateStr:'2026-01-10', historyId:'hist2', visibility:'public',
      snapshot: { table:[{name:'Blue',pts:6}], playerStats:[{name:'Sam',goals:2,avg:7.4}],
        champion:'Blue FC', matches:[{teamA:'Blue FC',teamB:'Green FC',scoreA:2,scoreB:0,stage:'Semifinal',scorers:[]}] } };
    viewArchivedTournamentSnapshot(entry);
    window.__results.contentHtml = document.getElementById('recap-card-content').innerHTML;
    shareHostTournamentRecap();
    window.__results.draws = window.__drawCalls;
    window.__results.shares = window.__shareCalls;
  `);
  assert.ok(r.contentHtml.includes('shareHostTournamentRecap()'), 'a Share button should be rendered');
  assert.strictEqual(r.draws.length, 1);
  assert.strictEqual(r.draws[0].label, 'Winter Cup');
  assert.strictEqual(r.draws[0].table[0].name, 'Blue');
  assert.strictEqual(r.draws[0].playerStats[0].name, 'Sam');
  assert.strictEqual(r.draws[0].champion, 'Blue FC', 'the published champion should be passed through to the canvas');
  assert.strictEqual(r.draws[0].matches[0].stage, 'Semifinal', 'the published per-match knockout data should be passed through to the canvas');
  assert.strictEqual(r.shares.length, 1);
  assert.ok(r.shares[0].text.includes('Winter Cup'));
});

test('shareHostTournamentRecap is a safe no-op when nothing (or something snapshot-less) has been viewed', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__drawCalls = [];
    drawTournamentRecapCanvas = function(){ window.__drawCalls.push(1); };
    lastViewedRecapEntry = null;
    shareHostTournamentRecap();
    lastViewedRecapEntry = { label:'No Snapshot Tournament' };
    shareHostTournamentRecap();
    window.__results.draws = window.__drawCalls;
  `);
  assert.strictEqual(r.draws.length, 0, 'nothing should be drawn without a snapshot to draw from');
});

test('fitCanvasText returns text unchanged when it already fits, and truncates with an ellipsis when it does not', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    const fakeCtx = { measureText: (s) => ({ width: s.length * 10 }) };
    window.__results.fits = fitCanvasText(fakeCtx, 'Short', 200);
    window.__results.truncated = fitCanvasText(fakeCtx, 'A Very Long Tournament Name That Overflows', 100);
  `);
  assert.strictEqual(r.fits, 'Short', 'text that already fits should be returned as-is');
  assert.ok(r.truncated.endsWith('…'), 'text that overflows should end with an ellipsis');
  assert.ok(r.truncated.length < 'A Very Long Tournament Name That Overflows'.length, 'the truncated text should be shorter than the original');
});

// tournamentRecapShowTable()/tournamentRecapKoLines() are extracted out of
// drawTournamentRecapCanvas() specifically so this logic can be tested directly -- jsdom has no
// real <canvas> 2D context, so the canvas-drawing function itself can only ever be verified by
// stubbing it out wholesale (the tests above).
test('tournamentRecapShowTable is false for a pure-knockout table (every row at p:0), true once anyone has actually played a league fixture', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.allZero = tournamentRecapShowTable([{name:'Red FC',p:0,pts:0},{name:'Blue FC',p:0,pts:0}]);
    window.__results.empty = tournamentRecapShowTable([]);
    window.__results.played = tournamentRecapShowTable([{name:'Red FC',p:2,pts:6},{name:'Blue FC',p:2,pts:0}]);
  `);
  assert.strictEqual(r.allZero, false, 'an all-zero table (pure knockout tournament) should not be shown on the recap card');
  assert.strictEqual(r.empty, false);
  assert.strictEqual(r.played, true);
});

test('tournamentRecapKoLines keeps only non-League stage results, capped at 5', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.filtered = tournamentRecapKoLines([
      { teamA:'A', teamB:'B', stage:'League' },
      { teamA:'A', teamB:'C', stage:'Semifinal' },
      { teamA:'B', teamB:'C', stage:'Final' },
    ]);
    window.__results.capped = tournamentRecapKoLines(
      Array.from({length:8}, (_, i) => ({ teamA:'A', teamB:'B', stage:'Round'+i }))
    );
    window.__results.empty = tournamentRecapKoLines([]);
    window.__results.missing = tournamentRecapKoLines(undefined);
  `);
  assert.strictEqual(r.filtered.length, 2, 'the League-stage result should be excluded');
  assert.ok(r.filtered.every(m => m.stage !== 'League'));
  assert.strictEqual(r.capped.length, 5, 'the list should be capped at 5 even with more knockout results than that');
  assert.strictEqual(r.empty.length, 0);
  assert.strictEqual(r.missing.length, 0, 'a missing matches array should not throw');
});

// Regression coverage for: a tournament saved to history BEFORE the champion/matches fields
// existed has neither -- without a fallback, its recap card would just never show a champion
// banner again, forever. For a PURE LEAGUE save (no matches array at all -- a hybrid/knockout
// save always gets one, even an old one re-saved after this update) the table leader IS the
// champion by definition, so this can be safely filled in after the fact.
test('tournamentRecapEffectiveChampion fills in the table leader for an old pure-league save with no champion on record, but never guesses for a knockout/hybrid save', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.alreadyKnown = tournamentRecapEffectiveChampion('Red FC', [{name:'Blue FC',p:3,pts:9}], []);
    window.__results.legacyLeague = tournamentRecapEffectiveChampion(null, [{name:'Red FC',p:3,pts:9},{name:'Blue FC',p:3,pts:3}], undefined);
    window.__results.legacyNothingPlayed = tournamentRecapEffectiveChampion(null, [{name:'Red FC',p:0,pts:0}], []);
    window.__results.legacyKnockout = tournamentRecapEffectiveChampion(null, [{name:'Red FC',p:0,pts:0},{name:'Blue FC',p:0,pts:0}], [{stage:'Final',teamA:'Red FC',teamB:'Blue FC'}]);
  `);
  assert.strictEqual(r.alreadyKnown, 'Red FC', 'a real recorded champion should never be overridden');
  assert.strictEqual(r.legacyLeague, 'Red FC', 'the table leader should fill in for an old league-only save');
  assert.strictEqual(r.legacyNothingPlayed, null, 'nothing played yet should still be null, not a false champion');
  assert.strictEqual(r.legacyKnockout, null, 'a save that DOES have knockout match data (even without a recorded champion) should never guess from the table alone');
});
