'use strict';
// Table tab -> knockout bracket handoff: once every group-stage match is played, the Table tab
// should switch to showing the live bracket (in addition to the final standings), for both the
// 3-team page-playoff format and the generic seeded bracket used for 4+ teams. Pure knockout
// (no group stage) and customKO (variable stage list) are unaffected by this change.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

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

test('bracket stays hidden while group-stage matches remain unplayed', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(baseLeagueState(3, { page3:{qualifier:{played:false,g:[null,null],scorers:[],assists:[]},eliminator:{played:false,g:[null,null],scorers:[],assists:[]},final:{played:false,g:[null,null],scorers:[],assists:[]}} }))};
    renderTable();
    window.__results.koDisplay = document.getElementById('knockout-table-container').style.display;
  `);
  assert.strictEqual(r.koDisplay, 'none');
});

test('3-team page-playoff bracket appears on the Table tab once the group stage is complete', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(3, { page3:{qualifier:{played:false,g:[null,null],scorers:[],assists:[]},eliminator:{played:false,g:[null,null],scorers:[],assists:[]},final:{played:false,g:[null,null],scorers:[],assists:[]}} });
  st.results = st.results.map((r,i)=>({...r, played:true, g: i===0?[2,1]:i===1?[3,0]:[1,1]})); // all 3 group games played
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    renderTable();
    window.__results.koDisplay = document.getElementById('knockout-table-container').style.display;
    window.__results.bracketHtml = document.getElementById('knockout-table-container').innerHTML;
  `);
  assert.strictEqual(r.koDisplay, '');
  assert.ok(r.bracketHtml.includes('Qualifier'));
  assert.ok(r.bracketHtml.includes('Eliminator'));
  assert.ok(r.bracketHtml.includes('Final'));
});

test('page3 bracket correctly advances the qualifier winner and shows the champion once the final is decided', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(3, {
    page3:{
      qualifier:{played:true,g:[2,1],scorers:[],assists:[]}, // 1st beats 3rd -> qualifier winner is 1st place team
      eliminator:{played:true,g:[3,0],scorers:[],assists:[]}, // 2nd beats loser-of-qualifier (3rd)
      final:{played:true,g:[1,0],scorers:[],assists:[]}, // qualifier winner beats eliminator winner
    }
  });
  st.results = st.results.map((r,i)=>({...r, played:true, g:[1,0]})); // group stage all played, arbitrary scores
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    renderTable();
    window.__results.bracketHtml = document.getElementById('knockout-table-container').innerHTML;
  `);
  assert.ok(r.bracketHtml.includes('🏆 Champion'), 'champion banner should appear once the final has a decisive result');
  assert.ok((r.bracketHtml.match(/advancing/g)||[]).length >= 3, 'qualifier winner, eliminator winner, and champion should all be marked advancing');
});

test('4-team hybrid (league then knockout) reuses the generic bracket on the Table tab once the group stage ends', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(4);
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]})); // all 6 group games played
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    renderTable();
    window.__results.koDisplay = document.getElementById('knockout-table-container').style.display;
    window.__results.bracketHtml = document.getElementById('knockout-table-container').innerHTML;
  `);
  assert.strictEqual(r.koDisplay, '');
  assert.ok(r.bracketHtml.includes('bracket-match'), 'the seeded bracket tree should have rendered into the Table tab container');
});

test('customKO hybrids do not get a Table-tab bracket -- their stage list is too variable to visualize generically', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(4, { customKO:{enabled:true,stages:[{name:'Semis'}]} });
  st.results = st.results.map(r=>({...r, played:true, g:[1,0]}));
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    renderTable();
    window.__results.koDisplay = document.getElementById('knockout-table-container').style.display;
  `);
  assert.strictEqual(r.koDisplay, 'none');
});

test('pure knockout format is unaffected by the hybrid-bracket change', () => {
  const { window } = freshWindow();
  const st = baseLeagueState(4, { formatType:'knockout', results:[], fixtures:[] });
  const r = runInOneEval(window, `
    state = ${JSON.stringify(st)};
    renderTable();
    window.__results.leagueDisplay = document.getElementById('league-table-elements').style.display;
    window.__results.koDisplay = document.getElementById('knockout-table-container').style.display;
  `);
  assert.strictEqual(r.leagueDisplay, 'none');
  assert.strictEqual(r.koDisplay, '');
});
