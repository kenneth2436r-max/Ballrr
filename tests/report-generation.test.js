'use strict';
// Tests for the player/tournament PDF report feature (buildPlayerReportData/
// buildHostPlayerReportData/buildVerifiedPlayerReportData, buildTournamentReportData,
// computeTournamentAwardsFromPlayerStats, appearanceRowsFromHistory/appearanceRowsFromHostHistory,
// reportFilename, and the download*Report() entry points' early-exit/alert behavior).
//
// generatePlayerReportPdf()/generateTournamentReportPdf() themselves (the actual jsPDF drawing
// calls) are NOT exercised here -- jsPDF is loaded from a CDN <script> tag in <head>, which this
// jsdom harness (like the app's real code) never fetches, so `window.jspdf` doesn't exist in this
// environment. Everything that can be tested without it -- all the data assembly/normalization
// that feeds those generators, plus every early-exit path that returns before touching jsPDF at
// all -- is covered here instead. The generators were syntax-checked (node --check) and are thin,
// mostly-declarative jsPDF/autoTable calls built directly from this already-tested data.
const test = require('node:test');
const assert = require('node:assert');
const { freshWindow, runInOneEval } = require('./helpers/harness');

test('reportFilename sanitizes a player/tournament name into a safe, lowercase filename', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.a = reportFilename('Keith O\\'Brien', 'scouting-report');
    window.__results.b = reportFilename('  Sunday 5-a-side League!! ', 'tournament-report');
    window.__results.c = reportFilename('', 'scouting-report');
  `);
  assert.strictEqual(r.a, 'keith-o-brien-scouting-report.pdf');
  assert.strictEqual(r.b, 'sunday-5-a-side-league-tournament-report.pdf');
  assert.strictEqual(r.c, 'report-scouting-report.pdf');
});

test('computeTournamentAwardsFromPlayerStats computes all four end-of-tournament awards from a playerStats array', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.awards = computeTournamentAwardsFromPlayerStats([
      { name:'Keith', team:'Red FC', position:'MID', avg:8, count:2, goals:1, assists:3, cleanSheets:0 },
      { name:'Densil', team:'Blue FC', position:'FWD', avg:9, count:1, goals:4, assists:0, cleanSheets:0 },
      { name:'Sam', team:'Blue FC', position:'GK', avg:7, count:2, goals:0, assists:0, cleanSheets:2 }
    ]);
  `);
  const byLabel = name => r.awards.find(a => a.label === name);
  assert.strictEqual(byLabel('Golden Boot').name, 'Densil', '4 goals beats 1');
  assert.strictEqual(byLabel('Playmaker').name, 'Keith', 'only Keith has any assists');
  assert.strictEqual(byLabel('Golden Glove').name, 'Sam', 'only Sam has clean sheets');
  // POTM prefers a 2+ match sample over a single standout cameo -- Densil's 9 avg is higher than
  // Keith's 8, but Densil only played 1 match, so Keith (2 matches) should still win it.
  assert.strictEqual(byLabel('Player of the Tournament').name, 'Keith');
});

test('computeTournamentAwardsFromPlayerStats falls back to single-match ratings when nobody has played more than one match, and returns [] for no data', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.oneMatchEach = computeTournamentAwardsFromPlayerStats([
      { name:'Keith', team:'Red FC', avg:6, count:1, goals:0, assists:0, cleanSheets:0 },
      { name:'Densil', team:'Blue FC', avg:9, count:1, goals:0, assists:0, cleanSheets:0 }
    ]);
    window.__results.empty = computeTournamentAwardsFromPlayerStats([]);
    window.__results.nothing = computeTournamentAwardsFromPlayerStats(null);
  `);
  const potm = r.oneMatchEach.find(a => a.label === 'Player of the Tournament');
  assert.strictEqual(potm.name, 'Densil', 'no one has 2+ matches, so fall back to plain highest average');
  assert.strictEqual(Array.from(r.empty).length, 0);
  assert.strictEqual(Array.from(r.nothing).length, 0);
});

test('appearanceRowsFromHistory builds one row per tournamentHistory-shaped entry the player appears in, skipping entries they are not in or played 0 matches in', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.rows = appearanceRowsFromHistory([
      { date:'2026-07-01', label:'Summer Cup', playerStats:[{ name:'Keith', team:'Red FC', avg:7, count:2, goals:1, assists:2, cleanSheets:0 }] },
      { date:'2026-06-01', label:'Spring Cup', playerStats:[{ name:'Someone Else', avg:5, count:1, goals:0, assists:0, cleanSheets:0 }] },
      { date:'2026-05-01', label:'📍 Match played elsewhere', external:true, playerStats:[{ name:'Keith', avg:6, count:0, goals:0, assists:0, cleanSheets:0 }] }
    ], 'Keith');
  `);
  assert.strictEqual(r.rows.length, 1, 'only the entry Keith actually played matches in should produce a row');
  assert.strictEqual(r.rows[0].label, 'Summer Cup');
  assert.strictEqual(r.rows[0].goals, 1);
  assert.strictEqual(r.rows[0].assists, 2);
});

