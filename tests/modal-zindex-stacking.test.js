'use strict';
// Regression test for a real, reported app-freeze bug: the popup-behind-popup z-index fix (the
// MutationObserver IIFE at the very end of the main <script>) watches each .modal-overlay
// element's `style` attribute, but its own callback writes el.style.zIndex -- which is ITSELF a
// style-attribute mutation. Without guarding against that, every write re-triggers the same
// observer, which writes again, forever: a self-sustaining MutationObserver microtask loop that
// never yields back to the browser's render/input loop (microtasks are always drained before
// timers/input get a turn). In practice that's a full app freeze the instant ANY modal opens --
// matching a real report of "the app freezes after a few touches no matter which tab", since
// nearly every tab has at least one popup wired to a .modal-overlay element. The fix is to
// disconnect the observer for the moment it makes its own write, then immediately re-observe.
//
// These tests bound every wait with a short setTimeout. If the runaway-loop bug were ever
// reintroduced, that setTimeout would never fire (the process's microtask queue never drains),
// so this test would hang rather than fail cleanly -- run it with a wall-clock timeout
// (`node --test --test-timeout=15000`) in CI/scripts for a hard guarantee it can't hang a build.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('opening a .modal-overlay does not runaway-loop the z-index MutationObserver, and it still assigns an increasing z-index on every subsequent open', async () => {
  const { window } = freshWindow({
    extraHtml: `
      <div class="modal-overlay" id="overlay-a" style="display:none"></div>
      <div class="modal-overlay" id="overlay-b" style="display:none"></div>
    `
  });
  runInOneEval(window, `
    window.__testDone = (async () => {
      const a = document.getElementById('overlay-a');
      const b = document.getElementById('overlay-b');

      a.style.display = 'flex';
      await new Promise(resolve => setTimeout(resolve, 60));
      window.__results.zAfterFirstOpen = a.style.zIndex;

      // Close and reopen -- the observer must still be attached and working afterward (the fix
      // disconnects/reconnects around its own write, so this proves reconnect actually happens).
      a.style.display = 'none';
      await new Promise(resolve => setTimeout(resolve, 20));
      a.style.display = 'flex';
      await new Promise(resolve => setTimeout(resolve, 60));
      window.__results.zAfterReopen = a.style.zIndex;

      // A second, independent overlay opening afterward should get an even higher z-index, same
      // "whoever opened most recently wins" behavior the fix was originally written for.
      b.style.display = 'flex';
      await new Promise(resolve => setTimeout(resolve, 60));
      window.__results.zForSecondOverlay = b.style.zIndex;
    })();
  `);
  await window.__testDone;

  const firstZ = parseInt(window.__results.zAfterFirstOpen, 10);
  const reopenZ = parseInt(window.__results.zAfterReopen, 10);
  const secondOverlayZ = parseInt(window.__results.zForSecondOverlay, 10);

  assert.ok(Number.isFinite(firstZ) && firstZ >= 9999, 'opening the overlay should assign it a real, high z-index');
  assert.ok(Number.isFinite(reopenZ) && reopenZ > firstZ, 'reopening after a close should bump the z-index again (proves the observer reconnects after its own write)');
  assert.ok(Number.isFinite(secondOverlayZ) && secondOverlayZ > reopenZ, 'a second overlay opened afterward should out-rank the first, same "most recent wins" stacking behavior');

  // If the runaway-loop bug were present, the callback would fire hundreds/thousands of times per
  // open (each self-triggered), and the final zIndex would be some huge, unpredictable number far
  // beyond a single bump. A single genuine open should only ever bump z-index by exactly 1.
  assert.strictEqual(reopenZ - firstZ, 1, 'a single open should bump z-index by exactly 1, not run away to some huge number');
  assert.strictEqual(secondOverlayZ - reopenZ, 1, 'a single open should bump z-index by exactly 1, not run away to some huge number');
});
