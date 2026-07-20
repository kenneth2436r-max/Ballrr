'use strict';
// Regression tests for: "my followers can only see first 2 tournaments... they should be able
// to see every tournament whether it is being played or has been played (& saved) unless it is
// a private tournament". Root cause: hostProfiles.pastTournaments only ever grew once per NEW
// share code (startSharingTournament()) -- a host who keeps reusing the same shared session
// across many separate tournaments (archive one, reset, play the next) only ever produced one
// entry per session, no matter how many tournaments were actually archived inside it. Fixed by
// publishArchivedTournamentToFollowers()/unpublishArchivedTournamentFromFollowers(), called from
// saveTournamentToHistory()/deleteHistoryEntry(), so every archived tournament gets its own
// entry regardless of how many share codes the host has ever used.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('publishArchivedTournamentToFollowers adds a distinct entry for the organizer, tagged archived, with the snapshot embedded', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: ['followerUid'], followerNames: {}, pastTournaments: [] };
  const { window } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'CODE1', ownerId:'hostUid', ownerName:'Aaryan', visibility:'public' };
  `);
  const snapshot = { numTeams: 2, legs: 1, teamNames: ['Red', 'Blue'], table: [{ name: 'Red', p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 1, gd: 1, pts: 3 }], playerStats: [{ name: 'Densil', team: 'Red', avg: 7.5, goals: 2, assists: 0 }], synergy: [{ a: 'Densil', b: 'Sam', output: 9 }] };
  await window.publishArchivedTournamentToFollowers('hist1', 'Summer Cup', '2026-07-01', snapshot);
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].historyId, 'hist1');
  assert.strictEqual(list[0].label, 'Summer Cup');
  assert.strictEqual(list[0].code, 'CODE1');
  assert.strictEqual(list[0].archived, true);
  assert.strictEqual(list[0].visibility, 'public');
  // The snapshot must be embedded directly in the entry -- this is what lets a follower view it
  // later without needing shared/{code} to still exist (see the "no longer available" fix).
  assert.ok(list[0].snapshot, 'the tournament snapshot must be embedded in the published entry');
  assert.strictEqual(list[0].snapshot.table[0].name, 'Red');
  assert.strictEqual(list[0].snapshot.playerStats[0].name, 'Densil');
  assert.strictEqual(list[0].snapshot.synergy, undefined, 'synergy is deliberately dropped to keep the hostProfiles doc smaller');
});

// Privacy check: hostProfiles is readable by ANY signed-in user (no per-follower approval gate
// at that level), so a PRIVATE tournament's data must never be embedded there -- only public
// tournaments get the snapshot treatment. Private ones keep the old pointer-only behavior, still
// gated behind the approval flow (and so still going dark if the session is later disbanded --
// an accepted, narrower tradeoff documented in publishArchivedTournamentToFollowers()).
test('publishArchivedTournamentToFollowers does NOT embed a snapshot for a private tournament', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {}, pastTournaments: [] };
  const { window } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'CODE1', ownerId:'hostUid', ownerName:'Aaryan', visibility:'private' };
  `);
  const snapshot = { numTeams: 2, legs: 1, teamNames: ['Red', 'Blue'], table: [{ name: 'Red' }], playerStats: [{ name: 'Densil' }] };
  await window.publishArchivedTournamentToFollowers('hist1', 'Private Cup', '2026-07-01', snapshot);
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list[0].visibility, 'private');
  assert.strictEqual(list[0].snapshot, null, 'a private tournament must never have its data embedded in the freely-readable hostProfiles doc');
});

