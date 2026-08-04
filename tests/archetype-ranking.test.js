'use strict';
// Tests for computeCareerArchetypes()'s per-badge ranking list and showArchetypeRanking() --
// added after a report that a player with fewer TOTAL assists (but a higher assists-PER-MATCH
// ratio, since they'd played fewer matches) was still crowned "The Playmaker" over players with
// more total assists. That's correct by design (see topBy()'s scoreFn: assists/matches, not raw
// assists), but wasn't visible anywhere -- the badge only ever showed the single winner. Now
// every archetype carries its full ranked candidate list, and tapping the badge shows it, so
// "why does X still have this" is something someone can check themselves instead of just being
// told the formula.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function entry(id, name, team, avg, count, goals, assists, cleanSheets){
  return { id, playerStats: [{ name, team, position:'MID', avg, count, goals, assists, cleanSheets }] };
}

test('a player with fewer total assists but a higher assists/match ratio still wins The Playmaker over a higher-total player', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true, results: [], playerDB: [],
      tournamentHistory: [
        ${JSON.stringify(entry('t1', 'Keith', 'Red FC', 7, 2, 0, 2, 0))},
        ${JSON.stringify(entry('t2', 'Densil', 'Blue FC', 7, 8, 1, 5, 0))}
      ]
    };
    window.__results.archetypes = computeCareerArchetypes();
  `);
  const playmaker = r.archetypes.find(a => a.label === 'The Playmaker');
  assert.ok(playmaker, 'Playmaker badge should be awarded');
  // Keith: 2 assists / 2 matches = 1.0/match. Densil: 5 assists / 8 matches = 0.625/match.
  // Keith's ratio is higher despite Densil having more assists in total (5 vs 2) -- this is the
  // intended, ratio-based design, not a bug.
  assert.strictEqual(playmaker.name, 'Keith');
  assert.ok(playmaker.ranking.length >= 2, 'both qualifying players should appear in the ranking');
  assert.strictEqual(playmaker.ranking[0].name, 'Keith');
  assert.strictEqual(playmaker.ranking[1].name, 'Densil');
});

test('showArchetypeRanking renders the full candidate list (not just the winner) into the shared player-card modal', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = {
      careerSnapshotSaved: true, results: [], playerDB: [],
      tournamentHistory: [
        ${JSON.stringify(entry('t1', 'Keith', 'Red FC', 7, 2, 0, 2, 0))},
        ${JSON.stringify(entry('t2', 'Densil', 'Blue FC', 7, 8, 1, 5, 0))}
      ]
    };
    renderCareer();
    const playmakerIndex = careerArchetypesCache.findIndex(a => a.label === 'The Playmaker');
    showArchetypeRanking(playmakerIndex);
    window.__results.html = document.getElementById('player-card-content').innerHTML;
    window.__results.modalShown = document.getElementById('player-card-modal').style.display;
  `);
  assert.ok(r.html.includes('Keith'), 'the winner should be listed');
  assert.ok(r.html.includes('Densil'), 'the runner-up should ALSO be listed, not just the winner');
  assert.strictEqual(r.modalShown, 'flex');
});
