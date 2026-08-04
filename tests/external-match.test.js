'use strict';
// Tests for logExternalMatchEntry() -- lets someone log a match played somewhere NOT tracked in
// the app (a pickup game, a league that doesn't use Ballrr) as its own tournamentHistory-shaped
// entry, so it counts toward playerCareerAvg()/computeCareerLeaderboard()/computeTrophyCabinet()
// and the player card exactly like an in-app tournament would. state.myExternalName is
// remembered after the first entry so it isn't re-asked every time. The final step resolves the
// current user's OWN host code (via ensureHostCode(), same as any other host-code lookup) so
// external matches are automatically "verified" for the universal player search too -- that
// makes the whole flow asynchronous, hence the flush-inside-one-eval-call pattern below (see
// helpers/harness.js's own comment on why driver code and its result reads must share one eval()).
//
// The rating is no longer typed in by hand -- it's computed by computePlayerMatchRating(), the
// exact same engine every in-app tournament/Quick Match match uses, fed by a scoreline (your
// team's score vs the opponent's) instead of a self-graded number. See computePlayerMatchRating()
// itself for the weighting formula; the expected values below are hand-derived from it so a
// regression in either function's logic would actually be caught here.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function promptRouter(answers){
  return `window.prompt = (msg, def) => {
    ${Object.entries(answers).map(([key, val]) => `if(msg.includes(${JSON.stringify(key)})) return ${JSON.stringify(val)};`).join('\n    ')}
    return def;
  };`;
}

test('logExternalMatchEntry refuses when signed out', () => {
  const { window } = freshWindow();
  window.__alertsSeen = [];
  runInOneEval(window, `
    window.alert = (m) => { window.__alertsSeen.push(m); };
    currentUser = null;
    logExternalMatchEntry();
  `);
  assert.ok(window.__alertsSeen.some(m => m.includes('Sign in')));
});

test('logExternalMatchEntry creates a tournamentHistory entry from prompt answers, with the rating auto-calculated (not typed in)', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    ${promptRouter({
      'What name': 'Devyanee',
      'Date played': '2026-07-20',
      'Where/what': 'Turf Town 5-a-side',
      'position': 'FWD',
      'Minutes': '90',
      'team\'s final score': '4',
      'Opponent\'s final score': '1',
      'Goals': '3',
      'Assists': '1',
    })}
    currentUser = { uid:'myUid', displayName:'Devyanee' };
    sharedMeta = null;
    state = { playerDB: [], tournamentHistory: [] };
    window.__testDone = (async () => {
      logExternalMatchEntry();
      for(let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
      window.__results.entry = state.tournamentHistory[0];
      window.__results.rememberedName = state.myExternalName;
    })();
  `);
  await window.__testDone;
  const entry = r.entry;
  assert.ok(entry, 'should push a new tournamentHistory entry');
  assert.strictEqual(entry.external, true);
  assert.strictEqual(entry.date, '2026-07-20');
  assert.strictEqual(entry.venue, 'Turf Town 5-a-side');
  assert.strictEqual(entry.minutesPlayed, 90);
  assert.ok(entry.label.includes('Turf Town'));
  assert.strictEqual(entry.playerStats.length, 1);
  const p = entry.playerStats[0];
  assert.strictEqual(p.name, 'Devyanee');
  assert.strictEqual(p.position, 'FWD');
  assert.strictEqual(p.goals, 3);
  assert.strictEqual(p.assists, 1);
  // FWD, 3 goals (0.6 each), 1 assist (0.5), win (+0.3), no clean sheet (opponent scored) --
  // 6.8 + 1.8 + 0.5 + 0.3 = 9.4. Matches computePlayerMatchRating(FWD,3,1,false,1,'win',null).
  assert.strictEqual(p.avg, 9.4, 'rating must be auto-calculated by computePlayerMatchRating, not asked for as a raw number');
  assert.strictEqual(p.cleanSheets, 0, 'opponent scored, so no clean sheet');
  assert.strictEqual(p.count, 1);
  assert.strictEqual(r.rememberedName, 'Devyanee');
  // Array.from(): jsdom's Array constructor differs from this test file's own realm, so
  // assert.deepStrictEqual fails on an otherwise-identical array unless normalized first.
  assert.deepStrictEqual(Array.from(entry.table), []);
  assert.deepStrictEqual(Array.from(entry.teamNames), []);
  assert.ok(p.code, 'should self-attribute its own resolved host code, so it is automatically verified');
});

test('logExternalMatchEntry credits a clean sheet when the opponent did not score, and reuses state.myExternalName without re-asking', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    ${promptRouter({
      'Date played': '2026-07-21',
      'Where/what': 'Second match',
      'position': 'MID',
      'Minutes': '90',
      'team\'s final score': '2',
      'Opponent\'s final score': '0',
      'Goals': '0',
      'Assists': '0',
    })}
    let namePromptAsked = false;
    const realPrompt = window.prompt;
    window.prompt = (msg, def) => { if(msg.includes('What name')) namePromptAsked = true; return realPrompt(msg, def); };
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    state = { playerDB: [], tournamentHistory: [], myExternalName: 'Devyanee' };
    window.__testDone = (async () => {
      logExternalMatchEntry();
      for(let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
      window.__results.namePromptAsked = namePromptAsked;
      window.__results.entry = state.tournamentHistory[0];
    })();
  `);
  await window.__testDone;
  assert.strictEqual(r.namePromptAsked, false, 'should not re-ask for a name once state.myExternalName is already set');
  const p = r.entry.playerStats[0];
  assert.strictEqual(p.name, 'Devyanee');
  assert.strictEqual(p.cleanSheets, 1, 'opponent scored 0, so this should count as a clean sheet');
  // MID, 0 goals/assists, win (+0.3, not halved -- halving only applies to GK/DEF), clean sheet
  // bonus for MID (+0.2) -- 6.8 + 0.2 + 0.3 = 7.3.
  assert.strictEqual(p.avg, 7.3, 'rating must reflect the clean-sheet bonus and result, computed the same way an in-app match would be');
});

test('an external match entry counts toward computeCareerLeaderboard and playerCareerAvg like any other saved tournament, using the auto-calculated rating', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    ${promptRouter({
      'What name': 'Devyanee',
      'Date played': '2026-07-20',
      'Where/what': 'Turf Town',
      'position': 'FWD',
      'Minutes': '90',
      'team\'s final score': '4',
      'Opponent\'s final score': '1',
      'Goals': '3',
      'Assists': '1',
    })}
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    state = { careerSnapshotSaved:true, results:[], playerDB: [], tournamentHistory: [] };
    ratingPoolHistory = [];
    window.__testDone = (async () => {
      logExternalMatchEntry();
      for(let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 0));
      window.__results.avg = playerCareerAvg('Devyanee');
      window.__results.row = computeCareerLeaderboard().find(p => p.name === 'Devyanee');
    })();
  `);
  await window.__testDone;
  assert.strictEqual(r.avg, 9.4);
  assert.ok(r.row);
  assert.strictEqual(r.row.goals, 3);
  assert.strictEqual(r.row.assists, 1);
  assert.strictEqual(r.row.tournaments, 1);
});