// Since a private archived entry has no snapshot, viewing it must fall back to the old
// approval-gated flow (requestFollowApproval), not silently show nothing or leak data.
test('viewing a private archived entry (no snapshot) falls back to requesting approval via its code', async () => {
  const dbStore = {};
  dbStore['shared/CODE1'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: {}, pendingFollowerRequests: [], requireApproval: false, visibility: 'private' };
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan',
    pastTournaments: [
      { code: 'CODE1', historyId: 'hist1', label: 'Private Cup', startedAt: 1000, visibility: 'private', archived: true, snapshot: null },
    ],
  };
  const { window } = freshWindow({ dbStore });
  // showHostPastTournaments() is the only way to correctly populate the closure-scoped
  // lastPastTournamentsList that viewHostPastTournament() reads from -- it's declared with `let`
  // inside the app's window.eval()'d source, so assigning window.lastPastTournamentsList directly
  // from outside creates an unrelated shadow property the real function never sees.
  window.localStorage.setItem('ballrr_followed_host_v1', JSON.stringify({ hostUid: 'hostUid', hostCode: 'ABCDEF', hostName: 'Aaryan', lastSeenStartedAt: 0 }));
  runInOneEval(window, `followedHost = getFollowedHost(); currentUser = { uid:'followerUid', displayName:'Fan' };`);
  await window.showHostPastTournaments();
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  await window.viewHostPastTournament('CODE1', 'private', 'hist1');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  assert.ok((dbStore['shared/CODE1'].pendingFollowerRequests || []).includes('followerUid'), 'should fall back to the approval request flow since there is no snapshot to show directly');
});

