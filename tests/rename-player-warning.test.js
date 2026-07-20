'use strict';
// Regression test for: "what if 2 players have the same name and somehow the stats got mixed
// up... what about the past tournaments?". renamePlayerEverywhere() matches purely by name
// string (there's no separate unique player ID anywhere), so renaming one of two same-named
// people retags EVERY matching entry across every archived tournament too -- including ones that
// actually belonged to the other person. That risk can't be detected from the data itself, so
// renamePlayerFromCard() (the only UI entry point for this) now requires an explicit confirm
// that warns about it before the prompt for the new name even appears.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(extra){
  return Object.assign({
    results: [], page3: null, koRounds: null, koThird: null, customResults: [],
    playerDB: [{ name: 'Rahul', positions: ['MID'] }],
    players: [{ name: 'Rahul', team: 0 }],
    playerPool: [], rotationalPool: [], captains: [''], goalkeepers: [''],
    tournamentHistory: [
      { id: 't1', playerStats: [{ name: 'Rahul', team: 'A', goals: 3, assists: 1 }], synergy: [] },
    ],
  }, extra);
}

test('renamePlayerFromCard asks for confirmation before renaming, warning about the shared-name risk', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    haptic=function(){};saveState=function(){};renderAll=function(){};closePlayerCard=function(){};
    let capturedMessage = null;
    window.confirm = (msg) => { capturedMessage = msg; return true; };
    window.prompt = (msg, def) => def;
    state = ${JSON.stringify(baseState())};
    renamePlayerFromCard('Rahul');
    window.__results.capturedMessage = capturedMessage;
  `);
  assert.ok(r.capturedMessage.includes('different people'), 'the confirm must warn about two different people sharing a name');
  assert.ok(r.capturedMessage.includes('archived tournament'), 'the confirm must mention that archived tournaments are affected too');
});

test('declining the confirm cancels the rename entirely -- no prompt, no data changed', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    haptic=function(){};saveState=function(){};renderAll=function(){};closePlayerCard=function(){};
    let promptCalled = false;
    window.confirm = () => false;
    window.prompt = (msg, def) => { promptCalled = true; return def; };
    state = ${JSON.stringify(baseState())};
    renamePlayerFromCard('Rahul');
    window.__results.promptCalled = promptCalled;
    window.__results.playerName = state.players[0].name;
    window.__results.archivedName = state.tournamentHistory[0].playerStats[0].name;
  `);
  assert.strictEqual(r.promptCalled, false, 'must never even ask for the new name if the warning is declined');
  assert.strictEqual(r.playerName, 'Rahul');
  assert.strictEqual(r.archivedName, 'Rahul');
});

test('confirming proceeds to rename everywhere, including archived tournaments, exactly as before', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    haptic=function(){};saveState=function(){};renderAll=function(){};closePlayerCard=function(){};
    window.confirm = () => true;
    window.prompt = () => 'Rahul K';
    state = ${JSON.stringify(baseState())};
    renamePlayerFromCard('Rahul');
    window.__results.playerName = state.players[0].name;
    window.__results.dbName = state.playerDB[0].name;
    window.__results.archivedName = state.tournamentHistory[0].playerStats[0].name;
  `);
  assert.strictEqual(r.playerName, 'Rahul K');
  assert.strictEqual(r.dbName, 'Rahul K');
  assert.strictEqual(r.archivedName, 'Rahul K', 'confirming should still rename past archived tournaments too -- this is expected, just no longer silent');
});
