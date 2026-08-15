const { JSDOM } = require('jsdom');
(async () => {
  console.log('start');
  const dom = new JSDOM(`<!DOCTYPE html><div id="m"></div>`, { runScripts: 'outsideOnly' });
  console.log('dom created');
  await new Promise(r=>setTimeout(r, 200));
  console.log('timer fired, done');
  process.exit(0);
})();
