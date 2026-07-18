'use strict';
// Regression tests for: "the timer is clearly set for 10 mins then why do the knockout matches
// show 90 minutes?". Root cause was two-fold:
//   1. blankMatch() -- the factory used to create every knockout/page3/custom-stage match object
//      (as well as league fixtures) -- hardcoded targetMinutes:90 no matter what the organizer
//      set as the Settings > Default match length.
//   2. applyDefaultMatchMinutesToAll() (the "Apply to all" button) only ever walked
//      state.results (league fixtures); it never touched any knockout match container, so even
//      an explicit "apply the default everywhere" action silently skipped knockout matches.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('blankMatch() uses state.defaultMatchMinutes instead of always hardcoding 90', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { defaultMatchMinutes: 10 };
    window.__results.mins = blankMatch().timer.targetMinutes;
  `);
  assert.strictEqual(r.mins, 10);
});

test('blankMatch() still falls back to 90 when no default has been set', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = {};
    window.__results.mins = blankMatch().timer.targetMinutes;
  `);
  assert.strictEqual(r.mins, 90);
});

function blankM(mins){
  return { played:false, g:[null,null], scorers:[], assists:[], timer:{running:false,accumulatedMs:0,startedAt:null,targetMinutes:mins,injuryMinutes:0} };
}

test('applyDefaultMatchMinutesToAll updates league fixtures AND every knockout match container (regular bracket, 3rd place, page3, custom stages)', () => {
  const { window } = freshWindow();
  const st = {
    defaultMatchMinutes: 10,
    results: [blankM(90)],
    page3: { qualifier: blankM(90), eliminator: blankM(90), final: blankM(90) },
    koThird: blankM(90),
    koRounds: [[blankM(90), blankM(90)], [blankM(90)]],
    customResults: [[blankM(90)], [blankM(90), blankM(90)]],
  };
  const r = runInOneEval(window, `
    saveState=function(){};renderAll=function(){};
    state = ${JSON.stringify(st)};
    applyDefaultMatchMinutesToAll();
    window.__results.resultsMins = Array.from(state.results.map(m=>m.timer.targetMinutes));
    window.__results.page3Mins = Array.from([state.page3.qualifier, state.page3.eliminator, state.page3.final].map(m=>m.timer.targetMinutes));
    window.__results.koThirdMins = state.koThird.timer.targetMinutes;
    window.__results.koRoundsMins = Array.from(state.koRounds.map(round=>Array.from(round.map(m=>m.timer.targetMinutes))));
    window.__results.customMins = Array.from(state.customResults.map(stage=>Array.from(stage.map(m=>m.timer.targetMinutes))));
  `);
  assert.deepStrictEqual(Array.from(r.resultsMins), [10]);
  assert.deepStrictEqual(Array.from(r.page3Mins), [10, 10, 10]);
  assert.strictEqual(r.koThirdMins, 10);
  assert.deepStrictEqual(Array.from(r.koRoundsMins).map(a => Array.from(a)), [[10, 10], [10]]);
  assert.deepStrictEqual(Array.from(r.customMins).map(a => Array.from(a)), [[10], [10, 10]]);
});

test("applyDefaultMatchMinutesToAll never touches an already-played match's length", () => {
  const { window } = freshWindow();
  const played = blankM(90); played.played = true;
  const st = { defaultMatchMinutes: 10, results: [played], page3: null, koThird: null, koRounds: [], customResults: [] };
  const r = runInOneEval(window, `
    saveState=function(){};renderAll=function(){};
    state = ${JSON.stringify(st)};
    applyDefaultMatchMinutesToAll();
    window.__results.mins = state.results[0].timer.targetMinutes;
  `);
  assert.strictEqual(r.mins, 90, "a played match's length must be left alone");
});
