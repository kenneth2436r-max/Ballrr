'use strict';
// Native (Capacitor LocalNotifications) push-style notification tests -- Android WebView does
// not implement window.Notification at all, so the installed app must go through the native
// plugin instead. See nativeNotificationsPlugin()/fireOsNotification()/enableNotifications().
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('notificationsSupported() is true via the native plugin even with no window.Notification at all', async () => {
  const { window } = freshWindow();
  const scheduled = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: {
      requestPermissions: () => Promise.resolve({ display: 'granted' }),
      schedule: (opts) => { scheduled.push(opts); return Promise.resolve(); }
    }}
  };
  const r = runInOneEval(window, `
    state = {};
    window.__results.supported = notificationsSupported();
    enableNotifications();
  `);
  assert.strictEqual(r.supported, true);
  await new Promise(res => setTimeout(res, 20));
  assert.strictEqual(scheduled.length, 1, 'enabling should schedule a native confirmation notification');
  assert.ok(scheduled[0].notifications[0].title.includes('Notifications on'));
});

test('denied native permission schedules nothing and explains why', async () => {
  const { window } = freshWindow();
  const scheduled = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { LocalNotifications: {
      requestPermissions: () => Promise.resolve({ display: 'denied' }),
      schedule: (opts) => { scheduled.push(opts); return Promise.resolve(); }
    }}
  };
  runInOneEval(window, `state = {}; enableNotifications();`);
  await new Promise(res => setTimeout(res, 20));
  assert.strictEqual(scheduled.length, 0);
  assert.ok(window.__alerts.some(a => a.includes('blocked')));
});

test('a real browser tab (no Capacitor) still uses window.Notification, not the native branch', () => {
  const { window } = freshWindow();
  class FakeNotification { constructor(t,o){ this.title=t; this.opts=o; FakeNotification.__instances.push(this); } }
  FakeNotification.__instances = [];
  FakeNotification.permission = 'granted';
  window.Notification = FakeNotification;
  window.__instances = FakeNotification.__instances;
  const r = runInOneEval(window, `
    state = {notificationsEnabled:true};
    window.__results.supported = notificationsSupported();
    fireOsNotification('T','B',{tag:'x'});
    window.__results.count = window.__instances.length;
  `);
  assert.strictEqual(r.supported, true);
  assert.strictEqual(r.count, 1);
});

test('native platform with the plugin not yet registered reports unsupported without throwing', () => {
  const { window } = freshWindow();
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  const r = runInOneEval(window, `
    state = {};
    window.__results.supported = notificationsSupported();
    try{ enableNotifications(); window.__results.threw=false; }catch(e){ window.__results.threw=true; }
  `);
  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.threw, false);
});
