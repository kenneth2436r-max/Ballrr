'use strict';
// Tests for the debounced local (localStorage) save added to saveState() as part of the
// performance pass: a rapid burst of saveState() calls (e.g. several live-scoring taps in a few
// seconds) should collapse into a single localStorage.setItem write after a short trailing delay,
// instead of one synchronous JSON.stringify(state)+write per call. flushLocalSaveNow() must still
// let a pending write land immediately when the app is about to background/close (wired up via
// visibilitychange/pagehide), so a debounced save is never silently lost.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('saveState() debounces the local write: a burst of calls in quick succession does not write synchronously, lands one write reflecting the LAST call\'s state after a short delay, and only schedules a single pending timer (clearTimeout+reset each call, so no earlier timer can also fire)', async () => {
  const { window } = freshWindow();
  runInOneEval(window, `
    state = { results: [], fixtures: [], teamNames: ['Red FC','Blue FC'], numTeams: 2, marker: 'call-1' };
    window.__testDone = (async () => {
      saveState();
      state.marker = 'call-2';
      saveState();
      state.marker = 'call-3';
      saveState();
      state.marker = 'call-4-final';
      saveState();
      window.__results.timerCountImmediatelyAfterBurst = localSaveTimer ? 1 : 0;
      window.__results.rawImmediatelyAfterBurst = localStorage.getItem(SK);
      await new Promise(resolve => setTimeout(resolve, 350));
      window.__results.rawAfterDelay = localStorage.getItem(SK);
      window.__results.timerAfterDelay = localSaveTimer;
    })();
  `);
  await window.__testDone;
  assert.strictEqual(window.__results.rawImmediatelyAfterBurst, null, 'the write must not happen synchronously -- it should still be pending right after a burst of calls');
  assert.strictEqual(window.__results.timerCountImmediatelyAfterBurst, 1, 'exactly one pending timer should exist after the burst -- each saveState() call clears the previous timer before scheduling a new one, so earlier calls in the burst can never also fire');
  const saved = JSON.parse(window.__results.rawAfterDelay);
  assert.strictEqual(saved.marker, 'call-4-final', 'once the single debounced write lands, it must reflect the LATEST state at write time, not an earlier call\'s snapshot from mid-burst');
  assert.strictEqual(window.__results.timerAfterDelay, null, 'the timer handle should be cleared once the debounced write has actually landed');
});

test('flushLocalSaveNow() lands a pending debounced save immediately (used on visibilitychange/pagehide so backgrounding never loses the last edit)', async () => {
  const { window } = freshWindow();
  runInOneEval(window, `
    state = { results: [], fixtures: [], teamNames: ['Red FC','Blue FC'], numTeams: 2, marker: 'before-flush' };
    saveState();
    window.__results.rawBeforeFlush = localStorage.getItem(SK);
    state.marker = 'after-flush';
    flushLocalSaveNow();
    window.__results.rawAfterFlush = localStorage.getItem(SK);
  `);
  assert.strictEqual(window.__results.rawBeforeFlush, null, 'before the debounce window elapses or a flush happens, nothing should be written yet');
  const saved = JSON.parse(window.__results.rawAfterFlush);
  assert.strictEqual(saved.marker, 'after-flush', 'flushLocalSaveNow() should write the CURRENT state immediately, not wait for the debounce timer');
});

test('flushLocalSaveNow() firing does not leave a stale pending timer that double-writes an older snapshot afterward', async () => {
  const { window } = freshWindow();
  runInOneEval(window, `
    state = { results: [], fixtures: [], teamNames: ['Red FC','Blue FC'], numTeams: 2, marker: 'v1' };
    saveState();
    flushLocalSaveNow();
    state.marker = 'v2';
    window.__testDone = new Promise(resolve => setTimeout(() => {
      window.__results.raw = localStorage.getItem(SK);
      resolve();
    }, 350));
  `);
  await window.__testDone;
  const saved = JSON.parse(window.__results.raw);
  assert.strictEqual(saved.marker, 'v1', 'flushLocalSaveNow() must clear the pending timer -- if a stale timer fired later it would overwrite with whatever state happens to look like by then, not what was true when the flush ran');
});

test('the debounced local save still respects the existing "skip localStorage while inside someone else\'s shared tournament" rule', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { results: [], fixtures: [], teamNames: ['Red FC','Blue FC'], numTeams: 2 };
    getActiveSharedCode = () => 'SOMECODE';
    saveState();
    flushLocalSaveNow();
    window.__results.raw = localStorage.getItem(SK);
  `);
  assert.strictEqual(r.raw, null, 'while viewing/editing a shared tournament that is not this device\'s own, nothing should ever be written to the local key, debounced or not');
});
