'use strict';
// "I already have my teams" flow: pasting a whole roster into a team's Draft Board card should
// add every line as a player on that team in one go, skipping blank lines/whitespace, and
// de-duping against the pre-draft pool exactly like the single-name add already does.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('bulkAddPlayersToTeamUI adds every non-blank line to the team and clears the textarea', () => {
  const { window } = freshWindow({ extraHtml: `<textarea id="team-bulk-0">Amit\nBen\n\n  Cal  \n</textarea>` });
  const r = runInOneEval(window, `
    renderAll=function(){};
    state = { players:[{name:'Existing',team:0}], playerPool:['Ben'] };
    bulkAddPlayersToTeamUI(0);
    window.__results.names = state.players.map(p=>p.name);
    window.__results.pool = state.playerPool;
    window.__results.textareaCleared = document.getElementById('team-bulk-0').value === '';
  `);
  assert.deepStrictEqual(Array.from(r.names), ['Existing','Amit','Ben','Cal']);
  assert.deepStrictEqual(Array.from(r.pool), [], 'Ben must be removed from the pre-draft pool once added to a team');
  assert.strictEqual(r.textareaCleared, true);
});

test('bulkAddPlayersToTeamUI does nothing for an empty/whitespace-only textarea', () => {
  const { window } = freshWindow({ extraHtml: `<textarea id="team-bulk-0">   \n\n  </textarea>` });
  const r = runInOneEval(window, `
    renderAll=function(){};
    state = { players:[{name:'Existing',team:0}], playerPool:[] };
    bulkAddPlayersToTeamUI(0);
    window.__results.names = state.players.map(p=>p.name);
  `);
  assert.deepStrictEqual(Array.from(r.names), ['Existing']);
});

test('bulkAddPlayersToTeamUI never adds the same name twice to the same team', () => {
  const { window } = freshWindow({ extraHtml: `<textarea id="team-bulk-0">Amit\nAmit</textarea>` });
  const r = runInOneEval(window, `
    renderAll=function(){};
    state = { players:[], playerPool:[] };
    bulkAddPlayersToTeamUI(0);
    window.__results.names = state.players.map(p=>p.name);
  `);
  assert.deepStrictEqual(Array.from(r.names), ['Amit']);
});
