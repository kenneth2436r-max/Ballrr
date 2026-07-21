'use strict';
// Tests for computeTournamentChampion() -- reuses the exact same champion-determination logic
// each live bracket view already computes inline (getRoundSlot() for the generic seeded
// bracket, the page3 qualifier/eliminator/final chain, resolveCustomMatch() for custom stages),
// so a recap card (drawTournamentRecapCanvas()) can call out who actually WON a hybrid or
// knockout tournament -- the table alone only ever reflected the league stage, if there was one.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

// Same fixture shape as table-bracket.test.js's baseLeagueState(), since computeTournamentChampion()
// needs to walk the exact same state (fixtures/results/koRounds/page3/customKO) those bracket
// views already render from.
function baseLeagueState(numTeams, extra){
  const teamNames = Array.from({length:numTeams}, (_,i)=>'Team'+i);
  const fixtures = [];
  for(let i=0;i<numTeams;i++) for(let j=i+1;j<numTeams;j++) fixtures.push([i,j]);
  const results = fixtures.map(()=>({played:false,g:[null,null],scorers:[],assists:[]}));
  return Object.assign({
    formatType:'league', numTeams, teamNames, fixtures, results,
    captains:Array.from({length:numTeams},()=>''), customKO:{enabled:false,stages:[]},
    page3:null, koRounds:null,
  }, extra);
}

test('computeTournamentChampion falls back to the league table leader when there is no knockout stage at all', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(3);
  st.results = st.results.map((r,i)=>({...r, played:true, g: i===0?[2,1]:i===1?[3,0]:[1,1]}));
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    window.__results.champion = computeTournamentChampion();
  `);
  // Team0 beat Team1 2-1 and Team2 3-0, so Team0 tops the table on 6 points.
  assert.strictEqual(r.champion, 'Team0');
});

test('computeTournamentChampion returns null for a pure league tournament with nothing played yet', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseLeagueState(3))};
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, null);
});

test('computeTournamentChampion follows the page3 qualifier/eliminator/final chain, same as the live bracket banner', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(3, {
    page3:{
      qualifier:{played:true,g:[2,1],scorers:[],assists:[]},
      eliminator:{played:true,g:[3,0],scorers:[],assists:[]},
      final:{played:true,g:[1,0],scorers:[],assists:[]},
    }
  });
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]})); // Team0 tops the group stage
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    window.__results.champion = computeTournamentChampion();
  `);
  // 1st (Team0) beats 3rd (Team2) in the qualifier, 2nd (Team1) beats loser-of-qualifier (Team2)
  // in the eliminator, qualifier winner (Team0) beats eliminator winner (Team1) in the final.
  assert.strictEqual(r.champion, 'Team0');
});

test('computeTournamentChampion returns null for page3 until the final is actually decided', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(3, {
    page3:{
      qualifier:{played:true,g:[2,1],scorers:[],assists:[]},
      eliminator:{played:true,g:[3,0],scorers:[],assists:[]},
      final:{played:false,g:[null,null],scorers:[],assists:[]},
    }
  });
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]}));
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, null, 'no champion yet with the Grand Final unplayed');
});

test('computeTournamentChampion walks the generic seeded bracket via ensureKORounds()/getRoundSlot(), same as the live Table-tab bracket', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(4);
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]})); // Team0 tops the group stage on 9pts, then 1/2/3
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    ensureKORounds();
    // Seeded bracket for 4 teams: semi 1 = rank1 vs rank4, semi 2 = rank2 vs rank3.
    // Group stage above ranks them Team0(1st) > Team1(2nd) > Team2(3rd) > Team3(4th).
    state.koRounds[0][0].played = true; state.koRounds[0][0].g = [3, 0]; // Team0 beats Team3
    state.koRounds[0][1].played = true; state.koRounds[0][1].g = [2, 0]; // Team1 beats Team2
    state.koRounds[1][0].played = true; state.koRounds[1][0].g = [1, 0]; // Team0 beats Team1 in the final
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, 'Team0');
});

test('computeTournamentChampion returns null for the seeded bracket until the final is decided', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(4);
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]}));
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    ensureKORounds();
    state.koRounds[0][0].played = true; state.koRounds[0][0].g = [3, 0];
    state.koRounds[0][1].played = true; state.koRounds[0][1].g = [2, 0];
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, null, 'the final has not been played yet');
});

test('computeTournamentChampion resolves a custom KO stage via resolveCustomMatch()', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(2, {
    customKO:{enabled:true, stages:[{name:'Final', matches:[{a:{type:'rank',val:1},b:{type:'rank',val:2}}]}]},
    customResults:[[{played:true,g:[2,0],scorers:[],assists:[]}]],
  });
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]})); // Team0 tops the (2-team) group stage
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, 'Team0', 'rank1 (Team0) beat rank2 (Team1) 2-0 in the only custom stage match');
});

test('computeTournamentChampion returns null for a pure knockout format with nothing decided', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseLeagueState(4, { formatType:'knockout', results:[], fixtures:[] }))};
    window.__results.champion = computeTournamentChampion();
  `);
  assert.strictEqual(r.champion, null);
});
