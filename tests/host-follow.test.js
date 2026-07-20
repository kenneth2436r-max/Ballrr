'use strict';
// Tests for the host-level follow system: following a PERSON (not a single tournament code)
// and getting notified whenever they start a new tournament, with public/private visibility
// gating how a follower can access it. See ensureHostCode/followHost/startHostFollowListener/
// openFollowedHostNotice/requestFollowApproval in the app source.
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
  return FakeNotification;
}

test('ensureHostCode creates a followable profile once and reuses the same code afterward', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `currentUser = { uid:'hostUid', displayName:'Aaryan' };`);
  const code1 = await window.ensureHostCode();
  const code2 = await window.ensureHostCode();
  assert.strictEqual(code1, code2, 'the host code must never change once created');
  assert.ok(dbStore['hostCodes/' + code1], 'a lookup doc must exist for the code');
  assert.strictEqual(dbStore['hostCodes/' + code1].uid, 'hostUid');
  assert.strictEqual(dbStore['hostProfiles/hostUid'].hostCode, code1);
  // .length check instead of deepStrictEqual against a Node-realm [] literal -- the array on
  // the right was constructed inside the jsdom window's own realm (a different Array
  // constructor/prototype than this test file's), which deepStrictEqual treats as not
  // reference-equal even though the contents are identical. Same cross-realm gotcha the
  // rotational-player tests work around with Array.from(...).
  assert.strictEqual((dbStore['hostProfiles/hostUid'].followers || []).length, 0);
});

test('followHost resolves a host code, adds this device as a follower, and remembers it locally', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {} };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `currentUser = { uid:'followerUid', displayName:'Fan' }; state = {};`);
  window.followHost('ABCDEF');
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok((dbStore['hostProfiles/hostUid'].followers || []).includes('followerUid'));
  const stored = JSON.parse(window.localStorage.getItem('ballrr_followed_host_v1'));
  assert.strictEqual(stored.hostUid, 'hostUid');
  assert.strictEqual(stored.hostCode, 'ABCDEF');
  assert.strictEqual(stored.hostName, 'Aaryan');
});

test('starting a PUBLIC tournament updates the host\'s profile pointer that followers listen to', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { teamNames:['Red','Blue'] };
    startSharingTournament(false, true);
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const profile = dbStore['hostProfiles/hostUid'];
  assert.ok(profile, 'starting a share while public should create/update the host profile');
  assert.strictEqual(profile.latestVisibility, 'public');
  assert.ok(profile.latestCode);
  assert.ok(profile.latestStartedAt > 0);
});

test('starting a PRIVATE tournament still updates the host profile, just marked private', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { teamNames:['Red','Blue'] };
    startSharingTournament(false, false);
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.strictEqual(dbStore['hostProfiles/hostUid'].latestVisibility, 'private');
  assert.strictEqual(dbStore['shared/' + dbStore['hostProfiles/hostUid'].latestCode].visibility, 'private');
});

test('a follower\'s listener detects a newly-live PUBLIC tournament: banner + notification fire, tapping it grants instant view access', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: ['followerUid'], followerNames: { followerUid: 'Fan' } };
  const { window } = freshWindow({ dbStore });
  window.localStorage.setItem('ballrr_followed_host_v1', JSON.stringify({ hostUid: 'hostUid', hostCode: 'ABCDEF', hostName: 'Aaryan', lastSeenStartedAt: 0 }));
  withFakeNotification(window, 'granted');

  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = { notificationsEnabled:true };
    followedHost = getFollowedHost();
    startHostFollowListener();
  `);
  for(let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

  dbStore['shared/NEWCODE'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: {}, pendingFollowerRequests: [], requireApproval: false, visibility: 'public' };
  dbStore['shared/NEWCODE/payload/main'] = { data: JSON.stringify({ teamNames: ['Red', 'Blue'], matches: [] }), updatedAt: 1 };
  await window.hostProfileDocRef('hostUid').set({ latestCode: 'NEWCODE', latestVisibility: 'public', latestStartedAt: Date.now(), latestLabel: 'Red vs Blue' }, { merge: true });
  for(let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

  window.renderSharedSection();
  const html = window.document.getElementById('shared-container').innerHTML;
  assert.ok(html.includes('just went live'), 'the went-live banner should render');
  assert.ok(html.includes('View now'), 'a public tournament should offer instant access, not a request');
  assert.strictEqual(window.Notification.__instances.length, 1);
  assert.ok(window.Notification.__instances[0].title.includes('Aaryan'));

  window.openFollowedHostNotice();
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok((dbStore['shared/NEWCODE'].followers || []).includes('followerUid'), 'tapping a public notice should grant immediate follower access');
});

test('a follower\'s listener detects a newly-live PRIVATE tournament: tapping it only requests access, pending organizer approval', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: ['followerUid'], followerNames: { followerUid: 'Fan' } };
  dbStore['shared/PRIVCODE'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: {}, pendingFollowerRequests: [], requireApproval: false, visibility: 'private' };
  dbStore['shared/PRIVCODE/payload/main'] = { data: JSON.stringify({ teamNames: ['Red', 'Blue'], matches: [] }), updatedAt: 1 };
  const { window } = freshWindow({ dbStore });
  window.localStorage.setItem('ballrr_followed_host_v1', JSON.stringify({ hostUid: 'hostUid', hostCode: 'ABCDEF', hostName: 'Aaryan', lastSeenStartedAt: 0 }));
  withFakeNotification(window, 'granted');

  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = { notificationsEnabled:true };
    followedHost = getFollowedHost();
    startHostFollowListener();
  `);
  for(let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

  await window.hostProfileDocRef('hostUid').set({ latestCode: 'PRIVCODE', latestVisibility: 'private', latestStartedAt: Date.now(), latestLabel: 'Red vs Blue' }, { merge: true });
  for(let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

  window.renderSharedSection();
  const html = window.document.getElementById('shared-container').innerHTML;
  assert.ok(html.includes('Ask to view'), 'a private tournament should ask to request access, not grant it instantly');

  window.openFollowedHostNotice();
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok((dbStore['shared/PRIVCODE'].pendingFollowerRequests || []).includes('followerUid'), 'should be queued for approval');
  assert.ok(!(dbStore['shared/PRIVCODE'].followers || []).includes('followerUid'), 'must not get view access before the organizer approves');
});