test('publishArchivedTournamentToFollowers prepends, so multiple archived tournaments under the same code all show up', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {}, pastTournaments: [{ code:'CODE1', historyId:'hist1', label:'Tournament 1', archived:true, visibility:'public' }] };
  const { window } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'CODE1', ownerId:'hostUid', ownerName:'Aaryan', visibility:'public' };
  `);
  await window.publishArchivedTournamentToFollowers('hist2', 'Tournament 2', '2026-07-08');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list.length, 2, 'a SECOND tournament archived under the same share code must be a SEPARATE entry, not replace the first');
  assert.ok(list.some(t=>t.historyId==='hist1'));
  assert.ok(list.some(t=>t.historyId==='hist2'));
});

// Regression test for: "but again I have 4 tournaments in total so why do the followers only
// see 2?" -- root cause: publishArchivedTournamentToFollowers() used to require an ACTIVE shared
// session (getActiveSharedCode() + sharedMeta) to do anything at all, so any tournament saved
// while not currently live-sharing (the common case) silently never reached followers, no matter
// how many times "Save Tournament" was used. It now always publishes the signed-in user's own
// local saves too, defaulting to public.
test('publishArchivedTournamentToFollowers still publishes a purely local save with no active shared session -- defaults to public, since it is the signed-in user\'s own data', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {}, pastTournaments: [] };
  const { window } = freshWindow({ dbStore }); // no activeCode
  runInOneEval(window, `currentUser = { uid:'hostUid', displayName:'Aaryan' }; sharedMeta = null;`);
  const snapshot = { numTeams: 2, legs: 1, teamNames: ['Red', 'Blue'], table: [{ name: 'Red' }], playerStats: [{ name: 'Densil' }] };
  await window.publishArchivedTournamentToFollowers('hist1', 'Solo save', '2026-07-01', snapshot);
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list.length, 1, 'a tournament saved with no live share session active must still reach followers');
  assert.strictEqual(list[0].historyId, 'hist1');
  assert.strictEqual(list[0].visibility, 'public');
  assert.ok(list[0].snapshot, 'defaulting to public means the snapshot should be embedded');
});

test('publishArchivedTournamentToFollowers does nothing for a non-owner member (would fail Firestore rules anyway)', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {}, pastTournaments: [] };
  const { window } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, `
    currentUser = { uid:'coEditorUid', displayName:'Co-editor' };
    sharedMeta = { code:'CODE1', ownerId:'hostUid', ownerName:'Aaryan', visibility:'public' };
  `);
  await window.publishArchivedTournamentToFollowers('hist1', 'Not mine to publish', '2026-07-01');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.deepStrictEqual(Array.from(dbStore['hostProfiles/hostUid'].pastTournaments), []);
});

test('unpublishArchivedTournamentFromFollowers removes only the matching entry', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { pastTournaments: [
    { code:'CODE1', historyId:'hist1', label:'Keep me', archived:true },
    { code:'CODE1', historyId:'hist2', label:'Delete me', archived:true },
  ] };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `currentUser = { uid:'hostUid' };`);
  await window.unpublishArchivedTournamentFromFollowers('hist2');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].historyId, 'hist1');
});

test('showHostPastTournaments lists both live sessions and individually-archived tournaments, not just the 2 most recent share codes', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan',
    pastTournaments: [
      { code:'CODE3', label:'Session 3 (live)', startedAt: 3000, visibility:'public' },
      { code:'CODE2', historyId:'h2', label:'Tournament from session 2', startedAt: 2000, visibility:'public', archived:true },
      { code:'CODE1', historyId:'h1b', label:'Second tournament in session 1', startedAt: 1500, visibility:'public', archived:true },
      { code:'CODE1', historyId:'h1a', label:'First tournament in session 1', startedAt: 1000, visibility:'private', archived:true },
    ],
  };
  const { window } = freshWindow({ dbStore });
  window.localStorage.setItem('ballrr_followed_host_v1', JSON.stringify({ hostUid:'hostUid', hostCode:'ABCDEF', hostName:'Aaryan', lastSeenStartedAt:0 }));
  runInOneEval(window, `followedHost = getFollowedHost();`);
  await window.showHostPastTournaments();
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const html = window.document.getElementById('recap-card-content').innerHTML;
  assert.ok(html.includes('Session 3 (live)'));
  assert.ok(html.includes('Tournament from session 2'));
  assert.ok(html.includes('Second tournament in session 1'));
  assert.ok(html.includes('First tournament in session 1'));
  assert.ok(html.includes('🔒'), 'the private entry should still show a lock hint');
});

// Regression test for: "the followers still just see a tournament no longer available pop up".
// Root cause: viewing an archived entry used to join/follow its ORIGINAL shared/{code} session,
// which the host may have long since disbanded (deleting that doc entirely) -- even though the
// tournament's data was never actually lost. Archived entries now render straight from their own
// embedded snapshot, so this must work even when shared/{code} was never in the dbStore at all.
test('viewing an archived tournament works even after the host has disbanded its original shared session', async () => {
  const dbStore = {};
  // Deliberately NOT populating dbStore['shared/CODE1'] or its payload -- simulates a session
  // that's been fully disbanded (both docs deleted). If viewing still depended on that doc,
  // this would surface "no longer available" instead of the tournament's actual data.
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan',
    pastTournaments: [{
      code: 'CODE1', historyId: 'hist1', label: 'Summer Cup', startedAt: 1000, dateStr: '2026-07-01',
      visibility: 'public', archived: true,
      snapshot: { numTeams: 2, legs: 1, teamNames: ['Red', 'Blue'], table: [{ name: 'Red', p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 1, gd: 1, pts: 3 }], playerStats: [{ name: 'Densil', team: 'Red', avg: 7.5, goals: 2, assists: 0 }] },
    }],
  };
  const { window } = freshWindow({ dbStore });
  window.localStorage.setItem('ballrr_followed_host_v1', JSON.stringify({ hostUid: 'hostUid', hostCode: 'ABCDEF', hostName: 'Aaryan', lastSeenStartedAt: 0 }));
  runInOneEval(window, `followedHost = getFollowedHost(); currentUser = { uid:'followerUid' };`);
  await window.showHostPastTournaments();
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  await window.viewHostPastTournament('CODE1', 'public', 'hist1');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const html = window.document.getElementById('recap-card-content').innerHTML;
  assert.ok(html.includes('Summer Cup'));
  assert.ok(html.includes('Red'), 'the final table from the snapshot should render');
  assert.ok(html.includes('Densil'), 'top performers from the snapshot should render');
  assert.ok(!html.includes('no longer available'), 'must not show the dead-link error -- the snapshot is self-contained');
});

// Regression test for the "live" pointer entry (no historyId) becoming a dead link once its
// session is disbanded -- disbandSharedTournament() now cleans that specific entry up, while
// leaving every archived (snapshot-carrying) entry for that same code untouched.
test('disbanding removes the dead "live" pointer entry but keeps archived entries for the same code', async () => {
  const dbStore = {};
  dbStore['shared/CODE1'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: {}, pendingFollowerRequests: [], requireApproval: false, visibility: 'public' };
  dbStore['shared/CODE1/payload/main'] = { data: JSON.stringify({ tournamentHistory: [] }), updatedAt: 1 };
  dbStore['hostProfiles/hostUid'] = {
    pastTournaments: [
      { code: 'CODE1', label: 'Session (live)', startedAt: 1000, visibility: 'public' }, // no historyId -- the dead pointer
      { code: 'CODE1', historyId: 'hist1', label: 'Archived from that session', startedAt: 900, visibility: 'public', archived: true, snapshot: { table: [], playerStats: [] } },
    ],
  };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'hostUid', displayName: 'Aaryan' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  window.disbandSharedTournament(); // window.confirm defaults to true
  for(let i=0;i<20;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.ok(!list.some(t=>t.code==='CODE1'&&!t.historyId), 'the dead live-session pointer must be removed');
  assert.ok(list.some(t=>t.historyId==='hist1'), 'the archived tournament entry must survive the disband');
});

// Regression test for: a follower using the ?followhost= direct link seeing "no longer
// available" -- root cause was hostProfiles.latestCode never getting cleared on disband. This
// checks the other half of that fix: disbanding must null out latestCode/latestVisibility/
// latestStartedAt/latestLabel so a brand-new follower's consumePendingFollowHost() has nothing
// stale to redirect into.
test('disbanding clears the host profile\'s latestCode/latestVisibility/latestStartedAt/latestLabel so a new follower is never redirected into a dead session', async () => {
  const dbStore = {};
  dbStore['shared/CODE1'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: {}, pendingFollowerRequests: [], requireApproval: false, visibility: 'public' };
  dbStore['shared/CODE1/payload/main'] = { data: JSON.stringify({ tournamentHistory: [] }), updatedAt: 1 };
  dbStore['hostProfiles/hostUid'] = {
    latestCode: 'CODE1', latestVisibility: 'public', latestStartedAt: 5000, latestLabel: 'Session (live)',
    pastTournaments: [{ code: 'CODE1', label: 'Session (live)', startedAt: 5000, visibility: 'public' }],
  };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'hostUid', displayName: 'Aaryan' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  window.disbandSharedTournament(); // window.confirm defaults to true
  for(let i=0;i<20;i++) await new Promise(r=>setTimeout(r,0));

  const profile = dbStore['hostProfiles/hostUid'];
  assert.strictEqual(profile.latestCode, null);
  assert.strictEqual(profile.latestVisibility, null);
  assert.strictEqual(profile.latestStartedAt, 0);
  assert.strictEqual(profile.latestLabel, null);
});

// Companion test: a session the host is CURRENTLY disbanding must not clobber a DIFFERENT,
// still-live session's latestCode if for some reason they don't match (defensive guard in
// clearLatestLiveFromHostProfile() -- only clears when latestCode still equals the code being
// disbanded).
test('disbanding does not clear latestCode if it already points at a different, newer session', async () => {
  const dbStore = {};
  dbStore['shared/CODE1'] = { ownerId: 'hostUid', ownerName: 'Aaryan', members: ['hostUid'], pendingRequests: [], memberNames: { hostUid: 'Aaryan' }, followers: [], followerNames: {}, pendingFollowerRequests: [], requireApproval: false, visibility: 'public' };
  dbStore['shared/CODE1/payload/main'] = { data: JSON.stringify({ tournamentHistory: [] }), updatedAt: 1 };
  dbStore['hostProfiles/hostUid'] = {
    latestCode: 'CODE2', latestVisibility: 'public', latestStartedAt: 9000, latestLabel: 'A newer session',
    pastTournaments: [],
  };
  const { window, triggerAuth } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'hostUid', displayName: 'Aaryan' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  window.disbandSharedTournament();
  for(let i=0;i<20;i++) await new Promise(r=>setTimeout(r,0));

  assert.strictEqual(dbStore['hostProfiles/hostUid'].latestCode, 'CODE2', "a different session's latest pointer must be untouched");
});

// Regression tests for: "my last tournament was set to private but I want it to be public now" --
// lets the organizer flip an already-saved Archive entry's visibility after the fact, straight
// from the Archive tab, without needing the original shared/{code} session to still exist.
test('setArchivedTournamentVisibility makes a private archived entry public, embedding a fresh snapshot built from the local history entry', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    pastTournaments: [
      { code: 'CODE1', historyId: 'hist1', label: 'Winter Cup', visibility: 'private', archived: true, snapshot: null },
    ],
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [
      { id:'hist1', numTeams:2, legs:1, teamNames:['Red','Blue'],
        table:[{ name:'Red', p:1, w:1, d:0, l:0, gf:2, ga:1, gd:1, pts:3 }],
        playerStats:[{ name:'Densil', team:'Red', avg:7.5, goals:2, assists:0 }],
        visibility:'private' }
    ] };
  `);
  await window.setArchivedTournamentVisibility('hist1', 'public');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const entry = dbStore['hostProfiles/hostUid'].pastTournaments[0];
  assert.strictEqual(entry.visibility, 'public');
  assert.ok(entry.snapshot, 'a snapshot must be embedded so followers can view it without approval');
  assert.strictEqual(entry.snapshot.table[0].name, 'Red');
  assert.strictEqual(entry.snapshot.playerStats[0].name, 'Densil');
});

