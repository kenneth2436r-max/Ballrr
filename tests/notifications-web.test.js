'use strict';
// Web (browser Notification API) push-style notification tests: gating, goal/full-time,
// league kickoff, and join-request/organizer-only scoping.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function withFakeNotification(window, permission){
  class FakeNotification {
    constructor(title, opts){ this.title = title; this.opts = opts; FakeNotification.__instances.push(this); }
  }
  FakeNotification.__instances = [];
  FakeNotification.permission = permission;
  window.Notification = FakeNotification;
  window.__instances = FakeNotification.__instances;
  return FakeNotification;
}

test('fires when permission is granted and the toggle is on; stops when toggled off', () => {
  const { window } = freshWindow();
  withFakeNotification(window, 'granted');
  const r = runInOneEval(window, `
    state = {notificationsEnabled:true};
    fireOsNotification('Title','Body',{tag:'x'});
    window.__results.afterOn = window.__instances.length;
    state.notificationsEnabled = false;
    fireOsNotification('Title2','Body2',{tag:'y'});
    window.__results.afterOff = window.__instances.length;
  `);
  assert.strictEqual(r.afterOn, 1);
  assert.strictEqual(r.afterOff, 1, 'toggling off must not fire another notification');
  assert.strictEqual(window.__instances[0].title, 'Title');
  assert.strictEqual(window.__instances[0].opts.body, 'Body');
});

test('does not fire when permission is only "default" (not yet granted)', () => {
  const { window } = freshWindow();
  withFakeNotification(window, 'default');
  runInOneEval(window, `state={notificationsEnabled:true}; fireOsNotification('T','B',{tag:'x'});`);
  assert.strictEqual(window.__instances.length, 0);
});

test('goal and full-time events each fire one OS notification with the right title', () => {
  const { window } = freshWindow();
  withFakeNotification(window, 'granted');
  const r = runInOneEval(window, `
    state = {notificationsEnabled:true};
    const oldSt = { fixtures:[[0,1]], teamNames:{0:'Reds',1:'Blues'}, results:[{events:[],timer:{running:false,accumulatedMs:0}}] };
    const newSt = { fixtures:[[0,1]], teamNames:{0:'Reds',1:'Blues'}, results:[{events:[
      {type:'goal',name:'Devyanee',teamName:'Reds',oppTeamName:'Blues',forScore:1,againstScore:0},
      {type:'fulltime',teamAName:'Reds',teamBName:'Blues',scoreA:1,scoreB:0}
    ],timer:{running:false,accumulatedMs:0}}] };
    diffAndQueueCommentary(oldSt,newSt);
    window.__results.count = window.__instances.length;
    window.__results.titles = window.__instances.map(n=>n.title);
  `);
  assert.strictEqual(r.count, 2);
  assert.ok(r.titles[0].includes('Goal'));
  assert.ok(r.titles[1].includes('Full-time'));
});

test('league kickoff fires once on fresh start, not again on resume from pause', () => {
  const { window } = freshWindow();
  withFakeNotification(window, 'granted');
  const r = runInOneEval(window, `
    state = {notificationsEnabled:true};
    const oldSt = { fixtures:[[0,1],[0,2]], teamNames:{0:'Reds',1:'Blues',2:'Greens'}, results:[
      {timer:{running:false,accumulatedMs:0}}, {timer:{running:false,accumulatedMs:0}}
    ] };
    const newSt = { fixtures:[[0,1],[0,2]], teamNames:{0:'Reds',1:'Blues',2:'Greens'}, results:[
      {timer:{running:true,accumulatedMs:0,startedAt:Date.now()}}, {timer:{running:false,accumulatedMs:0}}
    ] };
    diffAndNotifyKickoffs(oldSt,newSt);
    window.__results.afterKickoff = window.__instances.length;
    window.__results.body0 = window.__instances[0] ? window.__instances[0].opts.body : null;

    const resumedOld = { fixtures:[[0,1]], teamNames:{0:'Reds',1:'Blues'}, results:[{timer:{running:false,accumulatedMs:400000}}] };
    const resumedNew = { fixtures:[[0,1]], teamNames:{0:'Reds',1:'Blues'}, results:[{timer:{running:true,accumulatedMs:400000,startedAt:Date.now()}}] };
    diffAndNotifyKickoffs(resumedOld,resumedNew);
    window.__results.afterResume = window.__instances.length;
  `);
  assert.strictEqual(r.afterKickoff, 1);
  assert.ok(r.body0.includes('Reds') && r.body0.includes('Blues'));
  assert.strictEqual(r.afterResume, 1, 'resuming a paused match must not re-fire the kickoff notification');
});

test('join request notifies the organizer only, and started-following notifies the organizer', () => {
  const { window } = freshWindow();
  withFakeNotification(window, 'granted');
  const r = runInOneEval(window, `
    currentUser = { uid:'ownerUid', displayName:'Aaryan' };
    sharedMeta = { code:'ABC123', ownerId:'ownerUid', ownerName:'Aaryan', members:['ownerUid'], pendingRequests:[], memberNames:{ownerUid:'Aaryan'}, followers:[], followerNames:{}, requireApproval:true };
    state = {notificationsEnabled:true};
    const joinDoc = { exists:true, data:()=>({ ownerId:'ownerUid', ownerName:'Aaryan', members:['ownerUid'], pendingRequests:['newGuyUid'], memberNames:{ownerUid:'Aaryan',newGuyUid:'New Guy'}, followers:[], followerNames:{}, requireApproval:true }) };
    handleSharedMetaSnap('ABC123', joinDoc);
    window.__results.afterJoin = window.__instances.length;
    window.__results.joinBody = window.__instances[0].opts.body;

    const followDoc = { exists:true, data:()=>({ ownerId:'ownerUid', ownerName:'Aaryan', members:['ownerUid'], pendingRequests:['newGuyUid'], memberNames:{ownerUid:'Aaryan',newGuyUid:'New Guy'}, followers:['fanUid'], followerNames:{fanUid:'Devyanee'}, requireApproval:true }) };
    handleSharedMetaSnap('ABC123', followDoc);
    window.__results.afterFollow = window.__instances.length;
    window.__results.followTitle = window.__instances[1].title;
    window.__results.followBody = window.__instances[1].opts.body;
  `);
  assert.strictEqual(r.afterJoin, 1);
  assert.ok(r.joinBody.includes('New Guy'));
  assert.strictEqual(r.afterFollow, 2);
  assert.ok(r.followTitle.includes('follower'));
  assert.ok(r.followBody.includes('Devyanee'));
});

test('a non-owner member is not notified about someone else\'s join request', () => {
  const { window } = freshWindow();
  withFakeNotification(window, 'granted');
  const r = runInOneEval(window, `
    currentUser = { uid:'memberUid', displayName:'Some Member' };
    sharedMeta = { code:'ABC123', ownerId:'ownerUid', ownerName:'Aaryan', members:['ownerUid','memberUid'], pendingRequests:[], memberNames:{}, followers:[], followerNames:{}, requireApproval:true };
    state = {notificationsEnabled:true};
    const dbDoc = { exists:true, data:()=>({ ownerId:'ownerUid', ownerName:'Aaryan', members:['ownerUid','memberUid'], pendingRequests:['newGuyUid'], memberNames:{newGuyUid:'New Guy'}, followers:[], followerNames:{}, requireApproval:true }) };
    handleSharedMetaSnap('ABC123', dbDoc);
    window.__results.count = window.__instances.length;
  `);
  assert.strictEqual(r.count, 0);
});
