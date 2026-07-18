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

// Regression test for: "when i disband a tournament for everyone the tournament also gets
// deleted from the archive section". Root cause: a shared tournament's archived history
// (state.tournamentHistory) lives inside the SAME payload doc that disbanding deletes, so
// wiping the live shared tournament used to wipe its whole archive too. Fixed by
// preserveSharedHistoryOnDisband() copying tournamentHistory into the organizer's own private
// tournament doc before the shared docs are deleted.
test('disbanding a shared tournament preserves its archived history into the organizer\'s own private archive', async () => {
  const dbStore = {};
  const sharedState = {
    numTeams: 2, legs: 1, formatType: 'league',
    tournamentHistory: [
      { id: 't1', label: 'Summer Cup', date: '2026-01-01', playerStats: [{ name: 'Densil', team: 'Team A', goals: 3, assists: 1, cleanSheets: 0 }] }
    ]
  };
  dbStore['shared/VJ8ERZ'] = { ownerId: 'owner1', ownerName: 'Aaryan', members: ['owner1'], pendingRequests: [], memberNames: { owner1: 'Aaryan' }, followers: [], followerNames: {}, requireApproval: false };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify(sharedState), updatedAt: 1 };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'owner1', displayName: 'Aaryan' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.strictEqual(window.getActiveSharedCode(), 'VJ8ERZ');

  window.disbandSharedTournament(); // window.confirm defaults to true -- see freshWindow()
  for(let i=0;i<20;i++) await new Promise(r=>setTimeout(r,0));

  assert.ok(!dbStore['shared/VJ8ERZ'], 'shared metadata doc should be gone');
  assert.ok(!dbStore['shared/VJ8ERZ/payload/main'], 'shared payload doc should be gone');
  const privateDoc = dbStore['tournaments/owner1'];
  assert.ok(privateDoc, 'organizer should have a private tournament doc after disbanding');
  const privateState = JSON.parse(privateDoc.data);
  const preserved = (privateState.tournamentHistory || []).find(t => t.id === 't1');
  assert.ok(preserved, 'the archived tournament from the disbanded shared session must survive in the private archive, not be deleted along with the live tournament');
  assert.strictEqual(preserved.label, 'Summer Cup');
});

test('disbanding merges into an existing private archive without duplicating or losing entries already there', async () => {
  const dbStore = {};
  dbStore['tournaments/owner1'] = { data: JSON.stringify({ tournamentHistory: [{ id: 'old1', label: 'Old Cup', date: '2025-12-01', playerStats: [] }] }), updatedAt: 1 };
  const sharedState = {
    numTeams: 2, legs: 1, formatType: 'league',
    tournamentHistory: [
      { id: 'old1', label: 'Old Cup', date: '2025-12-01', playerStats: [] }, // same tournament, already private -- must not duplicate
      { id: 't2', label: 'Winter Cup', date: '2026-02-01', playerStats: [] }
    ]
  };
  dbStore['shared/VJ8ERZ'] = { ownerId: 'owner1', ownerName: 'Aaryan', members: ['owner1'], pendingRequests: [], memberNames: { owner1: 'Aaryan' }, followers: [], followerNames: {}, requireApproval: false };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify(sharedState), updatedAt: 1 };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'VJ8ERZ' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'owner1', displayName: 'Aaryan' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  window.disbandSharedTournament();
  for(let i=0;i<20;i++) await new Promise(r=>setTimeout(r,0));

  const privateState = JSON.parse(dbStore['tournaments/owner1'].data);
  assert.strictEqual(privateState.tournamentHistory.filter(t => t.id === 'old1').length, 1, 'must not duplicate a tournament that was already archived privately');
  assert.ok(privateState.tournamentHistory.some(t => t.id === 't2'), 'the newly-archived tournament from the shared session must be added');
  assert.strictEqual(privateState.tournamentHistory.length, 2);
});
