'use strict';
// Regression tests for the match-clock alert feature: "the match timer clock just runs like a
// stopwatch not a timer... 30-60 seconds prior to end give a pop up asking to add [stoppage
// time]... once the clock reaches the set time it gives out a beep sound to alert the one
// monitoring". Exercises checkTimerAlerts() -- the once-a-second check that drives both the
// pre-full-time prompt and the full-time whistle -- directly, without needing the full render
// pipeline.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('a running timer 45s from its target queues the stoppage-time prompt exactly once', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__whistles=0; window.__chimes=0;
    playFullTimeWhistle=function(){window.__whistles++;};
    playInjuryTimeChime=function(){window.__chimes++;};
    haptic=function(){};
    const t={running:true,accumulatedMs:0,startedAt:Date.now()-((90*60000)-45000),targetMinutes:90,injuryMinutes:0};
    checkTimerAlerts('league',0,t);
    checkTimerAlerts('league',0,t); // a second tick at basically the same elapsed time
    window.__results.overlayDisplay=document.getElementById('stoppage-time-overlay').style.display;
    window.__results.chimes=window.__chimes;
    window.__results.whistles=window.__whistles;
    window.__results.active=stoppageTimeActive;
  `);
  assert.strictEqual(r.overlayDisplay, 'flex', 'the stoppage-time prompt should be showing');
  assert.strictEqual(r.chimes, 1, 'the heads-up chime should fire exactly once, not once per tick');
  assert.strictEqual(r.whistles, 0, 'full time has not been reached yet -- no whistle');
  assert.deepStrictEqual(Object.assign({}, r.active), { kind: 'league', ref: 0 });
});

test('a timer that is more than 60s from its target does not queue a prompt yet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__chimes=0;
    playInjuryTimeChime=function(){window.__chimes++;};
    haptic=function(){};
    const t={running:true,accumulatedMs:0,startedAt:Date.now()-((90*60000)-90000),targetMinutes:90,injuryMinutes:0};
    checkTimerAlerts('league',0,t);
    window.__results.chimes=window.__chimes;
    window.__results.active=stoppageTimeActive;
  `);
  assert.strictEqual(r.chimes, 0, '90s remaining is outside the 30-60s warning window');
  assert.strictEqual(r.active, null);
});

test('a timer that has actually reached its target plays the full-time whistle exactly once', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__whistles=0;
    playFullTimeWhistle=function(){window.__whistles++;};
    haptic=function(){};
    const t={running:true,accumulatedMs:0,startedAt:Date.now()-(90*60000),targetMinutes:90,injuryMinutes:0};
    checkTimerAlerts('league',1,t);
    checkTimerAlerts('league',1,t);
    checkTimerAlerts('league',1,t);
    window.__results.whistles=window.__whistles;
  `);
  assert.strictEqual(r.whistles, 1, 'must beep exactly once on reaching full time, not every tick after');
});

test('adding stoppage time re-arms both alerts for the new, later target', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__whistles=0;window.__chimes=0;
    playFullTimeWhistle=function(){window.__whistles++;};
    playInjuryTimeChime=function(){window.__chimes++;};
    haptic=function(){};
    // Already reached the original 90-minute target once.
    const t={running:true,accumulatedMs:0,startedAt:Date.now()-(90*60000),targetMinutes:90,injuryMinutes:0};
    checkTimerAlerts('league',2,t);
    // Referee adds 2' of stoppage time -- new target is 92:00. Elapsed is still only 90:00,
    // well before the new target, so nothing should fire yet.
    t.injuryMinutes=2;
    checkTimerAlerts('league',2,t);
    window.__results.whistlesAfterAdd=window.__whistles;
    // Clock keeps running and now reaches the NEW 92:00 target.
    t.startedAt=Date.now()-(92*60000);
    checkTimerAlerts('league',2,t);
    window.__results.whistlesAtNewTarget=window.__whistles;
  `);
  assert.strictEqual(r.whistlesAfterAdd, 1, 'still just the one whistle from the original target');
  assert.strictEqual(r.whistlesAtNewTarget, 2, 'reaching the NEW target after stoppage time was added must beep again');
});

test('resetMatchTimer clears its alert bookkeeping so restarting the same match alerts again', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__whistles=0;
    playFullTimeWhistle=function(){window.__whistles++;};
    haptic=function(){};saveState=function(){};renderMatches=function(){};
    state={results:[{timer:{running:true,accumulatedMs:0,startedAt:Date.now()-(90*60000),targetMinutes:90,injuryMinutes:0}}]};
    checkTimerAlerts('league',0,state.results[0].timer);
    const whistlesBeforeReset=window.__whistles;
    resetMatchTimer(0);
    // Same 90-minute length, played all the way through again.
    state.results[0].timer.running=true;
    state.results[0].timer.startedAt=Date.now()-(90*60000);
    checkTimerAlerts('league',0,state.results[0].timer);
    window.__results.whistlesBeforeReset=whistlesBeforeReset;
    window.__results.whistlesAfterReset=window.__whistles;
  `);
  assert.strictEqual(r.whistlesBeforeReset, 1);
  assert.strictEqual(r.whistlesAfterReset, 2, 'after a reset, reaching the same target duration again must beep again, not be treated as already-alerted');
});

test('closeStoppageTimePrompt dismisses the overlay and clears the active prompt', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    playFullTimeWhistle=function(){};playInjuryTimeChime=function(){};haptic=function(){};
    const t={running:true,accumulatedMs:0,startedAt:Date.now()-((90*60000)-45000),targetMinutes:90,injuryMinutes:0};
    checkTimerAlerts('league',3,t);
    closeStoppageTimePrompt();
    window.__results.overlayDisplay=document.getElementById('stoppage-time-overlay').style.display;
    window.__results.active=stoppageTimeActive;
  `);
  assert.strictEqual(r.overlayDisplay, 'none');
  assert.strictEqual(r.active, null);
});

test('addStoppageTimeFromPrompt adds the chosen minutes to the right match and closes the overlay', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    playFullTimeWhistle=function(){};playInjuryTimeChime=function(){};haptic=function(){};
    saveState=function(){};renderMatches=function(){};renderKnockout=function(){};
    state={results:[{timer:{running:true,accumulatedMs:0,startedAt:Date.now()-((90*60000)-45000),targetMinutes:90,injuryMinutes:0}}]};
    checkTimerAlerts('league',0,state.results[0].timer);
    addStoppageTimeFromPrompt(2);
    window.__results.injuryMinutes=state.results[0].timer.injuryMinutes;
    window.__results.overlayDisplay=document.getElementById('stoppage-time-overlay').style.display;
    window.__results.active=stoppageTimeActive;
  `);
  assert.strictEqual(r.injuryMinutes, 2, "tapping +2' in the prompt should add 2 minutes of stoppage time to that match");
  assert.strictEqual(r.overlayDisplay, 'none');
  assert.strictEqual(r.active, null);
});
