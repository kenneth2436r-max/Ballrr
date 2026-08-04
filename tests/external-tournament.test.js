'use strict';
// Tests for logExternalTournamentEntry() -- logs a whole tournament/mini-league played somewhere
// NOT tracked in the app (a five-a-side league, a corporate cup) as ONE tournamentHistory entry
// covering every match played in it, looping the same per-match questions
// logExternalMatchEntry() asks (see external-match.test.js) across N matches and rolling them up
// into a single aggregated player row -- goals/assists summed, rating averaged, count = N matches
// -- so it counts as ONE tournament (isTournament:true) rather than N separate matches each
// individually inflating a player's tournaments-played count. Position is asked once for the
// whole event, everything else (minutes/score/goals/assists/contrib stats) is asked per match.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function promptRouter(answers){
  return `window.prompt = (msg, def) => {
    ${Object.entries(answers).map(([key, val]) => `if(msg.includes(${JSON.stringify(key)})) return ${JSON.stringify(val)};`).join('\n    ')}
    return def;
  };`;
}

test('logExternalTournamentEntry refuses when signed out', () => {
  const { window } = freshWindow();
  window.__alertsSeen = [];
  runInOneEval(window, `
    window.alert = (m) => { window.__alertsSeen.push(m); };
    currentUser = null;
    logExternalTournamentEntry();
  `);
  assert.ok(window.__alertsSeen.some(m => m.includes('Sign in')));
});

test('logExternalTournamentEntry aggregates multiple matches into one tournamentHistory entry, marked isTournament:true', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    ${promptRouter({
      'What name': 'Devyanee',
      'What was this tournament': 'Weekend 5-a-side League',
      'Date it took place': '2026-08-01',
      'Your position for this tournament': 'FWD',
      'How many matches': '2',
      "Match 1 of 2 -- Minutes": '90',
      "Match 1 of 2 -- Your team's final score": '2',
      "Match 1 of 2 -- Opponent's final score": '1',
      'Match 1 of 2 -- Goals': '1',
      'Match 1 of 2 -- Assists': '0',
      "Match 2 of 2 -- Minutes": '90',
      "Match 2 of 2 -- Your team's final score": '1',
      "Match 2 of 2 -- Opponent's final score": '1',
      'Match 2 of 2 -- Goals': '0',
      'Match 2 of 2 -- Assists': '1',
    })}
    currentUser = { uid:'myUid', displayName:'Devyanee' };
    sharedMeta = null;
    state = { playerDB: [], tournamentHistory: [], results: [] };
    window.__testDone = (async () => {
      logExternalTournamentEntry();
      for(let i = 0; i < 30; i++) await new Promise(res => setTimeout(res, 0));
      window.__results.entry = state.tournamentHistory[0];
    })();
  `);
  await window.__testDone;
  const entry = r.entry;
  assert.ok(entry, 'should push a new tournamentHistory entry');
  assert.strictEqual(entry.external, true);
  assert.strictEqual(entry.date, '2026-08-01');
  assert.ok(entry.label.includes('Weekend 5-a-side League'));
  assert.strictEqual(entry.isTournament, true, 'two matches logged through this flow must count as a genuine tournament');
  assert.strictEqual(entry.playerStats.length, 1);
  const p = entry.playerStats[0];
  assert.strictEqual(p.name, 'Devyanee');
  assert.strictEqual(p.position, 'FWD');
  assert.strictEqual(p.count, 2, 'count must reflect the 2 matches played, feeding the matches-played stat');
  assert.strictEqual(p.goals, 1, 'goals must be summed across both matches');
  assert.strictEqual(p.assists, 1, 'assists must be summed across both matches');
  // Match 1: FWD, 1 goal (0.6), win (+0.3, not halved -- FWD always uses the full swing) --
  // 6.8+0.6+0.3=7.7. Match 2: FWD, 1 assist (0.5), draw (+0) -- 6.8+0.5=7.3. Average = 7.5.
  assert.strictEqual(p.avg, 7.5, 'rating must be the average of each match\'s own auto-calculated rating');
  assert.strictEqual(p.matchRatings.length, 2);
  // Array.from(): jsdom's Array constructor differs from this test file's own realm, so
  // assert.deepStrictEqual fails on an otherwise-identical array unless normalized first (see
  // helpers/harness.js's own comment on this).
  assert.deepStrictEqual(Array.from(p.matchRatings), [7.7, 7.3]);
  assert.ok(p.code, 'should self-attribute its own resolved host code, so it is automatically verified');
});

test('logExternalTournamentEntry marks isTournament:false when only a single match is logged through this flow', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    ${promptRouter({
      'What name': 'Densil',
      'What was this tournament': 'One-off Cup',
      'Date it took place': '2026-08-01',
      'Your position for this tournament': 'MID',
      'How many matches': '1',
      "Match 1 of 1 -- Minutes": '90',
      "Match 1 of 1 -- Your team's final score": '1',
      "Match 1 of 1 -- Opponent's final score": '0',
      'Match 1 of 1 -- Goals': '0',
      'Match 1 of 1 -- Assists': '0',
    })}
    currentUser = { uid:'myUid', displayName:'Densil' };
    sharedMeta = null;
    state = { playerDB: [], tournamentHistory: [], results: [] };
    window.__testDone = (async () => {
      logExternalTournamentEntry();
      for(let i = 0; i < 30; i++) await new Promise(res => setTimeout(res, 0));
      window.__results.entry = state.tournamentHistory[0];
    })();
  `);
  await window.__testDone;
  assert.strictEqual(r.entry.isTournament, false, 'a single match logged this way should behave like Log External Match, not inflate the tournaments-played count');
  assert.strictEqual(r.entry.playerStats[0].count, 1);
});

