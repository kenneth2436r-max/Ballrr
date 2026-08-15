const { JSDOM } = require('jsdom');
(async () => {
  const dom = new JSDOM(`<!DOCTYPE html><div class="modal-overlay" id="m" style="display:none"></div>`, { runScripts: 'outsideOnly' });
  const { window } = dom;
  const el = window.document.getElementById('m');
  let calls = 0;
  let topZ = 9998;
  function isVisible(el){ const d=el.style.display; return d==='flex'||d==='block'; }
  const observer = new window.MutationObserver(()=>{
    calls++;
    if(calls > 500){ console.log('RUNAWAY LOOP CONFIRMED after', calls, 'callback invocations'); process.exit(0); }
    if(isVisible(el)){
      topZ+=1;
      el.style.zIndex=String(topZ);
    }
  });
  observer.observe(el, {attributes:true, attributeFilter:['style']});
  el.style.display='flex'; // simulate opening a modal
  // let microtasks/timers flush
  await new Promise(r=>setTimeout(r, 200));
  console.log('Total observer callback invocations after opening one modal:', calls);
})();
