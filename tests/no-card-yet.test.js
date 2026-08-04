'use strict';
// Tests for hasCardStats()/noCardYetHtml() -- showPlayerCard()/showHostPlayerCard()/
// showVerifiedPlayerCard() used to fall back to calcCardOVR()'s "base 50 + a few points per
// stat" formula for a player with zero real matches recorded anywhere, producing a full,
// real-looking Bronze FIFA card (OVR, PAC/SHO/PAS/DRI/DEF/PHY) off entirely zeroed data --
// indistinguishable at a glance from an actual rated player. This was especially visible on the
// "global" verified card: every real signed-in user gets a verified identity automatically
// (ensureVerifiedIdentity()) just by signing in, whether or not they've ever actually played or
// logged a match, so a fabricated rating could show up for someone with genuinely nothing behind
// it. Now all three card views explicitly show 0 and a "play or log a match" nudge instead.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('showPlayerCard shows an unrated 0 card with a nudge for a player with no career stats at all', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    haptic = function(){};
    state = { results: [], fixtures: [], numTeams: 2, teamNames: ['Red FC','Blue FC'],
      captains: ['',''], players: [], playerDB: [{ name:'Keith', positions:['MID'] }],
      careerSnapshotSaved: true, tournamentHistory: [] };
    showPlayerCard('Keith');
  `);
  const html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('>0<'), 'rating/OVR should show as an explicit 0, not a fabricated number');
  assert.ok(html.includes('Unrated'));
  assert.ok(html.includes('play a tournament') || html.toLowerCase().includes('log one played elsewhere'), 'should nudge toward playing or logging a match');
  assert.ok(html.includes('Log a match'), 'this device\'s own card should offer a direct way to log one');
  assert.ok(!html.includes('fifa-attrs'), 'should not render a fabricated PAC/SHO/PAS/DRI/DEF/PHY breakdown with no real data behind it');
});

test('showPlayerCard still renders a full rated card once the player has at least one real match', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    haptic = function(){};
    state = { results: [], fixtures: [], numTeams: 2, teamNames: ['Red FC','Blue FC'],
      captains: ['',''], players: [], playerDB: [],
      careerSnapshotSaved: true,
      tournamentHistory: [
        { id:'t1', label:'Cup 1', date:'2026-01-01', table:[],
          playerStats:[{name:'Alex',team:'Red FC',position:'FWD',avg:8.2,count:1,goals:2,assists:0,cleanSheets:0}] },
      ] };
    showPlayerCard('Alex');
  `);
  const html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('fifa-attrs'), 'a player with real matches should still get the full rated card');
  assert.ok(!html.includes('Unrated'));
});

test('showVerifiedPlayerCard shows the unrated 0 card for a verified account with zero actual contributions', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUid'] = { uid:'samUid', name:'Keith', nameLower:'keith' };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    window.__testDone = showVerifiedPlayerCard('samUid');
  `);
  await window.__testDone;
  const html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('Keith'));
  assert.ok(html.includes('Unrated'), 'signing in alone (ensureVerifiedIdentity) must not be enough to earn a fabricated rated card');
  assert.ok(!html.includes('fifa-attrs'));
});

test('showVerifiedPlayerCard still renders the full rated card once there is at least one real contribution', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUid'] = { uid:'samUid', name:'Keith', nameLower:'keith' };
  dbStore['verifiedPlayers/samUid/contributions/org_t1'] = {
    tournamentId:'t1', contributingUid:'org',
    playerStats:{ name:'Keith', team:'Red FC', avg:7, count:2, goals:1, assists:1, cleanSheets:0, matchRatings:[7,7] }
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    window.__testDone = showVerifiedPlayerCard('samUid');
  `);
  await window.__testDone;
  const html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('fifa-attrs'));
  assert.ok(!html.includes('Unrated'));
});

test('showHostPlayerCard shows the unrated 0 card for a published player row with zero matches recorded', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    lastPastTournamentsList = [
      { startedAt: 1000, snapshot: { playerStats: [
        { name:'Keith', team:'Red FC', position:'MID', goals:0, assists:0, cleanSheets:0, avg:null, count:0 },
      ] } },
    ];
    showHostPlayerCard('Keith');
  `);
  const html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('Keith'));
  assert.ok(html.includes('Unrated'));
});
