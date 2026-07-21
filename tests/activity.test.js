'use strict';
// Tests for the lite Activity tab (renderActivity()/activityFollowersRowsHtml()) -- built
// entirely from data that's already live client-side (myFollowersList, sharedMeta), no new
// Firestore reads or rules. Reuses the exact same approveJoinRequest/rejectJoinRequest/
// approveFollowerRequest/rejectFollowerRequest actions the Settings tab's pending list already
// calls, so this file only checks that Activity renders the right rows/buttons for them --
// see host-follow.test.js and shared-tournament tests for coverage of those actions themselves.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('renderActivity prompts sign-in when signed out', () => {
  const { window } = freshWindow({ extraHtml: '<div id="activity-container"></div>' });
  runInOneEval(window, `
    currentUser = null;
    myFollowersList = [];
    sharedMeta = null;
    renderActivity();
  `);
  const html = window.document.getElementById('activity-container').innerHTML;
  assert.ok(html.includes('Sign in'), 'a signed-out viewer should be told to sign in');
});

test('renderActivity shows "nothing waiting" and an empty followers message when there is no data', () => {
  const { window } = freshWindow({ extraHtml: '<div id="activity-container"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'devyanee', displayName:'Devyanee' };
    myFollowersList = [];
    sharedMeta = null;
    renderActivity();
  `);
  const html = window.document.getElementById('activity-container').innerHTML;
  assert.ok(html.includes('Nothing waiting right now'), 'no pending requests should show the empty state, not a blank section');
  assert.ok(html.includes('No followers yet'), 'no followers should show the empty state');
  assert.ok(html.includes('(0)'), 'the followers count should read 0');
});

test('renderActivity lists this device\'s own followers by name', () => {
  const { window } = freshWindow({ extraHtml: '<div id="activity-container"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'devyanee', displayName:'Devyanee' };
    myFollowersList = [{ uid:'a', name:'Priya' }, { uid:'b', name:'Rohan' }];
    sharedMeta = null;
    renderActivity();
  `);
  const html = window.document.getElementById('activity-container').innerHTML;
  assert.ok(html.includes('Priya') && html.includes('Rohan'), 'both follower names should be listed');
  assert.ok(html.includes('(2)'), 'the followers count should read 2');
});

test('renderActivity shows approve/reject rows for pending join requests when this device owns the active shared tournament', () => {
  const { window } = freshWindow({ extraHtml: '<div id="activity-container"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'devyanee', displayName:'Devyanee' };
    myFollowersList = [];
    sharedMeta = { code:'ABCD', ownerId:'devyanee', ownerName:'Devyanee', members:['devyanee'], pendingRequests:['newbie1'], requireApproval:true, memberNames:{newbie1:'Newbie One'}, followers:[], followerNames:{}, pendingFollowerRequests:[], visibility:'public' };
    renderActivity();
  `);
  const html = window.document.getElementById('activity-container').innerHTML;
  assert.ok(html.includes('Newbie One'), 'the requester\'s name should show');
  assert.ok(html.includes("approveJoinRequest('newbie1')"), 'an Approve button wired to the real action should be present');
  assert.ok(html.includes("rejectJoinRequest('newbie1')"), 'a Reject button wired to the real action should be present');
  assert.ok(!html.includes('Nothing waiting right now'), 'the empty state should not show once there is a real pending request');
});

test('renderActivity shows approve/reject rows for pending private-follow requests, and hides both pending sections from a non-owner', () => {
  const { window } = freshWindow({ extraHtml: '<div id="activity-container"></div>' });
  const r = runInOneEval(window, `
    currentUser = { uid:'devyanee', displayName:'Devyanee' };
    myFollowersList = [];
    sharedMeta = { code:'ABCD', ownerId:'devyanee', ownerName:'Devyanee', members:['devyanee'], pendingRequests:[], requireApproval:false, memberNames:{}, followers:[], followerNames:{fan1:'Fan One'}, pendingFollowerRequests:['fan1'], visibility:'private' };
    renderActivity();
    window.__results.ownerHtml = document.getElementById('activity-container').innerHTML;

    currentUser = { uid:'someoneelse', displayName:'Someone Else' };
    renderActivity();
    window.__results.nonOwnerHtml = document.getElementById('activity-container').innerHTML;
  `);
  assert.ok(r.ownerHtml.includes('Fan One'), 'the owner should see the pending viewer\'s name');
  assert.ok(r.ownerHtml.includes("approveFollowerRequest('fan1')"));
  assert.ok(r.ownerHtml.includes("rejectFollowerRequest('fan1')"));
  assert.ok(r.nonOwnerHtml.includes('Nothing waiting right now'), 'a non-owner should never see someone else\'s pending requests');
});
