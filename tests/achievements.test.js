'use strict';
// Tests for career milestone achievement badges (achievementBadgeDefs()/
// computePlayerAchievements()/computeHostPlayerAchievements()) -- distinct from
// computeCareerArchetypes() (single "best right now" player per category) and
// computeTrophyCabinet() (per-tournament awards): these are permanent, threshold-based badges
// any number of players can hold at once, built from the same aggregate rows
// computeCareerLeaderboard()/computeHostCareerLeaderboard() already produce.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('achievementBadgeDefs returns nothing for a player with no career row', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.badges = achievementBadgeDefs(null, 0);
  `);
  assert.deepStrictEqual(r.badges.length, 0);
});

test('achievementBadgeDefs awards thresholds correctly at each tier, and not below them', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.rookie = achievementBadgeDefs({ goals:0, assists:0, cleanSheets:0, tournaments:1, matches:1, avg:null }, 0);
    window.__results.scorer = achievementBadgeDefs({ goals:1, assists:0, cleanSheets:0, tournaments:1, matches:1, avg:null }, 0);
    window.__results.goldenBoot = achievementBadgeDefs({ goals:10, assists:0, cleanSheets:0, tournaments:1, matches:1, avg:null }, 0);
    window.__results.goalMachine = achievementBadgeDefs({ goals:25, assists:0, cleanSheets:0, tournaments:1, matches:1, avg:null }, 0);
    window.__results.veteran = achievementBadgeDefs({ goals:0, assists:0, cleanSheets:0, tournaments:15, matches:1, avg:null }, 0);
    window.__results.trophyWinner = achievementBadgeDefs({ goals:0, assists:0, cleanSheets:0, tournaments:1, matches:1, avg:null }, 1);
    window.__results.serialWinner = achievementBadgeDefs({ goals:0, assists:0, cleanSheets:0, tournaments:1, matches:1, avg:null }, 5);
  `);
  assert.strictEqual(r.rookie.length, 0, 'a player with nothing on the board yet should have no badges');
  assert.ok(r.scorer.some(b => b.label === 'On the Scoresheet'));
  assert.ok(!r.scorer.some(b => b.label === 'Golden Boot Contender'), '1 goal should not yet earn the 10-goal badge');
  assert.ok(r.goldenBoot.some(b => b.label === 'Golden Boot Contender'));
  assert.ok(!r.goldenBoot.some(b => b.label === 'Goal Machine'), '10 goals should not yet earn the 25-goal badge');
  assert.ok(r.goalMachine.some(b => b.label === 'Goal Machine'));
  assert.ok(r.veteran.some(b => b.label === 'Veteran'));
  assert.ok(r.trophyWinner.some(b => b.label === 'Trophy Winner'));
  assert.ok(!r.trophyWinner.some(b => b.label === 'Serial Winner'), '1 award should not yet earn the 5-award badge');
  assert.ok(r.serialWinner.some(b => b.label === 'Serial Winner'));
});

test('computePlayerAchievements pulls from this device\'s own career leaderboard + trophy cabinet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { careerSnapshotSaved: true, tournamentHistory: [
      { id:'t1', label:'Cup 1', date:'2026-01-01', table:[{name:'Red FC',p:1,w:1,d:0,l:0,gf:12,ga:2,gd:10,pts:3}],
        playerStats:[{name:'Alex',team:'Red FC',position:'FWD',avg:8.2,count:1,matches:1,goals:12,assists:0,cleanSheets:0}] },
    ] };
    currentUser = null;
    window.__results.badges = computePlayerAchievements('Alex');
    window.__results.none = computePlayerAchievements('Nobody');
  `);
  assert.ok(r.badges.some(b => b.label === 'Golden Boot Contender'), '12 career goals should cross the 10-goal threshold');
  assert.strictEqual(r.none.length, 0, 'an unknown player should get no badges');
});

test('computeHostPlayerAchievements mirrors the same thresholds using a host\'s published pastTournaments', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    const list = [
      { code:'C1', historyId:'h1', label:'Cup 1', startedAt:1000,
        snapshot: { table:[], playerStats:[{name:'Priya',team:'Blue FC',position:'MID',avg:7.9,count:5,matches:5,goals:2,assists:16,cleanSheets:0}] } },
    ];
    window.__results.badges = computeHostPlayerAchievements(list, 'Priya');
  `);
  assert.ok(r.badges.some(b => b.label === 'Chief Creator'), '16 career assists should cross the 15-assist threshold');
});

test('showPlayerCard renders achievement pills for a qualifying player', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    state = {
      results: [], fixtures: [], numTeams: 2, teamNames: ['Red FC','Blue FC'],
      captains: ['',''], players: [], playerDB: [],
      careerSnapshotSaved: true,
      tournamentHistory: [
        { id:'t1', label:'Cup 1', date:'2026-01-01', table:[],
          playerStats:[{name:'Alex',team:'Red FC',position:'FWD',avg:8.2,count:1,matches:1,goals:12,assists:0,cleanSheets:0}] },
      ],
    };
    currentUser = null;
    showPlayerCard('Alex');
  `);
  const html = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(html.includes('pc-achievement-pill'), 'a qualifying achievement badge should render on the card');
  assert.ok(html.includes('Golden Boot Contender'));
});
