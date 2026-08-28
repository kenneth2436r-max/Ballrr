'use strict';
// Regression test for a real reported bug: a visitor taps a "follow" link
// (.../index.html?follow=CODE), which correctly auto-follows them into the shared tournament --
// but the app never removed ?follow=CODE from the browser/WebView's URL. Since this whole app is
// one static page (Capacitor's server.url just points straight at it, no server-side routing),
// the URL never changes on its own. That meant ANY later reload of that exact page -- the OS
// reclaiming a backgrounded WebView, force-closing and reopening the app, a manual refresh --
// re-ran captureCheckinParamFromUrl() from scratch, read the SAME still-present ?follow=CODE, and
// silently re-followed that tournament again, even after the visitor had explicitly tapped
// "Stop following"/"Leave" moments (or days) before. From the visitor's side that read as "the
// Leave button doesn't work -- I'm stuck in view-only mode", which is exactly what was reported.
// Fix: strip these one-time action params (checkin/follow/join/followhost) from the URL via
// history.replaceState() immediately after reading them, so they can never be replayed by a
// later reload.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('captureCheckinParamFromUrl captures a ?follow=CODE link param in memory but strips it from the URL so a later page reload cannot replay it', () => {
  const { window } = freshWindow({ urlSuffix: 'follow=abcd1234' });
  const r = runInOneEval(window, `
    window.__results.pendingFollowCode = pendingFollowCode;
    window.__results.search = window.location.search;
    window.__results.href = window.location.href;
  `);
  assert.strictEqual(r.pendingFollowCode, 'ABCD1234', 'the code should still be captured in memory for the boot flow to consume');
  assert.strictEqual(r.search, '', 'the ?follow=... param must be stripped from the URL so a later page reload cannot replay it');
  assert.ok(!r.href.includes('follow='), 'the full URL should not contain the consumed param either');
});

test('captureCheckinParamFromUrl strips checkin/join/followhost the same way as follow', () => {
  for(const [param, varName] of [['checkin', 'pendingCheckinCode'], ['join', 'pendingJoinCode'], ['followhost', 'pendingFollowHostCode']]){
    const { window } = freshWindow({ urlSuffix: `${param}=zz999999` });
    const r = runInOneEval(window, `
      window.__results.value = ${varName};
      window.__results.search = window.location.search;
    `);
    assert.strictEqual(r.value, 'ZZ999999', `${param} should still be captured in memory`);
    assert.strictEqual(r.search, '', `?${param}=... must be stripped from the URL`);
  }
});

test('captureCheckinParamFromUrl only strips the recognized one-time params, leaving any other query params in place', () => {
  const { window } = freshWindow({ urlSuffix: 'follow=abcd1234&utm_source=whatsapp' });
  const r = runInOneEval(window, `
    window.__results.pendingFollowCode = pendingFollowCode;
    window.__results.search = window.location.search;
  `);
  assert.strictEqual(r.pendingFollowCode, 'ABCD1234');
  assert.strictEqual(r.search, '?utm_source=whatsapp', 'an unrelated query param should survive the cleanup untouched');
});

test('captureCheckinParamFromUrl is a no-op on the URL when there is no recognized link param to begin with', () => {
  const { window } = freshWindow({ urlSuffix: 'utm_source=whatsapp' });
  const r = runInOneEval(window, `
    window.__results.search = window.location.search;
    window.__results.pendingFollowCode = pendingFollowCode;
  `);
  assert.strictEqual(r.search, '?utm_source=whatsapp', 'nothing to strip -- an unrelated param should be left exactly as-is');
  assert.strictEqual(r.pendingFollowCode, null);
});