test('an external tournament entry counts as exactly one tournament (not per-match) in computeCareerLeaderboard, while still adding all its matches', async () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true,
      results: [],
      playerDB: [],
      tournamentHistory: [{
        id: 'ext1', date: '2026-08-01', label: '🏆 Weekend League', external: true,
        isTournament: true,
        playerStats: [{ name:'Devyanee', team:null, position:'FWD', avg:7.5, count:3, goals:2, assists:1, cleanSheets:0, matchRatings:[7.7,7.3,7.5] }]
      }]
    };
    window.__results.row = computeCareerLeaderboard().find(p => p.name === 'Devyanee');
  `);
  const row = r.row;
  assert.ok(row, 'Devyanee should appear in the career leaderboard');
  assert.strictEqual(row.tournaments, 1, 'a single external-tournament entry must count as exactly 1 tournament, regardless of how many matches it bundles');
  assert.strictEqual(row.matches, 3, 'match count must still reflect all 3 matches bundled inside it');
});

test('a single logged match (external or a one-match Quick Match save) never counts toward tournaments played, only matches played', async () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true,
      results: [],
      playerDB: [],
      tournamentHistory: [
        { id:'ext1', date:'2026-08-01', label:'📍 Single match', external:true, isTournament:false,
          playerStats:[{ name:'Ayush', team:null, position:'MID', avg:7, count:1, goals:0, assists:0, cleanSheets:0, matchRatings:[7] }] },
        { id:'qm1', date:'2026-08-02', label:'Team A vs Team B', matches:[{stage:'League'}],
          playerStats:[{ name:'Ayush', team:'Team A', position:'MID', avg:6.8, count:1, goals:0, assists:0, cleanSheets:0, matchRatings:[6.8] }] }
      ]
    };
    window.__results.row = computeCareerLeaderboard().find(p => p.name === 'Ayush');
  `);
  const row = r.row;
  assert.ok(row);
  assert.strictEqual(row.tournaments, 0, 'two separate single-match saves must not count as 2 tournaments');
  assert.strictEqual(row.matches, 2, 'both matches should still count toward matches played');
});