test('setArchivedTournamentVisibility makes a public archived entry private, stripping the embedded snapshot back out', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    pastTournaments: [
      { code: 'CODE1', historyId: 'hist1', label: 'Winter Cup', visibility: 'public', archived: true, snapshot: { table: [{ name: 'Red' }], playerStats: [] } },
    ],
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [
      { id:'hist1', numTeams:2, legs:1, teamNames:['Red','Blue'], table:[{ name:'Red' }], playerStats:[], visibility:'public' }
    ] };
  `);
  await window.setArchivedTournamentVisibility('hist1', 'private');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const entry = dbStore['hostProfiles/hostUid'].pastTournaments[0];
  assert.strictEqual(entry.visibility, 'private');
  assert.strictEqual(entry.snapshot, null, 'the snapshot must be removed once private -- hostProfiles has no per-follower approval gate');
});

// Covers the pre-existing tournaments that predate publishArchivedTournamentToFollowers()
// publishing local saves automatically -- openArchivedVisibilityControl() now offers to publish
// them retroactively instead of just refusing with "nothing to change".
test('openArchivedVisibilityControl offers to publish a never-shared tournament now, and confirming does so (backfill for pre-existing saves)', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { pastTournaments: [] };
  const { window } = freshWindow({ dbStore }); // window.confirm defaults to true
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [
      { id:'hist-never-shared', numTeams:2, legs:1, teamNames:['Red','Blue'],
        table:[{ name:'Red' }], playerStats:[{ name:'Densil' }], label:'Backfilled Cup', date:'2026-07-10' }
    ] };
  `);
  await window.openArchivedVisibilityControl('hist-never-shared');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list.length, 1, 'confirming should publish it for the first time');
  assert.strictEqual(list[0].historyId, 'hist-never-shared');
  assert.strictEqual(list[0].visibility, 'public');
  assert.ok(list[0].snapshot, 'the backfilled entry should carry a real snapshot built from the local history entry');
});

