'use strict';
// Shared jsdom test harness for the Ballrr app's shared-tournament / notification logic.
//
// IMPORTANT jsdom quirk: separate window.eval() calls do NOT reliably share top-level `let`
// bindings (state, currentUser, sharedMeta, pendingFollowCode, etc.) the way a real browser's
// multiple <script> tags do -- a function closure created in one eval() call keeps seeing
// whatever those variables were AT THAT CALL's creation time, and never sees a later, separate
// eval() call's reassignment. Confirmed via a minimal repro during development. The safe
// pattern is: combine the app source AND any driver code that reads/writes those globals into
// ONE single eval() string, every time -- see runInOneEval() below.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Pulls the app's main inline <script>...</script> block out of the built HTML. There are a
// few tiny inline scripts (theme pre-paint, etc.) before it; the main one is identified as the
// largest script block, which is robust to those small ones being added/removed/reordered.
function extractAppScript(){
  const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.sort((a, b) => b.length - a.length);
  if(!blocks.length || blocks[0].length < 10000){
    throw new Error('Could not find the main app <script> block in public/index.html -- did the file structure change?');
  }
  return blocks[0];
}

const APP_SRC = extractAppScript();

// In-memory Firestore mock: supports get/set/update/onSnapshot, arrayUnion/arrayRemove field
// values, dotted-path field updates (e.g. 'memberNames.'+uid), and nested collections (used
// for shared/{code}/payload/main).
function makeFirebaseMock(dbStore){
  const listeners = {};
  function notify(path){
    (listeners[path] || []).forEach(cb => {
      const exists = Object.prototype.hasOwnProperty.call(dbStore, path);
      cb({ exists, data: () => exists ? dbStore[path] : undefined, id: path.split('/').pop(), metadata: { hasPendingWrites: false } });
    });
  }
  function applyFieldValues(existing, patch){
    const out = { ...existing };
    for(const k of Object.keys(patch)){
      const v = patch[k];
      if(v && v.__arrayUnion){
        const cur = out[k] || [];
        out[k] = [...cur, ...v.__arrayUnion.filter(x => !cur.includes(x))];
      }else if(v && v.__arrayRemove){
        const cur = out[k] || [];
        out[k] = cur.filter(x => !v.__arrayRemove.includes(x));
      }else if(k.includes('.')){
        const [parent, child] = k.split('.');
        out[parent] = { ...(out[parent] || {}), [child]: v };
      }else{
        out[k] = v;
      }
    }
    return out;
  }
  function docRef(p){
    return {
      get: () => Promise.resolve({ exists: Object.prototype.hasOwnProperty.call(dbStore, p), data: () => dbStore[p], id: p.split('/').pop() }),
      set: (data, opts) => {
        dbStore[p] = (opts && opts.merge) ? { ...(dbStore[p] || {}), ...data } : data;
        notify(p);
        return Promise.resolve();
      },
      update: (patch) => {
        if(!Object.prototype.hasOwnProperty.call(dbStore, p)) return Promise.reject(new Error('not-found'));
        dbStore[p] = applyFieldValues(dbStore[p], patch);
        notify(p);
        return Promise.resolve();
      },
      delete: () => { delete dbStore[p]; notify(p); return Promise.resolve(); },
      onSnapshot: (cb) => {
        listeners[p] = listeners[p] || [];
        listeners[p].push(cb);
        const exists = Object.prototype.hasOwnProperty.call(dbStore, p);
        cb({ exists, data: () => dbStore[p], id: p.split('/').pop(), metadata: { hasPendingWrites: false } });
        return () => { listeners[p] = (listeners[p] || []).filter(x => x !== cb); };
      },
      collection: (sub) => ({ doc: (id) => docRef(p + '/' + sub + '/' + id) })
    };
  }
  let authCb = null;
  let anonSignInCalls = 0;
  const firebase = {
    initializeApp: () => {},
    auth: Object.assign(() => ({
      setPersistence: () => Promise.resolve(),
      onAuthStateChanged: (cb) => { authCb = cb; },
      signInWithPopup: () => Promise.resolve(),
      signInWithRedirect: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
      getRedirectResult: () => Promise.resolve({ user: null }),
      // Mirrors real Firebase: calling this itself fires onAuthStateChanged with a new
      // (anonymous-shaped) user, same as signInWithPopup would for a real account.
      signInAnonymously: () => {
        anonSignInCalls++;
        const u = { uid: 'anon-test-uid', isAnonymous: true, displayName: null, email: null };
        if(authCb) setTimeout(() => authCb(u), 0);
        return Promise.resolve({ user: u });
      },
    }), { Auth: { Persistence: { LOCAL: 'local' } }, GoogleAuthProvider: function(){} }),
    firestore: Object.assign(() => ({
      collection: (name) => ({ doc: (id) => docRef(name + '/' + id) })
    }), {
      FieldValue: {
        arrayUnion: (...items) => ({ __arrayUnion: items }),
        arrayRemove: (...items) => ({ __arrayRemove: items }),
      }
    })
  };
  return { firebase, triggerAuth: (user) => authCb && authCb(user), dbStore, getAnonSignInCalls: () => anonSignInCalls };
}

