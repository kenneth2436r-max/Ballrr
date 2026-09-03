'use strict';
// Regression test for the Phase 1 performance CSS-animation audit: the .fifa-card::before "shine"
// sweep (shown whenever a player card modal is open) used to animate the `left` property via
// @keyframes fifaShine, which forces a full layout recalculation on the main thread every single
// frame, indefinitely (the animation runs `infinite` for as long as the card modal is open).
// Fixed by switching to `transform: translateX()`, which the compositor can run on its own thread
// with no layout/paint cost. This test guards against the animation ever drifting back to
// animating a layout-affecting property (left/top/width/height/margin/etc.) instead of transform.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const LAYOUT_TRIGGERING_PROPS = ['left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'padding'];

test('every @keyframes block in the stylesheet only animates transform/opacity (compositor-only properties), never a layout-triggering property', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  // CSS keyframe blocks nest one level deep (each percentage selector has its own { }), so a
  // simple non-greedy match would stop at the FIRST inner closing brace. This pattern explicitly
  // allows one level of nested {...} groups inside the outer @keyframes { }.
  const keyframeBlocks = [...html.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  assert.ok(keyframeBlocks.length > 5, 'sanity check: should find a healthy number of @keyframes blocks -- if this is near 0, the regex likely stopped matching after a stylesheet restructure and this test is silently not checking anything');

  const offenders = [];
  keyframeBlocks.forEach(([, name, body]) => {
    LAYOUT_TRIGGERING_PROPS.forEach(prop => {
      // Match the property as a CSS declaration (prop immediately followed by ':'), not as a
      // substring of some other word (e.g. "top" inside a color name would never occur here, but
      // being precise costs nothing).
      const re = new RegExp('(?:^|[{;])\\s*' + prop + '\\s*:', 'i');
      if(re.test(body)) offenders.push(name + ' animates "' + prop + '"');
    });
  });
  assert.deepStrictEqual(offenders, [], 'found @keyframes blocks animating a layout-triggering property -- these force a synchronous reflow on every frame instead of running on the compositor. Use transform (translateX/Y, scale) instead.');
});

test('.fifa-card::before specifically uses transform for its shine sweep, not left', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const rule = html.match(/\.fifa-card::before\{[^}]*\}/);
  assert.ok(rule, 'could not find the .fifa-card::before rule -- did it get renamed/restructured?');
  assert.ok(/animation:fifaShine/.test(rule[0]));
  const keyframes = html.match(/@keyframes fifaShine\s*\{(?:[^{}]|\{[^{}]*\})*\}/);
  assert.ok(keyframes, 'could not find the fifaShine @keyframes block');
  assert.ok(/transform\s*:\s*translateX/.test(keyframes[0]), 'fifaShine should animate transform:translateX(), not left');
  assert.ok(!/(?:^|[{;])\s*left\s*:/.test(keyframes[0]), 'fifaShine must not animate left anymore -- that was the original jank source (continuous main-thread reflow while any player card modal is open)');
});
