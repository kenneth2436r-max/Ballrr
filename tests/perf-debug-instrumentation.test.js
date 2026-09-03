'use strict';
// Tests for the dev-only render-timer added for future perf-regression detection: it must be a
// true no-op for a normal user (no flag set), and when explicitly turned on (via ?perf=1 or the
// ballrr_perf_debug_v1 localStorage flag) it should wrap named functions to time every call into
// window.__ballrrPerfStats, without changing their return value or `this`/argument behavior.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('isPerfDebugEnabled() is false and __ballrrPerfStats stays unset by default -- the app-load-time instrumentRenderPerf() call must be a true no-op for a normal user', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.enabled = isPerfDebugEnabled();
    window.__results.statsAfterLoad = typeof window.__ballrrPerfStats;
    window.__results.renderMatchesIsOriginal = (typeof renderMatches === 'function');
  `);
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(r.statsAfterLoad, 'undefined', 'instrumentRenderPerf() runs automatically at load time, but must bail out immediately (no wrapping, no stats object) when no debug flag is set');
});

test('isPerfDebugEnabled() reads the ?perf=1 URL flag', () => {
  const { window } = freshWindow({ urlSuffix: 'perf=1' });
  const r = runInOneEval(window, `window.__results.enabled = isPerfDebugEnabled();`);
  assert.strictEqual(r.enabled, true);
});

test('isPerfDebugEnabled() reads the ballrr_perf_debug_v1 localStorage flag', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.before = isPerfDebugEnabled();
    localStorage.setItem('ballrr_perf_debug_v1', '1');
    window.__results.after = isPerfDebugEnabled();
  `);
  assert.strictEqual(r.before, false);
  assert.strictEqual(r.after, true);
});

test('instrumentRenderPerf() wraps a named function to record call count/total/max ms into __ballrrPerfStats, once the debug flag is on, without changing its return value or arguments', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    localStorage.setItem('ballrr_perf_debug_v1', '1');
    window.myTestRenderFn = function(a, b){ return a + b; };
    instrumentRenderPerf(['myTestRenderFn']);
    window.__results.sum1 = window.myTestRenderFn(2, 3);
    window.__results.sum2 = window.myTestRenderFn(10, 5);
    const stats = window.__ballrrPerfStats.myTestRenderFn;
    window.__results.count = stats.count;
    window.__results.totalIsNumber = typeof stats.totalMs === 'number';
    window.__results.maxIsNumber = typeof stats.maxMs === 'number';
  `);
  assert.strictEqual(r.sum1, 5, 'the wrapped function must still return the original result');
  assert.strictEqual(r.sum2, 15);
  assert.strictEqual(r.count, 2, 'both calls should be tallied');
  assert.strictEqual(r.totalIsNumber, true);
  assert.strictEqual(r.maxIsNumber, true);
});

test('instrumentRenderPerf() does nothing (no crash, no stats) when the debug flag is off, and does nothing for a name that is not a function', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.myTestRenderFn2 = function(){ return 'orig'; };
    instrumentRenderPerf(['myTestRenderFn2', 'someNameThatDoesNotExist']);
    window.__results.stillOriginal = window.myTestRenderFn2();
    window.__results.statsUnset = typeof window.__ballrrPerfStats;
  `);
  assert.strictEqual(r.stillOriginal, 'orig');
  assert.strictEqual(r.statsUnset, 'undefined');
});