// A fresh jsdom window with the app's Firebase calls mocked out and any missing DOM element
// auto-stubbed (the app touches hundreds of ids we don't care about for logic tests).
function freshWindow({ dbStore = {}, urlSuffix = '', activeCode = null, localPrefs = null, extraHtml = '' } = {}){
  const html = `<!doctype html><html><body>
    <div id="auth-gate" style="display:none"><div id="auth-status-text"></div><button id="auth-offline-btn"></button><button id="auth-open-browser-btn"></button></div>
    <div id="pending-approval-screen" style="display:none"><div id="pending-approval-text"></div><div id="pending-approval-code"></div></div>
    <div id="notif-status-text"></div><button id="notif-btn-on"></button><button id="notif-btn-off"></button>
    <button id="sound-btn-on"></button><button id="sound-btn-off"></button>
    ${extraHtml}
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tournament-tracker-f343b.web.app/' + (urlSuffix ? ('?' + urlSuffix) : '') });
  const { window } = dom;
  const { firebase, triggerAuth, getAnonSignInCalls } = makeFirebaseMock(dbStore);
  window.firebase = firebase;
  window.__alerts = [];
  window.alert = (m) => window.__alerts.push(m);
  window.confirm = () => true;
  window.prompt = (msg, def) => (def !== undefined ? def : '');
  window.console = console;
  window.navigator.vibrate = () => {};
  if(activeCode) window.localStorage.setItem('ballrr_shared_code_v1', activeCode);
  if(localPrefs) window.localStorage.setItem('ballrr_local_prefs_v1', JSON.stringify(localPrefs));
  const realGetById = window.document.getElementById.bind(window.document);
  const stubCache = {};
  window.document.getElementById = (id) => {
    const real = realGetById(id);
    if(real) return real;
    if(!stubCache[id]) stubCache[id] = window.document.createElement('div');
    return stubCache[id];
  };
  return { window, dom, dbStore, triggerAuth, getAnonSignInCalls };
}

// Runs driver code in the SAME eval() call as the app source -- see the jsdom quirk note up
// top for why this matters. Stubs out heavy rendering/bootstrap functions we don't want to
// exercise in a logic test.
function runInOneEval(window, driverCode){
  window.__results = {};
  const combined = APP_SRC + '\n' +
    // NOTE: diffAndQueueCommentary/diffAndNotifyKickoffs/handleSharedMetaSnap are intentionally
    // NOT stubbed here -- several test files exercise the real versions directly. Tests that
    // don't care about commentary side effects (e.g. auth-gate flow tests) are unaffected since
    // subscribeSharedPayload()'s sharedPayloadFirstLoad flag already skips commentary on a
    // first load, which is what those tests exercise.
    'startApp=function(){window.__startAppCalled=true;};renderAll=function(){};ensureShape=function(){};openCheckinPicker=function(){window.__checkinPickerOpened=true;};haptic=function(){};\n' +
    // The app overrides window.alert=showThemedAlert (a DOM-based themed popup) at load time,
    // and calls showThemedConfirm/showThemedPrompt directly instead of window.confirm/prompt
    // (native confirm()/prompt() can't be faked with a themed UI since they must return
    // synchronously). Tests still want the old synchronous-mock contract though, so re-point
    // all three back at window.alert/confirm/prompt here -- this runs AFTER APP_SRC so it wins.
    'window.alert=function(m){window.__alerts.push(m);};\n' +
    'showThemedConfirm=function(msg,onConfirm,onCancel){if(window.confirm(msg)){if(onConfirm)onConfirm();}else if(onCancel)onCancel();};\n' +
    'showThemedPrompt=function(msg,def,onSubmit,onCancel){const v=window.prompt(msg,def);if(v===null){if(onCancel)onCancel();}else if(onSubmit)onSubmit(v);};\n' +
    driverCode;
  window.eval(combined);
  return window.__results;
}

module.exports = { APP_SRC, makeFirebaseMock, freshWindow, runInOneEval };