test('appearanceRowsFromHostHistory unwraps a followed host\'s lastPastTournamentsList shape (label/dateStr on the wrapper, playerStats under .snapshot)', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.rows = appearanceRowsFromHostHistory([
      { label:'Host Cup', dateStr:'2026-07-15', snapshot:{ playerStats:[{ name:'Keith', team:'Red FC', avg:8, count:3, goals:2, assists:1, cleanSheets:1 }] } },
      { label:'No Snapshot Entry', dateStr:'2026-07-01' }
    ], 'Keith');
  `);
  assert.strictEqual(r.rows.length, 1, 'entries with no snapshot at all must not crash or produce a row');
  assert.strictEqual(r.rows[0].label, 'Host Cup');
  assert.strictEqual(r.rows[0].date, '2026-07-15');
  assert.strictEqual(r.rows[0].matches, 3);
});

function careerFixture(){
  return {
    careerSnapshotSaved: true, results: [], playerDB: [], numTeams: 2, teamNames: ['Red FC', 'Blue FC'],
    tournamentHistory: [
      { id: 't1', date: '2026-07-01', label: 'Summer Cup',
        playerStats: [{ name: 'Keith', team: 'Red FC', position: 'MID', avg: 7.5, count: 2, goals: 1, assists: 2, cleanSheets: 0 }] }
    ]
  };
}

test('buildPlayerReportData returns an unrated (no ovr/attrs) object for a player with zero recorded matches, same gate as the FIFA card', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(careerFixture())};
    window.__results.d = buildPlayerReportData('Nobody');
  `);
  assert.strictEqual(r.d.matches, 0);
  assert.strictEqual(r.d.ovr, undefined, 'no ovr should be computed for a player with nothing to rate');
});

test('buildPlayerReportData returns ovr/tier/attrs and a sorted appearance history for a rated player', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(careerFixture())};
    window.__results.d = buildPlayerReportData('Keith');
  `);
  const d = r.d;
  assert.ok(typeof d.ovr === 'number' && d.ovr >= 40 && d.ovr <= 99);
  assert.ok(d.tier && d.tier.name);
  assert.ok(d.attrs && typeof d.attrs.pac === 'number');
  assert.strictEqual(d.appearances.length, 1);
  assert.strictEqual(d.appearances[0].label, 'Summer Cup');
});

test('buildTournamentReportData ranks top scorers/assists/clean sheets and computes awards + format label from a saved entry', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.t = buildTournamentReportData({
      id: 't1', label: 'Summer Cup', date: '2026-07-01', champion: 'Red FC', numTeams: 4, legs: 1,
      table: [{ name:'Red FC', p:3, w:2, d:1, l:0, gf:6, ga:2, gd:4, pts:7 }],
      matches: [{ stage:'League', teamA:'Red FC', teamB:'Blue FC', scoreA:2, scoreB:1, scorers:[{ name:'Keith' }] }],
      playerStats: [
        { name:'Keith', team:'Red FC', avg:8, count:2, goals:3, assists:1, cleanSheets:0 },
        { name:'Densil', team:'Blue FC', avg:7, count:2, goals:1, assists:2, cleanSheets:1 }
      ]
    });
  `);
  const t = r.t;
  assert.strictEqual(t.format, '4 teams');
  assert.strictEqual(t.champion, 'Red FC');
  assert.strictEqual(t.topScorers[0].name, 'Keith');
  assert.strictEqual(t.topAssists[0].name, 'Densil');
  assert.strictEqual(t.topCleanSheets[0].name, 'Densil');
  assert.ok(t.awards.length >= 1);
  assert.strictEqual(t.table[0].name, 'Red FC');
  assert.strictEqual(t.matches[0].teamA, 'Red FC');
});

