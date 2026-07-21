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
    drawTournamentRecapCanvas = function(label, dateStr, table, playerStats){
      window.__drawCalls.push({ label, dateStr, table, playerStats });
      return { fake: 'canvas' };
    };
    shareCanvasAsImage = function(canvas, filename, title, text){
      window.__shareCalls.push({ canvas, filename, title, text });
    };
    state = { tournamentHistory: [
      { id:'hist1', label:'Summer Cup', date:'2026-07-01', table:[{name:'Red',pts:9}], playerStats:[{name:'Alex',goals:3,avg:8.1}] },
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
    drawTournamentRecapCanvas = function(label, dateStr, table, playerStats){
      window.__drawCalls.push({ label, dateStr, table, playerStats });
      return { fake: 'canvas' };
    };
    shareCanvasAsImage = function(canvas, filename, title, text){
      window.__shareCalls.push({ canvas, filename, title, text });
    };
    lastViewedHostUid = 'hostUid';
    const entry = { label:'Winter Cup', dateStr:'2026-01-10', historyId:'hist2', visibility:'public',
      snapshot: { table:[{name:'Blue',pts:6}], playerStats:[{name:'Sam',goals:2,avg:7.4}] } };
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
