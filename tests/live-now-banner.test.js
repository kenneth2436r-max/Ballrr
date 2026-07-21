'use strict';
// Tests for the deliberate, host-controlled "Live now" system:
//   - liveAnnounced (toggleLiveAnnounced()) -- separate from latestCode/latestStartedAt, which
//     get set automatically the instant a share code is created (possibly well before there's
//     anything worth watching). The organizer has to explicitly flip this on.
//   - liveNowBannerHtml() -- the profile banner, gated on BOTH latestCode and liveAnnounced.
//   - the follower-facing profile grid, which only shows the still-live pointer tile once
//     liveAnnounced is true (previewHostProfile()/showHostPastTournaments()).
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('liveNowBannerHtml renders nothing without a live pointer, or with one that has not been announced yet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.noPointer = liveNowBannerHtml({ hostName:'Aaryan' });
    window.__results.nullCode = liveNowBannerHtml({ latestCode:null, liveAnnounced:true });
    window.__results.nullDoc = liveNowBannerHtml(null);
    window.__results.notAnnounced = liveNowBannerHtml({ latestCode:'ABCD', latestVisibility:'public', latestLabel:'Friday 5-a-side' });
  `);
  assert.strictEqual(r.noPointer, '');
  assert.strictEqual(r.nullCode, '');
  assert.strictEqual(r.nullDoc, '');
  assert.strictEqual(r.notAnnounced, '', 'a share code that exists but was never announced as live should not show the banner');
});

test('liveNowBannerHtml shows a "jump in" banner wired to followSharedTournament once a public tournament is announced live', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.html = liveNowBannerHtml({ latestCode:'ABCD', latestVisibility:'public', latestLabel:'Friday 5-a-side', liveAnnounced:true });
  `);
  assert.ok(r.html.includes('Live now'));
  assert.ok(r.html.includes('Friday 5-a-side'));
  assert.ok(r.html.includes("followSharedTournament('ABCD')"));
  assert.ok(!r.html.includes('private'));
});

test('liveNowBannerHtml shows a "request to view" banner wired to requestFollowApproval once a private tournament is announced live', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.html = liveNowBannerHtml({ latestCode:'WXYZ', latestVisibility:'private', latestLabel:'Sunday League', liveAnnounced:true });
  `);
  assert.ok(r.html.includes('private'));
  assert.ok(r.html.includes('request to view'));
  assert.ok(r.html.includes("requestFollowApproval('WXYZ')"));
});

test('previewHostProfile shows the live-now banner once the host has announced their live tournament', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF',
    followers: [], followerNames: {},
    latestCode: 'LIVE1', latestVisibility: 'public', latestLabel: 'Tonight\'s 5-a-side', latestStartedAt: Date.now(),
    liveAnnounced: true,
    pastTournaments: [],
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="recap-modal" style="display:none"><div id="recap-card-content"></div></div>' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = {};
    window.__testDone = previewHostProfile('ABCDEF');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  const html = window.document.getElementById('recap-card-content').innerHTML;
  assert.ok(html.includes('Live now'));
  assert.ok(html.includes("Tonight's 5-a-side"));
});

test('previewHostProfile shows no live-now banner when the host has a share code but has not announced it as live', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {},
    latestCode: 'LIVE1', latestVisibility: 'public', latestLabel: 'Draft in progress', latestStartedAt: Date.now(),
    pastTournaments: [],
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="recap-modal" style="display:none"><div id="recap-card-content"></div></div>' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = {};
    window.__testDone = previewHostProfile('ABCDEF');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  const html = window.document.getElementById('recap-card-content').innerHTML;
  assert.ok(!html.includes('Live now'), 'creating a share code alone (teams may not even be picked yet) should not announce it as live');
});

test('previewHostProfile\'s tournament grid only shows the live pointer tile once announced, but always shows archived tournaments', async () => {
  const dbStore = {};
  dbStore['hostCodes/ABCDEF'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {},
    latestCode: 'LIVE1', latestVisibility: 'public', latestLabel: 'Draft in progress', latestStartedAt: Date.now(),
    pastTournaments: [
      { code:'LIVE1', label:'Draft in progress', startedAt:Date.now() }, // live pointer, not yet announced, no `archived` flag
      { code:'OLD1', historyId:'h1', label:'Summer Cup', startedAt:1000, archived:true, visibility:'public', snapshot:{table:[],playerStats:[]} },
    ],
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="recap-modal" style="display:none"><div id="recap-card-content"></div></div>' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    state = {};
    window.__testDone = previewHostProfile('ABCDEF');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  const html = window.document.getElementById('recap-card-content').innerHTML;
  assert.ok(html.includes('Summer Cup'), 'the archived tournament should always show in the grid');
  assert.ok(!html.includes('Draft in progress'), 'the unannounced live pointer should not show as a tile yet');
});

test('toggleLiveAnnounced flips the flag for the owner of the active shared tournament, and is a no-op for anyone else', async () => {
  // Both toggles are chained inside one runInOneEval() call: separate window.eval() calls don't
  // share top-level `let` bindings (currentUser/sharedMeta), so a second, standalone eval would
  // see them as unset and toggleLiveAnnounced() would silently no-op via its owner guard. Reading
  // the result back is also done from inside the same eval (via the app's own hostProfileDocRef),
  // since the raw `dbStore` object is only a closure variable in the mock, not a window global.
  const dbStore = { 'hostProfiles/hostUid': { hostName:'Aaryan' } };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid' };
    window.__testDone = (async () => {
      await toggleLiveAnnounced();
      window.__results.afterFirst = (await hostProfileDocRef(currentUser.uid).get()).data().liveAnnounced;
      await toggleLiveAnnounced();
      window.__results.afterSecond = (await hostProfileDocRef(currentUser.uid).get()).data().liveAnnounced;
    })();
  `);
  await window.__testDone;
  const r = window.__results;
  assert.strictEqual(r.afterFirst, true, 'the first toggle should turn it on');
  assert.strictEqual(r.afterSecond, false, 'toggling again should turn it back off');
  assert.strictEqual(dbStore['hostProfiles/hostUid'].liveAnnounced, false, 'the underlying store should reflect the final state');
});

