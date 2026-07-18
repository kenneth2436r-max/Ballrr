'use strict';
// Regression test for the "shows 5-7 tournaments played when there have only been 4" bug.
// Root cause: playerStats (both archived, in state.tournamentHistory, and live, from
// buildLiveCareerRows()) is keyed by (name, teamId) -- see computeRatingStats()/
// computeGoalsAssistsTally() -- so a player who appeared for more than one team in the SAME
// tournament (a rotational/guest appearance filling in for a short-handed side, which this app
// explicitly supports) produces multiple rows for that one tournament. computeCareerLeaderboard()
// used to increment `tournaments` once per ROW instead of once per PLAYER PER TOURNAMENT, so
// anyone who ever multi-teamed had their count inflated by however many tournaments they'd done
// that in. Fixed by collapsePlayerStatsByName() folding each tournament's rows down to one per
// player before counting anything.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('a player who appeared for two different teams in one archived tournament counts as ONE tournament, with goals/assists/appearances summed across both teams', () => {
  const { window } = freshWindow({});
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true,
      tournamentHistory: [
        { id:'t1', label:'Tournament 1', date:'2026-01-01', playerStats: [
          { name:'Densil', team:'Team A', position:'MID', avg:7, count:3, goals:2, assists:1, cleanSheets:0 },
          { name:'Densil', team:'Team B', position:'MID', avg:6, count:2, goals:1, assists:0, cleanSheets:0 }
        ] },
        { id:'t2', label:'Tournament 2', date:'2026-02-01', playerStats: [
          { name:'Densil', team:'Team A', position:'MID', avg:8, count:4, goals:3, assists:2, cleanSheets:0 }
        ] }
      ]
    };
    window.__results.rows = computeCareerLeaderboard();
  `);
  const densil = r.rows.find(p => p.name === 'Densil');
  assert.ok(densil, 'Densil should appear in the leaderboard');
  assert.strictEqual(densil.tournaments, 2, 'only 2 real tournaments happened -- multi-teaming within t1 must not inflate this to 3');
  assert.strictEqual(densil.goals, 6, 'goals across both teams in t1 (2+1) plus t2 (3) = 6');
  assert.strictEqual(densil.assists, 3, 'assists across both teams in t1 (1+0) plus t2 (2) = 3');
  assert.strictEqual(densil.matches, 9, 'appearances across both teams in t1 (3+2) plus t2 (4) = 9');
});

test('a player who only ever played for one team per tournament is unaffected (no false collapsing across different tournaments)', () => {
  const { window } = freshWindow({});
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true,
      tournamentHistory: [
        { id:'t1', label:'Tournament 1', date:'2026-01-01', playerStats: [
          { name:'Aaryan', team:'Team A', position:'FWD', avg:7, count:3, goals:4, assists:1, cleanSheets:0 }
        ] },
        { id:'t2', label:'Tournament 2', date:'2026-02-01', playerStats: [
          { name:'Aaryan', team:'Team B', position:'FWD', avg:6.5, count:2, goals:1, assists:0, cleanSheets:0 }
        ] }
      ]
    };
    window.__results.rows = computeCareerLeaderboard();
  `);
  const aaryan = r.rows.find(p => p.name === 'Aaryan');
  assert.strictEqual(aaryan.tournaments, 2);
  assert.strictEqual(aaryan.goals, 5);
});

test('the live (not-yet-saved) tournament sums a multi-team player instead of dropping one team\'s stats', () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: false,
      tournamentHistory: [],
      numTeams: 2, legs: 1,
      teamNames: ['Team A', 'Team B'],
      fixtures: [[0,1],[0,1]],
      results: [
        { played:true, g:[2,1], scorers:[{team:0,name:'Densil',goals:2}], assists:[], squad:{}, rotational:{}, posOverrides:{}, ratingOverrides:{}, contributions:{}, formation:'standard' },
        { played:true, g:[1,3], scorers:[{team:1,name:'Densil',goals:1}], assists:[], squad:{}, rotational:{}, posOverrides:{}, ratingOverrides:{}, contributions:{}, formation:'standard' }
      ],
      koRounds: null, customKO:{enabled:false,stages:[]}, page3: undefined,
      players: [], captains: ['',''], playerDB: [], rotationalPool: []
    };
    window.__results.rows = computeCareerLeaderboard();
  `);
  const densil = r.rows.find(p => p.name === 'Densil');
  assert.ok(densil, 'Densil should appear even though he switched teams mid-tournament');
  assert.strictEqual(densil.tournaments, 1);
  assert.strictEqual(densil.goals, 3, 'goals from both teams in the still-live tournament should be summed (2+1)');
});

test('the trophy cabinet credits a multi-team player\'s COMBINED goals for Golden Boot, not just one team\'s', () => {
  const { window } = freshWindow({});
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true,
      tournamentHistory: [
        { id:'t1', label:'Tournament 1', date:'2026-01-01', playerStats: [
          { name:'Densil', team:'Team A', position:'MID', avg:7, count:3, goals:2, assists:0, cleanSheets:0 },
          { name:'Densil', team:'Team B', position:'MID', avg:6, count:2, goals:2, assists:0, cleanSheets:0 },
          { name:'Aaryan', team:'Team C', position:'FWD', avg:7, count:3, goals:3, assists:0, cleanSheets:0 }
        ] }
      ]
    };
    window.__results.cabinet = computeTrophyCabinet();
  `);
  // Densil's combined 4 goals (2+2) should beat Aaryan's 3 for the Golden Boot -- with the old
  // per-row comparison, Densil would only ever be compared at 2 goals per row and lose to Aaryan.
  const densil = r.cabinet.find(p => p.name === 'Densil');
  assert.ok(densil, 'Densil should win an award');
  assert.strictEqual(densil.wins['Golden Boot'], 1);
});
