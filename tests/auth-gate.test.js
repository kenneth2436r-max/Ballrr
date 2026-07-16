'use strict';
// Regression tests for the shared-tournament "stuck on Loading your tournaments..." bug and
// its related edge cases (already-active code, switching between tournaments, mismatched
// codes). See consumePendingCheckin/consumePendingFollow/consumePendingJoin in the app source.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

async function loadViaLink({ dbSetup, urlSuffix, activeCode, uid }){
  const dbStore = {};
  dbSetup(dbStore);
  const { window, triggerAuth } = freshWindow({ dbStore, urlSuffix, activeCode });
  runInOneEval(window, '');
  triggerAuth({ uid, displayName: 'Friend', email: 'friend@example.com' });
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  return {
    activeCode: window.localStorage.getItem('ballrr_shared_code_v1'),
    gateHidden: window.document.getElementById('auth-gate').style.display === 'none',
    alerts: window.__alerts,
    startAppCalled: !!window.__startAppCalled,
    window,
  };
}

test('reopening a follow link while already following resolves the gate (the original bug)', async () => {
  const r = await loadViaLink({
    dbSetup: (db) => {
      db['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:['friendUid'], followerNames:{friendUid:'Friend'}, requireApproval:true };
      db['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
    },
    urlSuffix: 'follow=vj8erz', activeCode: 'VJ8ERZ', uid: 'friendUid'
  });
  assert.strictEqual(r.gateHidden, true, 'auth gate must not stay stuck on the loading screen');
  assert.strictEqual(r.activeCode, 'VJ8ERZ');
  assert.strictEqual(r.startAppCalled, true);
});

test('a fresh follow link (not previously following) works normally', async () => {
  const r = await loadViaLink({
    dbSetup: (db) => {
      db['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:[], followerNames:{}, requireApproval:true };
      db['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
    },
    urlSuffix: 'follow=vj8erz', uid: 'friendUid'
  });
  assert.strictEqual(r.gateHidden, true);
  assert.strictEqual(r.activeCode, 'VJ8ERZ');
});

test('following a different tournament while already watching one offers a switch (accepted)', async () => {
  const r = await loadViaLink({
    dbSetup: (db) => {
      db['shared/OTHER1'] = { ownerId:'friendUid', ownerName:'Friend', members:['friendUid'], pendingRequests:[], memberNames:{friendUid:'Friend'}, followers:[], followerNames:{}, requireApproval:false };
      db['shared/OTHER1/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
      db['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:[], followerNames:{}, requireApproval:true };
    },
    urlSuffix: 'follow=vj8erz', activeCode: 'OTHER1', uid: 'friendUid'
  });
  // freshWindow's window.confirm always returns true, matching a user who accepts the prompt.
  assert.strictEqual(r.gateHidden, true);
  assert.strictEqual(r.activeCode, 'VJ8ERZ', 'should switch to the new tournament after confirming');
});

test('opening a follow link while signed out triggers silent anonymous sign-in, not the Google sign-in gate', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:[], followerNames:{}, requireApproval:true };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  const { window, triggerAuth, getAnonSignInCalls } = freshWindow({ dbStore, urlSuffix: 'follow=vj8erz' });
  runInOneEval(window, '');
  triggerAuth(null); // the signed-out state Firebase reports before any account (real or anonymous) exists
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(getAnonSignInCalls(), 1, 'a follow link while signed out must trigger exactly one anonymous sign-in, with no user action required');
  assert.strictEqual(window.document.getElementById('auth-gate').style.display, 'none', 'the gate should resolve once anonymous sign-in completes the follow, not get stuck');
  assert.strictEqual(window.localStorage.getItem('ballrr_shared_code_v1'), 'VJ8ERZ');
});

test('a checkin or join link (not a follow link) still shows the real sign-in gate when signed out -- only pure viewing skips it', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:[], followerNames:{}, requireApproval:false };
  const { window, triggerAuth, getAnonSignInCalls } = freshWindow({ dbStore, urlSuffix: 'join=vj8erz' });
  runInOneEval(window, '');
  triggerAuth(null);
  await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(getAnonSignInCalls(), 0, 'edit-access invites still require a real, persistent sign-in');
  assert.strictEqual(window.document.getElementById('auth-gate').style.display, 'flex');
});

test('reopening a checkin link while already a member opens the checkin picker', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1','friendUid'], pendingRequests:[], memberNames:{owner1:'Aaryan',friendUid:'Friend'}, followers:[], followerNames:{}, requireApproval:false };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  const { window, triggerAuth } = freshWindow({ dbStore, urlSuffix: 'checkin=vj8erz', activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  await new Promise(r => setTimeout(r, 700)); // the checkin picker opens on a 500ms setTimeout
  assert.strictEqual(window.document.getElementById('auth-gate').style.display, 'none');
  assert.strictEqual(!!window.__checkinPickerOpened, true);
});
