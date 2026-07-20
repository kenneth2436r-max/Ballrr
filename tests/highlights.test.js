'use strict';
// Tests for Instagram-Highlights-style pinning (highlightsStripHtml()/toggleTournamentHighlight())
// -- a purely additive display flag on a saved tournament, shown as a circular strip above the
// Profile tab's grid (and synced best-effort to the published copy so followers see it too).
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('highlightsStripHtml renders nothing when no tournament is starred', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.html = highlightsStripHtml([
      { id:'t1', label:'Summer Cup' },
      { id:'t2', label:'Winter Cup' },
    ], t => "openProfileEntry('" + t.id + "')");
  `);
  assert.strictEqual(r.html, '');
});

test('highlightsStripHtml renders only the starred tournaments, using the given tap-target builder', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.html = highlightsStripHtml([
      { id:'t1', label:'Summer Cup', highlighted:true },
      { id:'t2', label:'Winter Cup' },
    ], t => "openProfileEntry('" + t.id + "')");
  `);
  assert.ok(r.html.includes('Summer Cup'), 'the starred tournament should appear');
  assert.ok(!r.html.includes('Winter Cup'), 'a non-starred tournament should not appear in the strip');
  assert.ok(r.html.includes("openProfileEntry('t1')"), 'the tap target should come from the passed-in builder');
});

test('toggleTournamentHighlight flips the local flag and syncs it onto an already-published copy', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    pastTournaments: [
      { code: 'CODE1', historyId: 'hist1', label: 'Summer Cup', highlighted: false, snapshot: { table: [], playerStats: [] } },
    ],
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="profile-entry-modal" style="display:none"><div id="profile-entry-content"></div></div><div id="profile-grid-container"></div><div id="profile-highlights-strip"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [ { id:'hist1', label:'Summer Cup', date:'2026-07-01', table:[], playerStats:[] } ] };
    window.__toggleDone = toggleTournamentHighlight('hist1');
  `);
  await window.__toggleDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.strictEqual(dbStore['hostProfiles/hostUid'].pastTournaments[0].highlighted, true, 'the published copy should pick up the same highlight flag');

  const stripHtml = window.document.getElementById('profile-highlights-strip').innerHTML;
  assert.ok(stripHtml.includes('Summer Cup'), 'the Profile tab\'s highlights strip should re-render immediately with the newly-starred tournament');
});
