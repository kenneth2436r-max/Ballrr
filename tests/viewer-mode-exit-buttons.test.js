'use strict';
// Regression test for a real reported bug: a follower opens a shared tournament (view-only /
// "viewer-mode"), then finds the "Stop following (back to your own tournament)" button
// completely unresponsive -- along with literally every other button on the screen. Root cause:
// the blanket CSS rule that disables editing controls for followers --
//   body.viewer-mode .section button:not(.tab):not(.help-faq-q), ...{ pointer-events:none; }
// -- only exempted the tab bar and help-FAQ toggles. The "Stop following"/"Leave" buttons are
// plain <button class="pc-btn pc-btn-close"> elements inside .section (the Settings tab), so they
// were ALSO disabled the instant viewer-mode turned on -- which is exactly the button that's
// supposed to get a follower OUT of viewer-mode. Followers had no way back to their own
// tournament. Fix: a dedicated .viewer-exit-btn class, exempted in the CSS selector, applied to
// every "leave/stop following" style button.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('renderSharedSection marks the follower\'s "Stop following" button and a member\'s "Leave" button with viewer-exit-btn, so the CSS viewer-mode lockdown cannot disable them', () => {
  const followerMeta = {
    code: 'ABC123', ownerId: 'hostUid', ownerName: 'Aaryan',
    members: ['hostUid'], memberNames: { hostUid: 'Aaryan' },
    followers: ['followerUid'], followerNames: { followerUid: 'Fan' },
    pendingRequests: [], pendingFollowerRequests: [], requireApproval: false, visibility: 'public'
  };
  const { window: w1 } = freshWindow({ extraHtml: '<div id="shared-container"></div>' });
  runInOneEval(w1, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    sharedMeta = ${JSON.stringify(followerMeta)};
    renderSharedSection();
  `);
  const followerHtml = w1.document.getElementById('shared-container').innerHTML;
  assert.ok(/class="[^"]*\bviewer-exit-btn\b[^"]*"[^>]*onclick="unfollowSharedTournament\(\)"/.test(followerHtml),
    'the follower\'s Stop-following button must carry viewer-exit-btn so it stays tappable in viewer-mode');

  const memberMeta = { ...followerMeta, members: ['hostUid', 'memberUid'], memberNames: { hostUid: 'Aaryan', memberUid: 'Co-editor' }, followers: [] };
  const { window: w2 } = freshWindow({ extraHtml: '<div id="shared-container"></div>' });
  runInOneEval(w2, `
    currentUser = { uid:'memberUid', displayName:'Co-editor' };
    sharedMeta = ${JSON.stringify(memberMeta)};
    renderSharedSection();
  `);
  const memberHtml = w2.document.getElementById('shared-container').innerHTML;
  assert.ok(/class="[^"]*\bviewer-exit-btn\b[^"]*"[^>]*onclick="leaveSharedTournament\(\)"/.test(memberHtml),
    'a member\'s Leave button must also carry viewer-exit-btn');
});

test('renderHostFollowBlock marks "Stop following" (a host, not a tournament) with viewer-exit-btn too', () => {
  const { window } = freshWindow({ extraHtml: '<div id="shared-container"></div>' });
  runInOneEval(window, `
    currentUser = { uid:'followerUid', displayName:'Fan' };
    followedHost = { hostUid:'hostUid', hostCode:'ABCDEF', hostName:'Aaryan' };
    window.__results.html = renderHostFollowBlock();
  `);
  assert.ok(/class="[^"]*\bviewer-exit-btn\b[^"]*"[^>]*onclick="unfollowHost\(\)"/.test(window.__results.html),
    'the "Stop following" (host) button must carry viewer-exit-btn');
});

test('isViewerMode is true exactly for an approved follower (not a member, not pending), matching the state that actually triggers body.viewer-mode', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    currentUser = { uid:'u1' };
    sharedMeta = { members:[], followers:['u1'] };
    window.__results.follower = isViewerMode();
    sharedMeta = { members:['u1'], followers:[] };
    window.__results.member = isViewerMode();
    sharedMeta = { members:[], followers:[] };
    window.__results.neither = isViewerMode();
    sharedMeta = null;
    window.__results.noShared = isViewerMode();
  `);
  assert.strictEqual(r.follower, true);
  assert.strictEqual(r.member, false, 'a full editor/member must never be put into viewer-mode');
  assert.strictEqual(r.neither, false);
  assert.strictEqual(r.noShared, false);
});

test('the viewer-mode CSS lockdown rule exempts .viewer-exit-btn (guards against the selector ever being simplified back to the buggy version)', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/body\.viewer-mode \.section button:not\([^)]*\)(?::not\([^)]*\))*/);
  assert.ok(match, 'could not find the viewer-mode button-lockdown CSS rule at all -- did it get restructured?');
  assert.ok(match[0].includes(':not(.viewer-exit-btn)'), 'the lockdown selector must exempt .viewer-exit-btn, or every "back to your own tournament" button gets disabled again');
});
