'use strict';
// Tests for: (a) declining a switch prompt leaves you on your original tournament, (b) a
// foreground re-check catches a disband the live listener missed while backgrounded, and (c)
// pending-approval polling clears the waiting screen once approved, all without a manual
// page refresh.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('declining the switch prompt keeps the user on their original tournament', async () => {
  const dbStore = {};
  dbStore['shared/OTHER1'] = { ownerId:'friendUid', ownerName:'Friend', members:['friendUid'], pendingRequests:[], memberNames:{friendUid:'Friend'}, followers:[], followerNames:{}, requireApproval:false };
  dbStore['shared/OTHER1/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:[], followerNames:{}, requireApproval:true };
  const { window, triggerAuth } = freshWindow({ dbStore, urlSuffix: 'follow=vj8erz', activeCode: 'OTHER1' });
  window.confirm = () => false; // user declines the "stop watching X, switch to Y?" prompt
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.localStorage.getItem('ballrr_shared_code_v1'), 'OTHER1');
  assert.strictEqual(window.document.getElementById('auth-gate').style.display, 'none', 'gate must still resolve, not hang');
  assert.ok(!(dbStore['shared/VJ8ERZ'].followers||[]).includes('friendUid'), 'must not have joined the declined tournament');
});

test('a foreground re-check catches a disband that the live listener missed while backgrounded', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:['friendUid'], followerNames:{friendUid:'Friend'}, requireApproval:false };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.getActiveSharedCode(), 'VJ8ERZ');

  // Simulate the organizer disbanding while this tab was backgrounded: delete both docs
  // directly, bypassing the live onSnapshot (as if that connection had been suspended).
  delete dbStore['shared/VJ8ERZ'];
  delete dbStore['shared/VJ8ERZ/payload/main'];
  window.refreshSharedMetaNow(); // what the visibilitychange handler calls on foreground
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  assert.strictEqual(window.getActiveSharedCode(), null, 'must be kicked back to private');
  assert.ok(window.__alerts.some(a => a.includes('deleted')));
});

test('pending-approval polling clears the waiting screen once approved, no refresh needed', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:['friendUid'], memberNames:{owner1:'Aaryan',friendUid:'Friend'}, followers:[], followerNames:{}, requireApproval:true };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.isPendingApproval(), true);

  dbStore['shared/VJ8ERZ'].members = ['owner1','friendUid'];
  dbStore['shared/VJ8ERZ'].pendingRequests = [];
  window.refreshSharedMetaNow(); // equivalent to one tick of the 8s poll
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.isPendingApproval(), false);
});

test('a rejected join request is told clearly and returned to private, not left stuck waiting', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:['friendUid'], memberNames:{owner1:'Aaryan',friendUid:'Friend'}, followers:[], followerNames:{}, requireApproval:true };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.isPendingApproval(), true);

  dbStore['shared/VJ8ERZ'].pendingRequests = []; // rejected: removed, never added to members
  window.refreshSharedMetaNow();
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  assert.strictEqual(window.isPendingApproval(), false);
  assert.strictEqual(window.getActiveSharedCode(), null);
  assert.ok(window.__alerts.some(a => a.includes('declined')));
});

test('a genuinely still-pending update does not falsely report a rejection', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:['friendUid'], memberNames:{owner1:'Aaryan',friendUid:'Friend'}, followers:[], followerNames:{}, requireApproval:true };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({teams:[],matches:[]}), updatedAt:1 };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  window.refreshSharedMetaNow(); // nothing changed server-side
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.isPendingApproval(), true);
  assert.ok(!window.__alerts.some(a => a.includes('declined')));
});
