'use strict';
// Tests for the Phase 3 "Live Now" hub tab: a dedicated place to see every currently-live league
// match (timer running) in one list, plus this device's own "live for followers" status and a
// followed host's live notice, without having to scan the Matches tab for LIVE badges. Also
// verifies the tab is actually wired up (nav button, section container, TAB_LABELS entry, and
// included in renderAll()'s render steps) -- easy things to silently forget when adding a tab.
const fs = require('fs');
const path = require('path');
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
    ]
  }, overrides || {});
}

test('collectMyLiveLeagueMatches only returns matches whose timer is currently running, and is empty for a knockout-format tournament', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    window.__results.noneRunning = collectMyLiveLeagueMatches();
    state.results[1].timer = { running: true, accumulatedMs: 90000, startedAt: null };
    window.__results.oneRunning = collectMyLiveLeagueMatches().map(m => m.mi);
    state.formatType = 'knockout';
    window.__results.knockoutSkipped = collectMyLiveLeagueMatches();
  `);
  assert.deepStrictEqual(Array.from(r.noneRunning), []);
  assert.deepStrictEqual(Array.from(r.oneRunning), [1]);
  assert.deepStrictEqual(Array.from(r.knockoutSkipped), [], 'knockout-format tournaments are out of scope for this hub (their live matches still get their own badge on the Matches tab)');
});

test('renderLiveNow shows an empty-state message when nothing is live, and a live match card (with score + LIVE badge) when something is', () => {
  const { window } = freshWindow({ extraHtml: '<div id="live-now-container"></div>' });
  const r = runInOneEval(window, `
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    myLiveAnnounced = false; myLatestCode = null; hostFollowNotice = null;
    renderLiveNow();
    window.__results.emptyHtml = document.getElementById('live-now-container').innerHTML;

    state.results[0].timer = { running: true, accumulatedMs: 125000, startedAt: null };
    state.results[0].scorers = [{ team: 0, name: 'Keith', goals: 2 }];
    renderLiveNow();
    window.__results.liveHtml = document.getElementById('live-now-container').innerHTML;
  `);
  assert.ok(/no matches live right now/i.test(r.emptyHtml));
  assert.ok(r.liveHtml.includes('live-badge') && r.liveHtml.includes('🔴 LIVE'));
  assert.ok(r.liveHtml.includes('Red FC') && r.liveHtml.includes('Blue FC'));
  assert.ok(r.liveHtml.includes('>2<'), 'the live score (2 goals for Red FC) should show on the card');
  assert.ok(/scrollToMatchCard\(0\)/.test(r.liveHtml), 'tapping the card should jump straight to that match on the Matches tab');
});

test('renderLiveNow shows the "you\'re live" banner when this device announced itself live, and the followed-host notice when one is pending', () => {
  const { window } = freshWindow({ extraHtml: '<div id="live-now-container"></div>' });
  const r = runInOneEval(window, `
    teamLabel = function(id){ return state.teamNames[id]; };
    state = ${JSON.stringify(baseState())};
    myLiveAnnounced = true; myLatestCode = 'ABCD'; myLatestLabel = 'Friday 5-a-side'; myLatestVisibility = 'public';
    hostFollowNotice = { code: 'WXYZ', visibility: 'private', hostName: 'Aaryan' };
    renderLiveNow();
    window.__results.html = document.getElementById('live-now-container').innerHTML;
  `);
  assert.ok(r.html.includes("You're live"));
  assert.ok(r.html.includes('Friday 5-a-side'));
  assert.ok(r.html.includes('Aaryan') && r.html.includes('just went live'));
  assert.ok(/onclick="openFollowedHostNotice\(\)"/.test(r.html), 'the followed-host notice should route through the existing openFollowedHostNotice() action, not a dead link');
});

test('the Live Now tab is actually wired up: nav button, section container, TAB_LABELS entry, and included in renderAll()\'s render steps', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(/<button class="tab" onclick="showTab\('livenow',this\)">/.test(html), 'missing the sidebar nav button for the Live tab');
  assert.ok(/<div id="tab-livenow" class="section">/.test(html), 'missing the section container showTab(\'livenow\') switches to');
  assert.ok(/id="live-now-container"/.test(html), 'missing the inner container renderLiveNow() writes into');
  assert.ok(/TAB_LABELS\s*=\s*\{[^}]*livenow:/.test(html), 'missing a TAB_LABELS entry -- without it the header pill would show the raw tab id instead of a real label');
  const stepsLine = html.match(/const steps=\[[^\]]*\];/);
  assert.ok(stepsLine, 'could not find renderAll()\'s steps array');
  assert.ok(stepsLine[0].includes('renderLiveNow'), 'renderLiveNow must be included in renderAll()\'s steps, or the tab would only ever show stale/empty content');
});
