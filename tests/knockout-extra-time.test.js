'use strict';
// Regression tests for: "how will someone determine if the play went into extra time and then
// penalties? there should be an option for that (group stage doesn't need it), the knockouts
// can be tied and can either end in extra time and go to penalties". Root cause: the penalty
// shootout UI used to appear the instant a knockout match was saved level, with no way to record
// that extra time was (or wasn't) played first. Fixed with an explicit "Extra Time or Straight
// to Penalties?" choice (koExtraTimeHtml/setKOExtraTime) that now gates the shootout
// (koShootoutHtml). League/group-stage matches are structurally unaffected -- none of this is
// ever reached from the league match card, only koMatchCardHtml (knockout only).
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

function matchObj(overrides){
  return Object.assign({ played:true, g:[null,null], scorers:[], assists:[] }, overrides);
}

test('koExtraTimeHtml offers nothing for an unplayed or non-level match', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.notPlayed = koExtraTimeHtml('0.0', ${JSON.stringify(matchObj({played:false}))}, [0,0]);
    window.__results.notLevel = koExtraTimeHtml('0.0', ${JSON.stringify(matchObj())}, [2,1]);
  `);
  assert.strictEqual(r.notPlayed, '');
  assert.strictEqual(r.notLevel, '');
});

test('koExtraTimeHtml offers the extra-time-or-penalties choice once a knockout match is saved level', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.html = koExtraTimeHtml('0.0', ${JSON.stringify(matchObj())}, [1,1]);
  `);
  assert.ok(r.html.includes('Extra Time'));
  assert.ok(r.html.includes('Straight to Penalties'));
});

test('koShootoutHtml stays hidden for a level knockout match until an extra-time choice has been made', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.beforeChoice = koShootoutHtml('0.0', ${JSON.stringify(matchObj())}, [10,11], [1,1]);
  `);
  assert.strictEqual(r.beforeChoice, '', 'the shootout must not appear before the ref has said whether extra time was played');
});

test('setKOExtraTime(true) unlocks the shootout and hides the extra-time choice', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState=function(){};renderKnockout=function(){};haptic=function(){};
    state = { koRounds: [[ ${JSON.stringify(matchObj())} ]], teamNames:['Reds','Blues'] };
    setKOExtraTime('0.0', true);
    window.__results.extraTime = state.koRounds[0][0].extraTime;
    window.__results.choiceHtml = koExtraTimeHtml('0.0', state.koRounds[0][0], [1,1]);
    window.__results.shootoutHtml = koShootoutHtml('0.0', state.koRounds[0][0], [0,1], [1,1]);
  `);
  assert.deepStrictEqual(Object.assign({}, r.extraTime), { played:true, skipped:false });
  assert.strictEqual(r.choiceHtml, '', 'the choice should disappear once made');
  assert.ok(r.shootoutHtml.includes('Penalty Shootout'), 'the shootout should now be reachable');
  assert.ok(r.shootoutHtml.includes('Still level after extra time'));
});

test('setKOExtraTime(false) skips straight to the shootout without ever claiming extra time was played', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState=function(){};renderKnockout=function(){};haptic=function(){};
    state = { koRounds: [[ ${JSON.stringify(matchObj())} ]], teamNames:['Reds','Blues'] };
    setKOExtraTime('0.0', false);
    window.__results.extraTime = state.koRounds[0][0].extraTime;
    window.__results.shootoutHtml = koShootoutHtml('0.0', state.koRounds[0][0], [0,1], [1,1]);
  `);
  assert.deepStrictEqual(Object.assign({}, r.extraTime), { played:false, skipped:true });
  assert.ok(r.shootoutHtml.includes('Match finished level'), 'skipping straight to penalties should not claim extra time happened');
});

test('a goal added during extra time that breaks the tie is labeled "decided in extra time" and no longer offers a shootout', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    const m = ${JSON.stringify(matchObj({ extraTime:{played:true,skipped:false} }))};
    window.__results.badge = koExtraTimeBadgeHtml(m, [2,1], '0.0'); // now ahead after an extra-time goal
    window.__results.shootout = koShootoutHtml('0.0', m, [10,11], [2,1]);
  `);
  assert.ok(r.badge.includes('Decided in extra time'));
  assert.strictEqual(r.shootout, '', 'no longer level, so no shootout is needed');
});

test('resetKOExtraTimeChoice reverts to the unresolved state so the ref can correct a misclick', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    saveState=function(){};renderKnockout=function(){};
    state = { koRounds: [[ ${JSON.stringify(matchObj({extraTime:{played:false,skipped:true}}))} ]] };
    resetKOExtraTimeChoice('0.0');
    window.__results.extraTime = state.koRounds[0][0].extraTime;
    window.__results.choiceHtmlAgain = koExtraTimeHtml('0.0', state.koRounds[0][0], [1,1]);
  `);
  assert.deepStrictEqual(Object.assign({}, r.extraTime), { played:false, skipped:false });
  assert.ok(r.choiceHtmlAgain.includes('Extra Time'), 'the choice should be offered again after reverting');
});

test('the revert link disappears once a shootout score has actually been saved, so it can\'t orphan a recorded result', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    const withShootout = ${JSON.stringify(matchObj({ extraTime:{played:true,skipped:false}, shootout:{a:5,b:4,played:true} }))};
    const withoutShootout = ${JSON.stringify(matchObj({ extraTime:{played:true,skipped:false} }))};
    window.__results.withShootoutBadge = koExtraTimeBadgeHtml(withShootout, [1,1], '0.0');
    window.__results.withoutShootoutBadge = koExtraTimeBadgeHtml(withoutShootout, [1,1], '0.0');
  `);
  assert.ok(!r.withShootoutBadge.includes('change'), 'must not offer to revert once a shootout result already exists');
  assert.ok(r.withoutShootoutBadge.includes('change'), 'should still offer to revert before any shootout score is entered');
});
