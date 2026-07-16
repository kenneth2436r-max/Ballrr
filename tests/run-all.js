'use strict';
// Runs each *.test.js file as its own `node --test` child process, one at a time.
//
// WHY NOT JUST `node --test tests/*.test.js`: running all files in one invocation hits a
// reproducible hang in this environment once 3+ files run together (auth-gate + data-leak +
// notifications-native was the smallest repro; any 2 of the 6 files together are fine, 3+
// together stalls forever, order-independent). It reproduces identically with default
// (worker-thread) isolation and with --experimental-test-isolation=process, and persists with
// --test-concurrency=1, which points at Node's cross-file worker/thread-pool handling under
// jsdom rather than anything wrong in the app or test logic -- each file passes cleanly and
// deterministically on its own. Giving every file its own process sidesteps it entirely and is
// also what most CI setups end up doing anyway (clean process per suite, no shared state).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

if(!files.length){
  console.error('No *.test.js files found in ' + dir);
  process.exit(1);
}

let totalPass = 0, totalFail = 0;
const failedFiles = [];

for(const f of files){
  const full = path.join(dir, f);
  console.log('\n\x1b[36m=== ' + f + ' ===\x1b[0m');
  const res = spawnSync(process.execPath, ['--test', '--test-force-exit', full], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    timeout: 30000,
  });
  const out = res.stdout || '';
  process.stdout.write(out);
  // Node's test runner reporter formats its summary line differently across versions/platforms
  // -- TAP-style output prefixes it with "# " (e.g. "# pass 4"), the default "spec" reporter
  // used on some setups (seen on Windows/PowerShell) prefixes it with "ℹ " instead (e.g.
  // "ℹ pass 4"). Matching on the trailing "pass N" / "fail N" regardless of the prefix
  // character handles both.
  const passMatch = out.match(/pass (\d+)/);
  const failMatch = out.match(/fail (\d+)/);
  const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
  const fail = failMatch ? parseInt(failMatch[1], 10) : 0;
  totalPass += pass;
  totalFail += fail;
  if(res.status !== 0 || fail > 0 || res.error || res.signal){
    failedFiles.push(f + (res.signal ? ' (signal: ' + res.signal + ')' : ''));
  }
}

console.log('\n\x1b[1m=== TOTAL: ' + totalPass + ' passed, ' + totalFail + ' failed, across ' + files.length + ' files ===\x1b[0m');
if(failedFiles.length){
  console.log('\x1b[31mFailed files:\x1b[0m\n  ' + failedFiles.join('\n  '));
  process.exit(1);
}
process.exit(0);