test('toggleLiveAnnounced does nothing for a non-owner (would fail Firestore rules anyway) or when there is no active shared tournament', async () => {
  const dbStore = { 'hostProfiles/hostUid': { hostName:'Aaryan' } };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'someoneElse', displayName:'Someone' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid' };
    window.__testDone = toggleLiveAnnounced();
  `);
  await window.__testDone;
  assert.strictEqual(dbStore['hostProfiles/hostUid'].liveAnnounced, undefined, 'a non-owner should never be able to flip the host\'s own flag');
});

// The organizer's own confirmation, on their OWN Profile tab, that their tournament is currently
// showing as live to followers -- liveNowBannerHtml()/previewHostProfile() only ever cover a
// FOLLOWER looking at someone else, so without this an organizer had no way to see their own
// live state reflected anywhere except by re-opening Settings and checking the toggle button.
test('startMyFollowersListener populates the organizer\'s own "You\'re live" banner once liveAnnounced is on', () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', followers: [], followerNames: {},
    latestCode: 'LIVE1', latestVisibility: 'public', latestLabel: 'Friday 5-a-side', latestStartedAt: Date.now(),
    liveAnnounced: true,
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="my-live-banner"></div><div id="profile-stats-bar"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [], careerSnapshotSaved: true };
    startMyFollowersListener();
  `);
  const html = window.document.getElementById('my-live-banner').innerHTML;
  assert.ok(html.includes("You're live"));
  assert.ok(html.includes('Friday 5-a-side'));
  assert.ok(!html.includes('private'));
});

test('the organizer\'s own live banner stays empty with a share code but no announcement, and clears again once liveAnnounced is turned off', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', followers: [], followerNames: {},
    latestCode: 'LIVE1', latestVisibility: 'public', latestLabel: 'Draft in progress', latestStartedAt: Date.now(),
  };
  const { window } = freshWindow({ dbStore, extraHtml: '<div id="my-live-banner"></div><div id="profile-stats-bar"></div>' });
  // Everything (initial no-announcement check, then toggling on and off) is chained inside ONE
  // eval() call -- a second, separate eval() call would see a fresh top-level `myLiveAnnounced`/
  // `myLatestCode`, reset to their APP_SRC initial values, per the harness's documented quirk.
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [], careerSnapshotSaved: true };
    window.__testDone = (async () => {
      startMyFollowersListener();
      window.__results.beforeAnnounce = document.getElementById('my-live-banner').innerHTML;
      await hostProfileDocRef('hostUid').set({ liveAnnounced:true }, { merge:true });
      window.__results.afterOn = document.getElementById('my-live-banner').innerHTML;
      await hostProfileDocRef('hostUid').set({ liveAnnounced:false }, { merge:true });
      window.__results.afterOff = document.getElementById('my-live-banner').innerHTML;
    })();
  `);
  await window.__testDone;
  const r = window.__results;
  assert.strictEqual(r.beforeAnnounce, '', 'creating a share code alone should not show the organizer their own live banner either');
  assert.ok(r.afterOn.includes("You're live"));
  assert.strictEqual(r.afterOff, '', 'turning liveAnnounced back off should clear the organizer\'s own banner too');
});
