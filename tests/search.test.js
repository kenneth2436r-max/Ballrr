'use strict';
// Tests for the real Search tab (renderSearchResults()) -- replaces the old placeholder that
// just opened the Draft tab. Searches this device's own career leaderboard (players) and saved
// tournament history (by label), reusing showPlayerCard()/openProfileEntry() as tap targets.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(overrides){
  return Object.assign({
    careerSnapshotSaved: true,
    tournamentHistory: [
      { id: 't1', label: 'Summer Cup', date: '2026-07-01', playerStats: [
        { name: 'Densil', team: 'Red', position: 'MID', avg: 7, count: 3, goals: 2, assists: 1, cleanSheets: 0 },
      ] },
    ],
  }, overrides || {});
}

test('renderSearchResults finds a player by a case-insensitive substring, tappable to their player card', () => {
  const { window } = freshWindow({ extraHtml: '<input id="search-input"><div id="search-results"></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    document.getElementById('search-input').value = 'dens';
    renderSearchResults();
  `);
  const html = window.document.getElementById('search-results').innerHTML;
  assert.ok(html.includes('Densil'), 'the matching player should be listed');
  assert.ok(html.includes("showPlayerCard('Densil')"), 'tapping the player should open their player card');
});

test('renderSearchResults finds a saved tournament by label, tappable to its detail view', () => {
  const { window } = freshWindow({ extraHtml: '<input id="search-input"><div id="search-results"></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    document.getElementById('search-input').value = 'summer';
    renderSearchResults();
  `);
  const html = window.document.getElementById('search-results').innerHTML;
  assert.ok(html.includes('Summer Cup'), 'the matching tournament should be listed');
  assert.ok(html.includes("openProfileEntry('t1')"), 'tapping the tournament should open its detail view');
});

test('renderSearchResults shows a no-matches message for a query that finds nothing', () => {
  const { window } = freshWindow({ extraHtml: '<input id="search-input"><div id="search-results"></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    document.getElementById('search-input').value = 'zzzznotfound';
    renderSearchResults();
  `);
  const html = window.document.getElementById('search-results').innerHTML;
  assert.ok(html.includes('No matches for'), 'a clear no-results message should show instead of an empty blank area');
});

test('renderSearchResults shows the initial prompt when the search box is empty', () => {
  const { window } = freshWindow({ extraHtml: '<input id="search-input"><div id="search-results"></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    renderSearchResults();
  `);
  const html = window.document.getElementById('search-results').innerHTML;
  assert.ok(html.includes('Search players or tournaments'), 'an empty query should show the search prompt, not results or a no-matches message');
});
