'use strict';
// Tests for the universal (cross-account) verified player search -- see firestore.rules'
// verifiedPlayers/{uid} comment and syncVerifiedContributionsForHistory()'s own comment for the
// full design. Every real signed-in user automatically gets a verified identity
// (ensureVerifiedIdentity()) -- no "become a host" step needed. A tracked roster name
// auto-attributes to a verified account whenever it's an exact, unambiguous match
// (resolveVerifiedUidByName()); getPlayerLinkedCode()'s existing host-code link is a manual
// override that always takes priority when present (for genuine name collisions, or nicknames).
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('ensureVerifiedIdentity publishes this account\'s own real name, and is a safe no-op when signed out or unnamed', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'myUid', displayName:'Devyanee Chouhan' };
    window.__testDone = ensureVerifiedIdentity();
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  const idx = dbStore['verifiedPlayers/myUid'];
  assert.ok(idx);
  assert.strictEqual(idx.name, 'Devyanee Chouhan');
  assert.strictEqual(idx.nameLower, 'devyanee chouhan');

  const dbStore2 = {};
  const { window: w2 } = freshWindow({ dbStore: dbStore2 });
  runInOneEval(w2, `
    currentUser = null;
    window.__testDone = ensureVerifiedIdentity();
  `);
  await w2.__testDone;
  assert.strictEqual(Object.keys(dbStore2).length, 0, 'signed out -- nothing to publish');
});

test('resolveVerifiedUidByName matches exactly one account, and returns null for nobody or an ambiguous shared name', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUid'] = { uid:'samUid', name:'Sam', nameLower:'sam' };
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `
    window.__testDone = (async () => {
      window.__results.unique = await resolveVerifiedUidByName('Sam');
      window.__results.caseInsensitive = await resolveVerifiedUidByName('sam');
      window.__results.nobody = await resolveVerifiedUidByName('Nobody');
    })();
  `);
  await window.__testDone;
  assert.strictEqual(r.unique, 'samUid');
  assert.strictEqual(r.caseInsensitive, 'samUid');
  assert.strictEqual(r.nobody, null);
});

test('resolveVerifiedUidByName refuses to guess when two different real accounts share the exact same name', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUidA'] = { uid:'samUidA', name:'Sam', nameLower:'sam' };
  dbStore['verifiedPlayers/samUidB'] = { uid:'samUidB', name:'Sam', nameLower:'sam' };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `window.__testDone = resolveVerifiedUidByName('Sam');`);
  const result = await window.__testDone;
  assert.strictEqual(result, null, 'ambiguous -- must not silently attribute to either stranger');
});

test('syncVerifiedContributionsForHistory auto-attributes by exact name match when there is no manual link', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUid'] = { uid:'samUid', name:'Samuel', nameLower:'samuel' };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'organizerUid', displayName:'Aaryan' };
    window.__testDone = syncVerifiedContributionsForHistory([
      { id:'t1', label:'Summer Cup', date:'2026-07-20', playerStats:[
        { name:'Samuel', team:'Red FC', avg:7.5, count:3, goals:2, assists:1, cleanSheets:0, matchRatings:[7,7.5,8] }
      ] }
    ]);
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const contrib = dbStore['verifiedPlayers/samUid/contributions/organizerUid_t1'];
  assert.ok(contrib, 'exact unambiguous name match should auto-attribute without any manual link');
  assert.strictEqual(contrib.contributingUid, 'organizerUid');
  assert.strictEqual(contrib.playerStats.goals, 2);
});

test('syncVerifiedContributionsForHistory does not guess when the name is ambiguous or matches nobody', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUidA'] = { uid:'samUidA', name:'Sam', nameLower:'sam' };
  dbStore['verifiedPlayers/samUidB'] = { uid:'samUidB', name:'Sam', nameLower:'sam' };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'organizerUid', displayName:'Aaryan' };
    window.__testDone = syncVerifiedContributionsForHistory([
      { id:'t1', playerStats:[ { name:'Sam', avg:7, count:2, goals:1 } ] },
      { id:'t2', playerStats:[ { name:'Nobody Tracked', avg:7, count:2, goals:1 } ] }
    ]);
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(!dbStore['verifiedPlayers/samUidA/contributions/organizerUid_t1']);
  assert.ok(!dbStore['verifiedPlayers/samUidB/contributions/organizerUid_t1']);
  const anyNewDocs = Object.keys(dbStore).filter(k => k.includes('contributions'));
  assert.strictEqual(anyNewDocs.length, 0, 'ambiguous or unmatched names should not create any contribution');
});

test('syncVerifiedContributionsForHistory\'s manual host-code link always takes priority over name matching', async () => {
  const dbStore = {};
  dbStore['hostCodes/SAM123'] = { uid: 'theRealSamUid' };
  dbStore['hostProfiles/theRealSamUid'] = { hostName: 'Sam (the real one)', followers: [] };
  // A DIFFERENT account also happens to be named exactly "Sam" -- without the manual link this
  // would be ambiguous and get skipped, but the explicit code should win outright.
  dbStore['verifiedPlayers/someOtherSamUid'] = { uid:'someOtherSamUid', name:'Sam', nameLower:'sam' };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    currentUser = { uid:'organizerUid', displayName:'Aaryan' };
    window.__testDone = syncVerifiedContributionsForHistory([
      { id:'t1', playerStats:[ { name:'Sam', code:'SAM123', avg:7, count:2, goals:3 } ] }
    ]);
  `);
  await window.__testDone;
  for(let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

  const contrib = dbStore['verifiedPlayers/theRealSamUid/contributions/organizerUid_t1'];
  assert.ok(contrib, 'the manually-linked account should get the contribution');
  assert.strictEqual(contrib.playerStats.goals, 3);
  assert.ok(!dbStore['verifiedPlayers/someOtherSamUid/contributions/organizerUid_t1'], 'the OTHER same-named account must not get it');
});

test('computeVerifiedPlayerCard aggregates contributions from multiple different organizers into one profile', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUid'] = { uid:'samUid', name:'Samuel', nameLower:'samuel' };
  dbStore['verifiedPlayers/samUid/contributions/orgA_t1'] = {
    tournamentId:'t1', contributingUid:'orgA',
    playerStats:{ name:'Sam', team:'Red FC', avg:7, count:2, goals:1, assists:0, cleanSheets:0, matchRatings:[7,7] }
  };
  dbStore['verifiedPlayers/samUid/contributions/orgB_t2'] = {
    tournamentId:'t2', contributingUid:'orgB',
    playerStats:{ name:'Sam', team:'Blue FC', avg:9, count:1, goals:2, assists:1, cleanSheets:0, matchRatings:[9] }
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    window.__testDone = computeVerifiedPlayerCard('samUid');
  `);
  const card = await window.__testDone;
  assert.strictEqual(card.name, 'Samuel');
  assert.strictEqual(card.goals, 3, '1 (orgA) + 2 (orgB) = 3, combined across unrelated organizers');
  assert.strictEqual(card.assists, 1);
  assert.strictEqual(card.matches, 3, '2 + 1 = 3');
  assert.strictEqual(card.tournaments, 2);
  assert.strictEqual(card.avg, (7*2+9*1)/3);
});

test('computeVerifiedPlayerCard returns null for a uid that was never actually verified', async () => {
  const dbStore = {};
  const { window } = freshWindow({ dbStore });
  const r = runInOneEval(window, `window.__testDone = computeVerifiedPlayerCard('nobodyUid');`);
  const result = await window.__testDone;
  assert.strictEqual(result, null);
});
