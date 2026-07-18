'use strict';
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
  console.log('\n=== ' + f + ' ===');
  const res = spawnSync(process.execPath, ['--test', '--test-force-exit', full], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    timeout: 30000,
  });
  const out = res.stdout || '';
  process.stdout.write(out);
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

console.log('\n=== TOTAL: ' + totalPass + ' passed, ' + totalFail + ' failed, across ' + files.length + ' files ===');
if(failedFiles.length){
  console.log('Failed files:\n  ' + failedFiles.join('\n  '));
  process.exit(1);
}
process.exit(0);
