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

// Regression coverage for: sharing a brand new tournament used to always require a SEPARATE
// second trip to Settings to tap "Go live for followers" (toggleLiveAnnounced()) before existing
// followers could see it -- repetitive for a host who already has followers and shares often.
// startSharingTournament()'s new 3rd `andGoLive` param collapses that into one action; the
// existing "Share (open)"/"Share (approval)" buttons still call it with only 2 args, so they're
// unaffected and still default to NOT live-announcing right away.
test('startSharingTournament(andGoLive=true) shares AND announces live in one step, skipping the separate toggle', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { teamNames:['Red','Blue'] };
    startSharingTournament(false, true, true);
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(dbStore['hostProfiles/hostUid'].liveAnnounced, true, 'andGoLive should skip straight to announced-live, no separate toggle needed');
});

test('startSharingTournament without andGoLive still defaults to NOT live-announced (existing Share buttons are unaffected)', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { teamNames:['Red','Blue'] };
    startSharingTournament(false, true);
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(dbStore['hostProfiles/hostUid'].liveAnnounced, false);
});

test('renderSharedSection offers a one-tap "Go live for followers" button before any tournament has been shared yet', () => {
  const { window } = freshWindow({ extraHtml: '<div id="shared-container"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { mode:'friendly' };
    sharedMeta = null;
    renderSharedSection();
  `);
  const html = window.document.getElementById('shared-container').innerHTML;
  assert.ok(html.includes('Go live for followers'));
  assert.ok(html.includes('startSharingTournament(false,document.getElementById(\'shared-visibility-public\').checked,true)'), 'the one-tap button should pass andGoLive=true');
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

// Regression test for: a brand-new follower tapping a ?followhost= direct link used to be
// auto-followed instantly with no say in the matter. It now previews the host's profile first
// (Instagram-style) -- stats bar, tournament grid, a Follow button -- and only actually follows
// once the visitor taps Follow (see followHostFromPreview() below).
test('consumePendingFollowHost previews the host\'s profile with a Follow button instead of auto-following them', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {},
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
  assert.ok(!window.__alerts.some(m => m.includes('no longer available')), 'opening a follow link must never surface the dead-session alert');
  assert.ok(html.includes('Follow'), 'a Follow button should be offered instead of following automatically');
  assert.ok(html.includes('Summer Cup'), 'the host\'s public archive should already be visible in the preview, before following');
  assert.ok(!(dbStore['hostProfiles/hostUid'].followers || []).includes('followerUid'), 'previewing a profile must not add the visitor as a follower yet');
});

// Regression test for: a brand-new follower tapping Follow inside the preview seeing "This
// tournament is no longer available" even though the host has nothing live right now. Root
// cause: hostProfiles' latestCode/latestVisibility/latestStartedAt/latestLabel are set once by
// startSharingTournament() but were never cleared when the host later disbanded that session, so
// they kept pointing at a deleted shared/{code} doc. clearLatestLiveFromHostProfile() now cleans
// this up on disband going forward, but afterFollowHostContinue() also defensively re-checks the
// doc actually exists before redirecting -- belt and braces, since a first-time follow should
// never surface a scary dead-link alert just because nothing's live right now.
test('followHostFromPreview registers the follow, then silently skips a stale/dead latestCode instead of surfacing "no longer available"', async () => {
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
    window.__followHostDone = followHostFromPreview('ABCDEF');
  `);
  await window.__followHostDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok(!window.__alerts.some(m => m.includes('no longer available')), 'a first-time follow must never surface the dead-session alert');
  assert.ok((dbStore['hostProfiles/hostUid'].followers || []).includes('followerUid'), 'the host follow itself should still succeed');
});

// Regression test for: a visitor following successfully but landing on their OWN unrelated
// tournament with no indication anything happened or where to find the host's actual archive --
// looked exactly like "the follow link is broken" even though the follow itself worked.
// followHostFromPreview() (via afterFollowHostContinue()) now auto-opens the same "Past
// tournaments" list the "Browse their past tournaments" button opens whenever there's nothing
// currently live to jump into instead.
test('followHostFromPreview auto-opens the host\'s past tournaments list when nothing is live, instead of leaving the visitor on their own unrelated tournament', async () => {
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
    window.__followHostDone = followHostFromPreview('ABCDEF');
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

// Regression coverage for: the organizer's own Profile tab never showed a Followers count at
// all, and none of the stats (Tournaments/Players/Trophies/Followers) could be tapped for more
// detail. startMyFollowersListener() keeps myFollowersList live from this device's own
// hostProfiles doc; showProfileFollowers()/showProfileTrophies() are what tapping those two
// stats opens (Tournaments/Players just switch the existing Grid/Career pills).
test('startMyFollowersListener keeps the Profile tab\'s Followers stat live, and tapping it lists their names', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF',
    followers: ['f1', 'f2'], followerNames: { f1: 'Amy', f2: 'Zed' },
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="profile-stats-bar"></div><div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  // startMyFollowersListener() and showProfileFollowers() must run inside the SAME eval() call --
  // showProfileFollowers() reads the top-level `myFollowersList` the listener just updated, and
  // separate window.eval() calls don't share top-level `let` bindings (see harness.js's note).
  // The mock onSnapshot() fires its first callback synchronously, so no tick-wait is needed
  // between the two calls.
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [], careerSnapshotSaved: true };
    startMyFollowersListener();
    showProfileFollowers();
  `);

  const statsHtml = window.document.getElementById('profile-stats-bar').innerHTML;
  assert.ok(statsHtml.includes('Followers'), 'a Followers stat should be shown alongside Tournaments/Players/Trophies');
  assert.ok(statsHtml.includes('showProfileFollowers()'), 'the Followers stat should be tappable');
  assert.ok(statsHtml.includes('showProfileTrophies()'), 'the Trophies stat should be tappable');

  const listHtml = window.document.getElementById('player-card-content').innerHTML;
  assert.ok(listHtml.includes('Amy') && listHtml.includes('Zed'), 'the follower list should name each follower');
  assert.strictEqual(window.document.getElementById('player-card-modal').style.display, 'flex');
});

// Same idea, follower-facing side: previewing a host's profile should let a visitor tap
// Trophies/Followers too, sourced from the published snapshot data instead of local state.
test('previewHostProfile makes the host\'s Trophies and Followers stats tappable for a visitor', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF',
    followers: ['f1'], followerNames: { f1: 'Amy' },
    pastTournaments: [
      { code: 'CODE1', historyId: 'h1', label: 'Summer Cup', startedAt: 1000, visibility: 'public', archived: true,
        snapshot: { table: [], playerStats: [{ name: 'Vaibhav', team: 'FC Sherin', avg: 9, count: 3, goals: 5, assists: 3, cleanSheets: 0 }] } },
    ],
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="player-card-modal" style="display:none"><div id="player-card-content"></div></div>' });
  // previewHostProfile()/showHostFollowersList()/showHostTrophies() must all run inside the SAME
  // eval() call -- the latter two read lastHostFollowerNames/lastPastTournamentsList, which
  // previewHostProfile() sets as top-level `let` bindings only visible within that same eval
  // (see harness.js's note on why separate eval() calls don't share them). Captured into window
  // properties between calls since each call overwrites #player-card-content's innerHTML.
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = {};
    window.__testDone = (async () => {
      await previewHostProfile('ABCDEF');
      showHostFollowersList();
      window.__followersHtml = document.getElementById('player-card-content').innerHTML;
      showHostTrophies();
      window.__trophiesHtml = document.getElementById('player-card-content').innerHTML;
    })();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  assert.ok(window.__followersHtml.includes('Amy'), 'the host\'s follower list should be shown to a visitor');
  assert.ok(window.__trophiesHtml.includes('Vaibhav'), 'the host\'s trophy cabinet should be shown to a visitor');
});
