'use strict';
// Tests for logExternalMatchEntry() -- lets someone log a match played somewhere NOT tracked in
// the app (a pickup game, a league that doesn't use Ballrr) as its own tournamentHistory-shaped
// entry, so it counts toward playerCareerAvg()/computeCareerLeaderboard()/computeTrophyCabinet()
// and the player card exactly like an in-app tournament would. state.myExternalName is
// remembered after the first entry so it isn't re-asked every time.
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

test('logExternalMatchEntry creates a tournamentHistory entry from prompt answers, attributed to the remembered name', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${promptRouter({
      'What name': 'Devyanee',
      'Date played': '2026-07-20',
      'Where/what': 'Turf Town 5-a-side',
      'position': 'FWD',
      'Goals': '3',
      'Assists': '1',
      'Rate your own': '8.5',
    })}
    currentUser = { uid:'myUid', displayName:'Devyanee' };
    sharedMeta = null;
    state = { playerDB: [], tournamentHistory: [] };
    logExternalMatchEntry();
    window.__results.entry = state.tournamentHistory[0];
    window.__results.rememberedName = state.myExternalName;
  `);
  const entry = r.entry;
  assert.ok(entry, 'should push a new tournamentHistory entry');
  assert.strictEqual(entry.external, true);
  assert.strictEqual(entry.date, '2026-07-20');
  assert.strictEqual(entry.venue, 'Turf Town 5-a-side');
  assert.ok(entry.label.includes('Turf Town'));
  assert.strictEqual(entry.playerStats.length, 1);
  const p = entry.playerStats[0];
  assert.strictEqual(p.name, 'Devyanee');
  assert.strictEqual(p.position, 'FWD');
  assert.strictEqual(p.goals, 3);
  assert.strictEqual(p.assists, 1);
  assert.strictEqual(p.avg, 8.5);
  assert.strictEqual(p.count, 1);
  assert.strictEqual(r.rememberedName, 'Devyanee');
  assert.deepStrictEqual(entry.table, []);
  assert.deepStrictEqual(entry.teamNames, []);
});

test('logExternalMatchEntry reuses state.myExternalName on later calls instead of asking again', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${promptRouter({
      'Date played': '2026-07-21',
      'Where/what': 'Second match',
      'position': 'MID',
      'Goals': '0',
      'Assists': '0',
      'Rate your own': '6',
    })}
    let namePromptAsked = false;
    const realPrompt = window.prompt;
    window.prompt = (msg, def) => { if(msg.includes('What name')) namePromptAsked = true; return realPrompt(msg, def); };
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    state = { playerDB: [], tournamentHistory: [], myExternalName: 'Devyanee' };
    logExternalMatchEntry();
    window.__results.namePromptAsked = namePromptAsked;
    window.__results.entryName = state.tournamentHistory[0].playerStats[0].name;
  `);
  assert.strictEqual(r.namePromptAsked, false, 'should not re-ask for a name once state.myExternalName is already set');
  assert.strictEqual(r.entryName, 'Devyanee');
});

test('an external match entry counts toward computeCareerLeaderboard and playerCareerAvg like any other saved tournament', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${promptRouter({
      'What name': 'Devyanee',
      'Date played': '2026-07-20',
      'Where/what': 'Turf Town',
      'position': 'FWD',
      'Goals': '3',
      'Assists': '1',
      'Rate your own': '8',
    })}
    currentUser = { uid:'myUid' };
    sharedMeta = null;
    state = { careerSnapshotSaved:true, playerDB: [], tournamentHistory: [] };
    ratingPoolHistory = [];
    logExternalMatchEntry();
    window.__results.avg = playerCareerAvg('Devyanee');
    window.__results.row = computeCareerLeaderboard().find(p => p.name === 'Devyanee');
  `);
  assert.strictEqual(r.avg, 8);
  assert.ok(r.row);
  assert.strictEqual(r.row.goals, 3);
  assert.strictEqual(r.row.assists, 1);
  assert.strictEqual(r.row.tournaments, 1);
});