test('buildTournamentReportData labels a Log External Tournament entry distinctly and returns null for no entry', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.t = buildTournamentReportData({
      id:'ext1', label:'🏆 Sunday League', date:'2026-07-01', external:true,
      numTeams:null, legs:null, table:[], matches:[],
      playerStats:[{ name:'Keith', avg:7, count:3, goals:2, assists:1, cleanSheets:0 }]
    });
    window.__results.none = buildTournamentReportData(null);
  `);
  assert.strictEqual(r.t.format, 'Logged externally');
  assert.strictEqual(r.none, null);
});

test('downloadTournamentReport alerts (without crashing on missing jsPDF) when the tournament id does not exist', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = { tournamentHistory: [] };
    downloadTournamentReport('does-not-exist');
    window.__results.alerts = window.__alerts;
  `);
  assert.ok(r.alerts.some(a => /could not find/i.test(a)));
});

test('downloadPlayerReport alerts instead of building a PDF when the player has no recorded matches', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    state = ${JSON.stringify(careerFixture())};
    downloadPlayerReport('Nobody');
    window.__results.alerts = window.__alerts;
  `);
  assert.ok(r.alerts.some(a => /nothing to put in a report/i.test(a)));
});

test('downloadHostPlayerReport alerts when there is no public data for that player', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    lastPastTournamentsList = [];
    downloadHostPlayerReport('Nobody');
    window.__results.alerts = window.__alerts;
  `);
  assert.ok(r.alerts.some(a => /no public tournament stats/i.test(a)));
});

test('buildHostPlayerReportData returns null for a player with no public data, and a finalized report (with appearances) for one that has some', () => {
  const { window } = freshWindow();
  const r = runInOneEval(window, `
    window.__results.missing = buildHostPlayerReportData('Nobody');
    lastPastTournamentsList = [
      { label:'Host Cup', dateStr:'2026-07-15', startedAt:1000,
        snapshot:{ playerStats:[{ name:'Keith', team:'Red FC', position:'MID', avg:8, count:2, goals:2, assists:1, cleanSheets:0 }] } }
    ];
    window.__results.found = buildHostPlayerReportData('Keith');
  `);
  assert.strictEqual(r.missing, null);
  assert.ok(r.found.ovr);
  assert.strictEqual(r.found.appearances.length, 1);
  assert.strictEqual(r.found.appearances[0].label, 'Host Cup');
});

test('buildVerifiedPlayerReportData returns null for an unverified uid, and a finalized report for a real one', async () => {
  const dbStore = {};
  dbStore['verifiedPlayers/samUid'] = { uid: 'samUid', name: 'Samuel', nameLower: 'samuel' };
  dbStore['verifiedPlayers/samUid/contributions/orgA_t1'] = {
    tournamentId: 't1', contributingUid: 'orgA',
    playerStats: { name: 'Sam', team: 'Red FC', avg: 7, count: 2, goals: 1, assists: 0, cleanSheets: 0, matchRatings: [7, 7] }
  };
  const { window } = freshWindow({ dbStore });
  runInOneEval(window, `
    window.__testDone = (async () => {
      window.__results.missing = await buildVerifiedPlayerReportData('nobodyUid');
      window.__results.found = await buildVerifiedPlayerReportData('samUid');
    })();
  `);
  await window.__testDone;
  assert.strictEqual(window.__results.missing, null);
  assert.ok(window.__results.found.ovr);
  assert.strictEqual(window.__results.found.name, 'Samuel');
});
