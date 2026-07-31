'use strict';
// Tests for "Standing Co-Hosts" -- a person a host designates (via addStandingCoHost(), using
// their host code) to automatically become a full editor (member) of EVERY tournament that host
// creates from then on, with no code exchange and no approval step. Stored on the host's own
// hostProfiles/{uid}.standingCoHosts and applied inside startSharingTournament() right after a
// new shared/{code} doc is created. Deliberately one-directional and self-controlled: it only
// ever changes tournaments the CALLING account creates -- there's no way to grant yourself
// standing access to someone else's account this way.
//
// Also covers copySharedHistoryToMyArchive() -- lets any member (not just the owner, who's the
// only one who automatically gets a permanent copy via disbanding) pull the shared tournament's
// saved history into their own private archive at any point.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('addStandingCoHost resolves a host code and stores {uid,name,code} on the caller\'s own profile', async () => {
  const dbStore = {};
  dbStore['hostCodes/FRIEND1'] = { uid: 'friendUid' };
  dbStore['hostProfiles/friendUid'] = { hostName: 'Sam', hostCode: 'FRIEND1', followers: [], followerNames: {} };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    window.__testDone = addStandingCoHost('friend1');
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const list = dbStore['hostProfiles/hostUid'].standingCoHosts;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].uid, 'friendUid');
  assert.strictEqual(list[0].name, 'Sam');
  assert.strictEqual(list[0].code, 'FRIEND1', 'a lowercase-typed code should be normalized to uppercase');
});

test('addStandingCoHost rejects an unknown code, your own code, and a duplicate add', async () => {
  const dbStore = {};
  dbStore['hostCodes/FRIEND1'] = { uid: 'friendUid' };
  dbStore['hostCodes/SELFCODE'] = { uid: 'hostUid' };
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'SELFCODE', followers: [], followerNames: {} };
  dbStore['hostProfiles/friendUid'] = { hostName: 'Sam', hostCode: 'FRIEND1', followers: [], followerNames: {} };
  const { window } = freshWindow({ dbStore });
  window.__alertsSeen = [];
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    window.alert = (m) => { window.__alertsSeen.push(m); };
    window.__testDone = (async () => {
      await addStandingCoHost('NOPE99');
      await addStandingCoHost('SELFCODE');
      await addStandingCoHost('FRIEND1');
      await addStandingCoHost('FRIEND1');
    })();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const list = dbStore['hostProfiles/hostUid'].standingCoHosts;
  assert.strictEqual(list.length, 1, 'only the one valid, non-duplicate, non-self code should have been added');
  assert.ok(window.__alertsSeen.some(m => m.includes('No host found')));
  assert.ok(window.__alertsSeen.some(m => m.includes('your own host code')));
  assert.ok(window.__alertsSeen.some(m => m.includes('Already a standing co-host')));
});

test('removeStandingCoHost removes only the matching entry after confirming', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', followers: [], followerNames: {},
    standingCoHosts: [{ uid:'friendUid', name:'Sam', code:'FRIEND1' }, { uid:'otherUid', name:'Robin', code:'OTHER1' }],
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    window.confirm = () => true;
    removeStandingCoHost('friendUid');
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const list = dbStore['hostProfiles/hostUid'].standingCoHosts;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].uid, 'otherUid');
});

test('standingCoHostsListHtml shows an empty-state hint with nobody added, and a removable row per co-host', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.empty = standingCoHostsListHtml([]);
    window.__results.missing = standingCoHostsListHtml(undefined);
    window.__results.withOne = standingCoHostsListHtml([{ uid:'friendUid', name:'Sam', code:'FRIEND1' }]);
  `);
  assert.ok(r.empty.includes('Nobody yet'));
  assert.ok(r.missing.includes('Nobody yet'));
  assert.ok(r.withOne.includes('Sam'));
  assert.ok(r.withOne.includes('FRIEND1'));
  assert.ok(r.withOne.includes("removeStandingCoHost('friendUid')"));
});

test('startSharingTournament automatically adds every standing co-host as a full member, even for an approval-gated share', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = {
    hostName: 'Aaryan', followers: [], followerNames: {},
    standingCoHosts: [{ uid:'friendUid', name:'Sam', code:'FRIEND1' }],
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { teamNames:['Red','Blue'] };
    startSharingTournament(true, true); // approval-gated -- standing co-hosts should still bypass it
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const code = dbStore['hostProfiles/hostUid'].latestCode;
  const shared = dbStore['shared/' + code];
  assert.ok(shared, 'the tournament should have been created');
  assert.ok((shared.members || []).includes('friendUid'), 'the standing co-host should be a member from the moment the tournament is created');
  assert.strictEqual(shared.memberNames.friendUid, 'Sam');
  assert.strictEqual(shared.requireApproval, true, 'the approval flag itself should be unaffected -- it just no longer applies to this pre-trusted person');
});

test('startSharingTournament is unaffected when there are no standing co-hosts (existing behavior)', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    state = { teamNames:['Red','Blue'] };
    startSharingTournament(false, true);
  `);
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const code = dbStore['hostProfiles/hostUid'].latestCode;
  const shared = dbStore['shared/' + code];
  assert.strictEqual((shared.members || []).length, 1, 'only the owner should be a member with no standing co-hosts configured');
});

test('copySharedHistoryToMyArchive lets a co-editor (not just the owner) pull the shared history into their own private archive', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'coEditorUid', displayName:'Robin' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid', members:['hostUid','coEditorUid'] };
    state = { tournamentHistory: [ { id:'t1', label:'Summer Cup', playerStats:[], table:[] } ] };
    window.__testDone = copySharedHistoryToMyArchive();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const privateData = JSON.parse(dbStore['tournaments/coEditorUid'].data);
  assert.strictEqual(privateData.tournamentHistory.length, 1);
  assert.strictEqual(privateData.tournamentHistory[0].id, 't1');
});

test('copySharedHistoryToMyArchive refuses a follower (view-only, not an editor) and is a safe no-op with nothing to copy', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  window.__alertsSeen = [];
  runInOneEval(window, `
    window.alert = (m) => { window.__alertsSeen.push(m); };
    currentUser = { uid:'followerUid', displayName:'Fan' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid', members:['hostUid'], followers:['followerUid'] };
    state = { tournamentHistory: [ { id:'t1' } ] };
    window.__testDone = copySharedHistoryToMyArchive();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(!dbStore['tournaments/followerUid'], 'a view-only follower must never get write access, even to their own copy');
  assert.ok(window.__alertsSeen.some(m => m.includes('Only editors')));

  const r2 = runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'ABCD', ownerId:'hostUid', members:['hostUid'] };
    state = { tournamentHistory: [] };
    window.alert = (m) => { window.__results.lastAlert = m; };
    window.__testDone = copySharedHistoryToMyArchive();
  `);
  await window.__testDone;
  assert.ok(r2.lastAlert.includes('Nothing saved'));
});