// Regression test for: a brand-new follower tapping a ?followhost= direct link (see
// followHostLinkUrl()/consumePendingFollowHost()) seeing "This tournament is no longer
// available" even though the host has nothing live right now. Root cause: hostProfiles'
// latestCode/latestVisibility/latestStartedAt/latestLabel are set once by
// startSharingTournament() but were never cleared when the host later disbanded that session,
// so they kept pointing at a deleted shared/{code} doc. clearLatestLiveFromHostProfile() now
// cleans this up on disband going forward, but consumePendingFollowHost() also defensively
// re-checks the doc actually exists before redirecting -- belt and braces, since a first-time
// follow should never surface a scary dead-link alert just because nothing's live right now.
test('consumePendingFollowHost silently skips a stale/dead latestCode instead of surfacing "no longer available"', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {},
    latestCode: 'DEADCODE', latestVisibility: 'public', latestStartedAt: Date.now(), latestLabel: 'Old tournament',
  };
  // Deliberately NOT populating dbStore['shared/DEADCODE'] -- simulates a disbanded session
  // whose latestCode pointer was never cleaned up (the exact bug this test guards against).
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = {};
    pendingFollowHostCode = 'ABCDEF';
    window.__followHostDone = consumePendingFollowHost();
  `);
  await window.__followHostDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok(!window.__alerts.some(m => m.includes('no longer available')), 'a first-time follow must never surface the dead-session alert');
  assert.ok((dbStore['hostProfiles/hostUid'].followers || []).includes('followerUid'), 'the host follow itself should still succeed');
});

// Regression test for: a visitor tapping a ?followhost= link, following successfully, but
// landing on their OWN unrelated tournament with no indication anything happened or where to
// find the host's actual archive -- looked exactly like "the follow link is broken" even though
// the follow itself worked. consumePendingFollowHost() now auto-opens the same "Past
// tournaments" list the "Browse their past tournaments" button opens whenever there's nothing
// currently live to jump into instead.
test('consumePendingFollowHost auto-opens the host\'s past tournaments list when nothing is live, instead of leaving the visitor on their own unrelated tournament', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {},
    // No latestCode at all -- this host has archived tournaments but nothing currently live.
    pastTournaments: [
      { code: 'CODE1', historyId: 'hist1', label: 'Summer Cup', startedAt: 1000, visibility: 'public', archived: true, snapshot: { table: [], playerStats: [] } },
    ],
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = {};
    pendingFollowHostCode = 'ABCDEF';
    window.__followHostDone = consumePendingFollowHost();
  `);
  await window.__followHostDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const html = window.document.getElementById('recap-card-content').innerHTML;
  assert.ok(html.includes('Summer Cup'), 'the host\'s past tournaments list should be showing, not left closed');
});

test('the organizer can approve a pending follower request, granting view access and clearing the queue', async () => {
  const dbStore = {};
  dbStore['shared/PRIVCODE'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: { followerUid: 'Fan' }, pendingFollowerRequests: ['followerUid'], requireApproval: false, visibility: 'private' };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'PRIVCODE', ownerId:'hostUid', ownerName:'Aaryan', members:['hostUid'], pendingRequests:[], memberNames:{hostUid:'Aaryan'}, followers:[], followerNames:{followerUid:'Fan'}, pendingFollowerRequests:['followerUid'], requireApproval:false, visibility:'private' };
    approveFollowerRequest('followerUid');
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok((dbStore['shared/PRIVCODE'].followers || []).includes('followerUid'));
  assert.ok(!(dbStore['shared/PRIVCODE'].pendingFollowerRequests || []).includes('followerUid'));
});
