'use strict';
// Regression test for the bug where a disbanded/followed tournament's data could survive in a
// follower's own "private tournament" fallback -- caused by saveState() unconditionally
// caching whatever `state` currently held (including someone else's shared tournament) into
// the same local storage key used as the private-mode fallback.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('following a tournament does not poison the local private-fallback cache, and disbanding purges it', async () => {
  const dbStore = {};
  dbStore['shared/VJ8ERZ'] = { ownerId:'owner1', ownerName:'Aaryan', members:['owner1'], pendingRequests:[], memberNames:{owner1:'Aaryan'}, followers:['friendUid'], followerNames:{friendUid:'Friend'}, requireApproval:false };
  dbStore['shared/VJ8ERZ/payload/main'] = { data: JSON.stringify({ teamNames:['Akhil Munich','Shane FC'], tournamentHistory:[{id:'secret-history',players:[{name:'Aaryan',goals:99}]}] }), updatedAt:1 };

  const { window, triggerAuth } = freshWindow({ dbStore, urlSuffix: 'follow=vj8erz' });
  runInOneEval(window, '');
  triggerAuth({ uid: 'friendUid', displayName: 'Friend' });
  for(let i=0;i<10;i++) await new Promise(r=>setTimeout(r,0));

  const cachedAfterFollow = window.localStorage.getItem('ftour_v3');
  assert.ok(!cachedAfterFollow || !cachedAfterFollow.includes('secret-history'), 'following must not poison the private-fallback cache');

  delete dbStore['shared/VJ8ERZ'];
  delete dbStore['shared/VJ8ERZ/payload/main'];
  window.refreshSharedMetaNow();
  for(let i=0;i<15;i++) await new Promise(r=>setTimeout(r,0));

  assert.strictEqual(window.getActiveSharedCode(), null);
  const cachedAfterDisband = window.localStorage.getItem('ftour_v3');
  assert.ok(!cachedAfterDisband || !cachedAfterDisband.includes('secret-history'), 'the disbanded tournament\'s data must not survive in the local cache');
});
