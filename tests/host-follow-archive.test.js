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

test('publishArchivedTournamentToFollowers adds a distinct entry for the organizer, tagged archived', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: ['followerUid'], followerNames: {}, pastTournaments: [] };
  const { window } = freshWindow({ dbStore, activeCode: 'CODE1' });
  runInOneEval(window, `
    currentUser = { uid:'hostUid', displayName:'Aaryan' };
    sharedMeta = { code:'CODE1', ownerId:'hostUid', ownerName:'Aaryan', visibility:'public' };
  `);
  await window.publishArchivedTournamentToFollowers('hist1', 'Summer Cup', '2026-07-01');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const list = dbStore['hostProfiles/hostUid'].pastTournaments;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].historyId, 'hist1');
  assert.strictEqual(list[0].label, 'Summer Cup');
  assert.strictEqual(list[0].code, 'CODE1');
  assert.strictEqual(list[0].archived, true);
  assert.strictEqual(list[0].visibility, 'public');
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

test('publishArchivedTournamentToFollowers does nothing when there is no active shared session (a purely local/private save)', async () => {
  const dbStore = {};
  dbStore['hostProfiles/hostUid'] = { hostName: 'Aaryan', hostCode: 'ABCDEF', followers: [], followerNames: {}, pastTournaments: [] };
  const { window } = freshWindow({ dbStore }); // no activeCode
  runInOneEval(window, `currentUser = { uid:'hostUid', displayName:'Aaryan' }; sharedMeta = null;`);
  await window.publishArchivedTournamentToFollowers('hist1', 'Solo save', '2026-07-01');
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));
  assert.deepStrictEqual(Array.from(dbStore['hostProfiles/hostUid'].pastTournaments), []);
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
