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
    if(isVisible(el)){
      observer.disconnect();
      topZ+=1;
      el.style.zIndex=String(topZ);
      observer.observe(el,{attributes:true,attributeFilter:['style']});
    }
  });
  observer.observe(el, {attributes:true, attributeFilter:['style']});
  el.style.display='flex';
  await new Promise(r=>setTimeout(r, 300));
  console.log('Total callback invocations after opening one modal:', calls, '| zIndex ended at:', el.style.zIndex);
  el.style.display='none';
  await new Promise(r=>setTimeout(r, 100));
  el.style.display='flex';
  await new Promise(r=>setTimeout(r, 300));
  console.log('After close+reopen, total invocations:', calls, '| zIndex now:', el.style.zIndex);
  process.exit(0);
})();
