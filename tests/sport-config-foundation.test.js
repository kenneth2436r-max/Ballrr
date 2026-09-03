'use strict';
// Tests for the Phase 4 (Multi-Sport Support) foundation: SPORT_CONFIGS is an inert data scaffold
// only -- nothing in the app reads from it yet (see its own comment for why: rewriting the
// football-hardcoded position/stat/PDF/draft logic to be sport-aware is a much larger, separate
// effort, and this pass deliberately stops at "the shape exists and matches today's real values"
// rather than risking the live football product for a second sport nobody asked for yet).
//
// This test's job is narrow but important: prove SPORT_CONFIGS.football is byte-identical to the
// actual POSITIONS constant every existing call site still uses, so the scaffold can't silently
// drift out of sync with reality while it sits unused.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('SPORT_CONFIGS.football.positions exactly matches the real POSITIONS constant every existing call site uses (extraction, not a fork)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.positions = POSITIONS;
    window.__results.configPositions = SPORT_CONFIGS.football.positions;
    window.__results.defaultMinutes = SPORT_CONFIGS.football.defaultMatchMinutes;
  `);
  assert.deepStrictEqual(Array.from(r.positions), ['GK','DEF','MID','FWD']);
  assert.deepStrictEqual(Array.from(r.configPositions), Array.from(r.positions), 'SPORT_CONFIGS.football.positions must match the live POSITIONS constant exactly -- this is meant to describe today\'s real behavior, not a separate, driftable copy');
  assert.strictEqual(r.defaultMinutes, 90, 'should match the app\'s actual default match length');
});

test('SPORT_CONFIGS.basketball exists as a genuine second worked example with its own distinct positions and stat fields (proving the shape generalizes), without being wired into anything', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.basketballPositions = SPORT_CONFIGS.basketball.positions;
    window.__results.footballPositions = SPORT_CONFIGS.football.positions;
    window.__results.statFieldNames = SPORT_CONFIGS.basketball.statFields.map(f => f[0]);
    window.__results.appStillReadsPlainPositions = (typeof POSITIONS !== 'undefined' && Array.isArray(POSITIONS));
  `);
  assert.deepStrictEqual(Array.from(r.basketballPositions), ['PG','SG','SF','PF','C']);
  assert.notDeepStrictEqual(Array.from(r.basketballPositions), Array.from(r.footballPositions), 'basketball must have genuinely distinct positions from football, not a copy-paste');
  assert.deepStrictEqual(Array.from(r.statFieldNames), ['rebounds','steals','blocks','turnovers']);
  assert.strictEqual(r.appStillReadsPlainPositions, true, 'the plain POSITIONS constant every existing call site (pitch, draft, ratings) reads from must still exist and be untouched -- SPORT_CONFIGS is additive scaffolding only, this pass does not repoint any of them');
});
