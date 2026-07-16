'use strict';
// Rotational player tests: a reserve/bench player, or a player borrowed from another team's
// roster, can cover a specific match for a team that's short on players -- without ever
// permanently joining that team's roster, and without being borrowable from the team it's
// currently facing as an opponent (per the clarified spec this feature was built against).
//
// Two harness gotchas worth flagging for future edits to this file:
// 1. addRotationalToMatch/removeRotationalFromMatch/toggleSquadPlayer call the REAL
//    renderMatches()/renderKnockout() at the end (kind==='league' vs everything else). Those
//    render a full match card and need a much fuller state (fixtures, teamNames, numTeams,
//    etc.) than these tests set up, so every driver stubs them out first -- same pattern the
//    shared harness already uses for startApp/renderAll/etc., just scoped to this file since
//    other test files may care about the real render behavior.
// 2. Arrays built INSIDE window.eval() belong to jsdom's own realm, not this file's. Node's
//    assert.deepStrictEqual does a strict prototype/tag check that fails across realms even
//    when the contents are identical (a known Node+vm/jsdom gotcha) -- wrapping with
//    Array.from(...) rehomes the array into this file's realm before comparing.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

const STUB_RENDER = `renderMatches=function(){};renderKnockout=function(){};`;

test('rotationalCandidates excludes own team and today\'s opponent, includes bench + neutral teams', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['','',''],
      players:[{name:'Amit',team:0},{name:'Ben',team:0},{name:'Cal',team:1},{name:'Dev',team:1},{name:'Eli',team:2}],
      rotationalPool:['Fin'],
    };
    window.__results.cands = rotationalCandidates(0,1).sort();
  `);
  assert.deepStrictEqual(Array.from(r.cands), ['Eli','Fin']);
});

test('borrowing a rotational player never touches state.players (never permanent)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['',''],
      players:[{name:'Amit',team:0},{name:'Cal',team:1}],
      rotationalPool:['Fin'],
      results:[{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Fin');
    window.__results.rot = state.results[0].rotational[0];
    window.__results.playersHasFin = state.players.some(p=>p.name==='Fin');
  `);
  assert.deepStrictEqual(Array.from(r.rot), ['Fin']);
  assert.strictEqual(r.playersHasFin, false);
});

test('cannot borrow a player from the team being played against this match', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['',''],
      players:[{name:'Amit',team:0},{name:'Cal',team:1}],
      rotationalPool:[],
      results:[{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Cal');
    window.__results.rot = state.results[0].rotational[0]||[];
    window.__results.alerts = window.__alerts.slice();
  `);
  assert.strictEqual(Array.from(r.rot).includes('Cal'), false);
  assert.ok(r.alerts.length === 1 && /facing/.test(r.alerts[0]));
});

test('CAN borrow a player from a neutral team (not the opponent, not your own)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['','',''],
      players:[{name:'Amit',team:0},{name:'Cal',team:1},{name:'Eli',team:2}],
      rotationalPool:[],
      results:[{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Eli');
    window.__results.rot = state.results[0].rotational[0];
  `);
  assert.deepStrictEqual(Array.from(r.rot), ['Eli']);
});

test('cannot borrow someone already permanently on your own roster', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['',''],
      players:[{name:'Amit',team:0},{name:'Cal',team:1}],
      rotationalPool:[],
      results:[{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Amit');
    window.__results.rot = state.results[0].rotational[0]||[];
    window.__results.alerts = window.__alerts.slice();
  `);
  assert.strictEqual(Array.from(r.rot).includes('Amit'), false);
  assert.ok(r.alerts.length === 1 && /already permanently/.test(r.alerts[0]));
});

test('getMatchSquad automatically folds rotational players in (feeds ratings/stats for free)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['',''],
      players:[{name:'Amit',team:0},{name:'Ben',team:0},{name:'Cal',team:1}],
      rotationalPool:['Fin'],
      results:[{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Fin');
    window.__results.squad = getMatchSquad(state.results[0],0);
  `);
  const squad = Array.from(r.squad);
  assert.ok(squad.includes('Amit') && squad.includes('Ben') && squad.includes('Fin'));
});

test('toggling an unrelated squad chip must not bake the rotational name into matchObj.squad, and removal still fully works', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['',''],
      players:[{name:'Amit',team:0},{name:'Cal',team:1}],
      rotationalPool:['Fin'],
      results:[{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Fin');
    toggleSquadPlayer('league','0',0,'Amit');
    window.__results.squadHasFinAfterToggle = (state.results[0].squad[0]||[]).includes('Fin');
    removeRotationalFromMatch('league','0',0,'Fin');
    window.__results.squadAfterRemoval = getMatchSquad(state.results[0],0);
  `);
  assert.strictEqual(r.squadHasFinAfterToggle, false);
  assert.strictEqual(Array.from(r.squadAfterRemoval).includes('Fin'), false);
});

test('the same bench player can be borrowed again for a different match/team -- borrowing never consumes the bench', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['','',''],
      players:[{name:'Amit',team:0},{name:'Cal',team:1},{name:'Eli',team:2}],
      rotationalPool:['Fin'],
      results:[{squad:{},rotational:{}},{squad:{},rotational:{}}],
    };
    addRotationalToMatch('league','0',0,1,'Fin');
    addRotationalToMatch('league','1',2,0,'Fin');
    window.__results.match0 = state.results[0].rotational[0];
    window.__results.match1 = state.results[1].rotational[2];
    window.__results.stillOnBench = state.rotationalPool.includes('Fin');
  `);
  assert.deepStrictEqual(Array.from(r.match0), ['Fin']);
  assert.deepStrictEqual(Array.from(r.match1), ['Fin']);
  assert.strictEqual(r.stillOnBench, true);
});

test('renamePlayerEverywhere updates rotationalPool and any matchObj.rotational entries', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    ${STUB_RENDER}
    state = {
      captains:['',''],goalkeepers:['',''],
      players:[{name:'Amit',team:0}],
      playerPool:[],
      rotationalPool:['Fin'],
      results:[{scorers:[],assists:[],ratings:[],squad:{},rotational:{0:['Fin']},posOverrides:{},ratingOverrides:{},contributions:{}}],
      page3:null,koRounds:null,koThird:null,customResults:[],
      playerDB:[],tournamentHistory:[],
    };
    renamePlayerEverywhere('Fin','Finley');
    window.__results.pool = state.rotationalPool;
    window.__results.matchRot = state.results[0].rotational[0];
  `);
  assert.deepStrictEqual(Array.from(r.pool), ['Finley']);
  assert.deepStrictEqual(Array.from(r.matchRot), ['Finley']);
});
