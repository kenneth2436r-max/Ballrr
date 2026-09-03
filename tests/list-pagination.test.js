'use strict';
// Tests for the "show first N, load more on tap" pagination added to renderCareer()/renderArchive()
// as part of the performance pass -- these are the two lists most likely to grow genuinely large
// over a device's lifetime (every player who's ever appeared, every tournament ever saved), unlike
// a single tournament's own match list which is naturally small. Verifies: only LIST_PAGE_SIZE rows
// render initially when there's more data than that, a "Show more" button appears with the correct
// remaining count, and tapping it (showMoreCareer/showMoreArchive) reveals the rest and removes the
// button. Also verifies the button does NOT appear when everything already fits on one page.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function manyPlayerHistory(n){
  const entries = [];
  for(let i = 0; i < n; i++){
    entries.push({
      id: 't' + i, date: '2026-0' + (1 + (i % 9)) + '-01', label: 'Tournament ' + i, mode: 'friendly',
      playerStats: [{ name: 'Player' + i, team: 'Red FC', avg: 7, count: 2, goals: 1, assists: 0, cleanSheets: 0 }]
    });
  }
  return entries;
}

test('renderCareer() caps the leaderboard at LIST_PAGE_SIZE rows with a "Show more" button when there are more players than that, and showMoreCareer() reveals the rest', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { mode: 'friendly', results: [], fixtures: [], playerDB: [], numTeams: 2, teamNames: ['Red FC','Blue FC'], tournamentHistory: ${JSON.stringify(manyPlayerHistory(30))} };
    careerVisibleCount = LIST_PAGE_SIZE;
    renderCareer();
    const before = document.getElementById('career-container').innerHTML;
    window.__results.rowsBefore = (before.match(/class="scorer-item"/g) || []).length;
    window.__results.hasMoreBtnBefore = /Show more/.test(before);
    window.__results.remainingCountBefore = (before.match(/Show more \\((\\d+) more\\)/) || [])[1];
    showMoreCareer('career-container');
    const after = document.getElementById('career-container').innerHTML;
    window.__results.rowsAfter = (after.match(/class="scorer-item"/g) || []).length;
    window.__results.hasMoreBtnAfter = /Show more/.test(after);
  `);
  assert.strictEqual(r.rowsBefore, 25, 'only LIST_PAGE_SIZE (25) rows should render on the first pass, out of 30 total players');
  assert.strictEqual(r.hasMoreBtnBefore, true);
  assert.strictEqual(r.remainingCountBefore, '5', 'the button should say exactly how many more are hidden');
  assert.strictEqual(r.rowsAfter, 30, 'after showMoreCareer(), all 30 players should now render');
  assert.strictEqual(r.hasMoreBtnAfter, false, 'once every row is visible, the "Show more" button must go away');
});

test('renderCareer() does not show a "Show more" button when the whole leaderboard already fits within LIST_PAGE_SIZE', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { mode: 'friendly', results: [], fixtures: [], playerDB: [], numTeams: 2, teamNames: ['Red FC','Blue FC'], tournamentHistory: ${JSON.stringify(manyPlayerHistory(10))} };
    careerVisibleCount = LIST_PAGE_SIZE;
    renderCareer();
    const html = document.getElementById('career-container').innerHTML;
    window.__results.rows = (html.match(/class="scorer-item"/g) || []).length;
    window.__results.hasMoreBtn = /Show more/.test(html);
  `);
  assert.strictEqual(r.rows, 10);
  assert.strictEqual(r.hasMoreBtn, false, 'with fewer entries than one page, there is nothing more to show');
});

test('renderArchive() caps the Saved Tournaments list at LIST_PAGE_SIZE with a "Show more" button, and showMoreArchive() reveals the rest', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { mode: 'friendly', tournamentHistory: ${JSON.stringify(manyPlayerHistory(28))} };
    archiveVisibleCount = LIST_PAGE_SIZE;
    renderArchive();
    const before = document.getElementById('archive-container').innerHTML;
    window.__results.cardsBefore = (before.match(/class="roster-card"/g) || []).length;
    window.__results.hasMoreBtnBefore = /Show more/.test(before);
    showMoreArchive();
    const after = document.getElementById('archive-container').innerHTML;
    window.__results.cardsAfter = (after.match(/class="roster-card"/g) || []).length;
    window.__results.hasMoreBtnAfter = /Show more/.test(after);
  `);
  assert.strictEqual(r.cardsBefore, 25, 'only LIST_PAGE_SIZE (25) saved-tournament cards should render on the first pass, out of 28 saved');
  assert.strictEqual(r.hasMoreBtnBefore, true);
  assert.strictEqual(r.cardsAfter, 28, 'after showMoreArchive(), all 28 saved tournaments should now render');
  assert.strictEqual(r.hasMoreBtnAfter, false);
});
