'use strict';
// Regression tests for: (a) sound/notifications/cue-card preferences persisting immediately
// to a dedicated per-device local key instead of a debounced cloud write that can be lost on
// close, and (b) the "started following" notification reaching the organizer.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('enabling notifications persists immediately to the dedicated local key', async () => {
  const { window } = freshWindow();
  class FakeNotification { constructor(t,o){ this.title=t; this.opts=o; } }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = () => Promise.resolve('granted');
  window.Notification = FakeNotification;
  runInOneEval(window, `
    state = {notificationsEnabled:false,soundEnabled:true,cueCardsEnabled:true};
    enableNotifications();
  `);
  await new Promise(r => setTimeout(r, 20));
  const prefsRaw = window.localStorage.getItem('ballrr_local_prefs_v1');
  assert.ok(prefsRaw, 'local pref key should exist');
  assert.strictEqual(JSON.parse(prefsRaw).notificationsEnabled, true);
});

test('reopening the app does not silently revert notifications to off', () => {
  const { window } = freshWindow({ localPrefs: { notificationsEnabled: true } });
  const r = runInOneEval(window, `
    state = {notificationsEnabled:false,soundEnabled:true,cueCardsEnabled:true};
    applyLocalPrefsToState();
    window.__results.notificationsEnabled = state.notificationsEnabled;
  `);
  assert.strictEqual(r.notificationsEnabled, true, 'the local device pref must win over a stale/never-saved cloud value');
});

test('the "started following" notification reaches the organizer', () => {
  const { window } = freshWindow();
  class FakeNotification { constructor(t,o){ this.title=t; this.opts=o; FakeNotification.__instances.push(this); } }
  FakeNotification.__instances = [];
  FakeNotification.permission = 'granted';
  window.Notification = FakeNotification;
  window.__instances = FakeNotification.__instances;
  runInOneEval(window, `
    currentUser = { uid:'owner1', displayName:'Aaryan' };
    sharedMeta = { code:'VJ8ERZ', ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:[], followerNames:{}, requireApproval:false };
    state = {notificationsEnabled:true};
    const dbDoc = { exists:true, data:()=>({ ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:['newFanUid'], followerNames:{newFanUid:'Devyanee'}, requireApproval:false }) };
    handleSharedMetaSnap('VJ8ERZ', dbDoc);
  `);
  assert.ok(FakeNotification.__instances.some(n => n.title.includes('follower') && n.opts.body.includes('Devyanee')));
});
