'use strict';
// Tests for Instagram-Stories-style Home fact cards (computeHomeStories()/homeStoriesStripHtml()/
// openHomeStory()) -- a new, additive Home-tab feature. There's no photo/video upload in this
// app, so these are auto-generated "fact cards" computed from whatever's already happened
// (a streak, the latest result, top scorer, top-rated player), each skipped if there's nothing
// to show yet. Reuses .highlights-strip/.highlight-circle CSS (see highlights.test.js) and the
// #player-card-modal/#player-card-content generic content modal for the tap-through view.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function baseState(overrides){
  return Object.assign({
    numTeams: 2,
    teamNames: ['Red FC', 'Blue FC'],
    fixtures: [[0, 1]],
    captains: ['', ''],
    players: [
      { name: 'Alex', team: 0 },
      { name: 'Sam', team: 1 },
    ],
    playerDB: [],
    results: [
      { played: false, g: [0, 0], scorers: [], assists: [] },
    ],
    tournamentHistory: [],
  }, overrides || {});
}

test('computeHomeStories returns nothing when there is no data yet (fresh tournament)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    window.__results.stories = computeHomeStories();
  `);
  // Not deepStrictEqual against a literal [] here: r.stories is an Array from the jsdom window's
  // own realm (a different Array.prototype than this file's), which deepStrictEqual treats as a
  // prototype mismatch even when the contents are identical. Length is what actually matters.
  assert.strictEqual(r.stories.length, 0, 'an empty tournament should produce no story cards');
});

test('computeHomeStories includes Latest Result, Top Scorer, and Top Rated once a match has been played, but not Streak below 2', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({
      results: [{ played: true, g: [2, 1], scorers: [{ name: 'Alex', team: 0, goals: 2 }], assists: [] }],
    }))};
    window.__results.stories = computeHomeStories();
  `);
  const titles = r.stories.map(s => s.title);
  assert.ok(!titles.includes('Streak'), 'a single tournament with no history should not show a streak card');
  assert.ok(titles.includes('Latest Result'), 'a played match should produce a Latest Result card');
  assert.ok(r.stories.find(s => s.title === 'Latest Result').detail.includes('Red FC'));
  assert.ok(titles.includes('Top Scorer'), 'a scorer should produce a Top Scorer card');
  assert.ok(r.stories.find(s => s.title === 'Top Scorer').detail.includes('Alex'));
  assert.ok(titles.includes('Top Rated'), 'a played match should produce a Top Rated card');
});

test('computeHomeStories includes a Streak card once tournamentHistory shows 2+ close-together tournaments', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState({
      tournamentHistory: [{ date: '2026-07-01' }, { date: '2026-07-08' }],
    }))};
    window.__results.stories = computeHomeStories();
  `);
  const streakCard = r.stories.find(s => s.title === 'Streak');
  assert.ok(streakCard, 'two tournaments a week apart should count as a streak');
  assert.ok(streakCard.detail.includes('2'));
});

test('homeStoriesStripHtml renders one tappable circle per story, and an empty string when there are none', () => {
  const { window } = freshWindow({ extraHtml: '<div id="home-strip-test"></div>' });
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    window.__results.empty = homeStoriesStripHtml();
    state = ${JSON.stringify(baseState({
      results: [{ played: true, g: [2, 1], scorers: [{ name: 'Alex', team: 0, goals: 2 }], assists: [] }],
    }))};
    window.__results.withStories = homeStoriesStripHtml();
  `);
  assert.strictEqual(r.empty, '', 'no stories should render nothing, not an empty strip container');
  assert.ok(r.withStories.includes('highlight-circle'), 'each story should render as a highlight-circle');
  assert.ok(r.withStories.includes('openHomeStory('), 'each circle should be tappable via openHomeStory');
});

test('openHomeStory shows the fact card detail in the shared player-card modal', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(baseState({
      results: [{ played: true, g: [2, 1], scorers: [{ name: 'Alex', team: 0, goals: 2 }], assists: [] }],
    }))};
    homeStoriesStripHtml();
    openHomeStory(0);
  `);
  assert.strictEqual(window.document.getElementById('player-card-modal').style.display, 'flex', 'the modal should open');
  const content = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(content.length > 0, 'the fact card content should be filled in');
});

test('openHomeStory is a safe no-op for an out-of-range index', () => {
  const { window } = freshWindow({ extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  runInOneEval(window, `
    state = ${JSON.stringify(baseState())};
    homeStoriesStripHtml();
    openHomeStory(5);
  `);
  assert.strictEqual(window.document.getElementById('player-card-modal').style.display, 'none', 'nothing should open for a bad index');
});