test('publishArchivedTournamentNow does nothing if the tournament was already published (no duplicate entry)', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    pastTournaments: [{ code: 'CODE1', historyId: 'hist1', label: 'Already published', archived: true, visibility: 'public', snapshot: { table: [], playerStats: [] } }],
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [{ id:'hist1', numTeams:2, legs:1, teamNames:['Red','Blue'], table:[], playerStats:[], label:'Already published' }] };
  `);
  await window.publishArchivedTournamentNow('hist1');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  assert.strictEqual(dbStore['hostProfiles/hostUid'].pastTournaments.length, 1, 'must not create a second entry for an already-published tournament');
});

test('openArchivedVisibilityControl confirms, then flips a private published entry to public (full flow via the Archive tab button)', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    pastTournaments: [
      { code: 'CODE1', historyId: 'hist1', label: 'Winter Cup', visibility: 'private', archived: true, snapshot: null },
    ],
  };
  const { window } = freshWindow({ dbStore }); // window.confirm defaults to true
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { tournamentHistory: [
      { id:'hist1', numTeams:2, legs:1, teamNames:['Red','Blue'],
        table:[{ name:'Red' }], playerStats:[{ name:'Densil' }], visibility:'private' }
    ] };
  `);
  await window.openArchivedVisibilityControl('hist1');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const entry = dbStore['hostProfiles/hostUid'].pastTournaments[0];
  assert.strictEqual(entry.visibility, 'public');
  assert.ok(entry.snapshot, 'confirming should proceed all the way through to embedding the snapshot');
});
