'use strict';
// Production build step for Ballrr's single-file app.
//
// WHY THIS EXISTS: public/index.html is the readable, hand-edited source (and what
// tests/helpers/harness.js reads directly for the whole test suite -- that stays unchanged, this
// script never touches it). But shipping it to users as-is means: (a) the ~13k-line main script
// and the whole stylesheet are inlined into the HTML with no filename of their own, so the
// browser/WebView can never cache them independently of the page -- every deploy invalidates
// EVERYTHING, and firebase.json's blanket `Cache-Control: no-cache` on every path means literally
// nothing is ever cached, full stop; and (b) it ships full comments and long variable names to
// every device on every load. Both were flagged as real contributors to the app feeling less
// smooth than it could.
//
// This script extracts the one big inline <style> block and the one big inline main <script>
// block (NOT the tiny theme pre-paint script, and NOT the external CDN <script src> tags -- both
// stay inline/as-is), minifies each with esbuild, writes them to content-hashed files under
// dist/assets/, and writes a dist/index.html that references those hashed files instead of
// inlining them. firebase.json (see the hosting.public change alongside this) then serves
// dist/ instead of public/, with the hashed asset files given a long, immutable Cache-Control
// (safe: a content change means a new filename) while index.html keeps a short/no-cache policy
// so a fresh deploy is picked up promptly.
//
// Usage: node build.js   (or `npm run build`)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = __dirname;
const SRC_HTML = path.join(ROOT, 'public', 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

function hashOf(content){
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

// Copies everything from public/ into dist/ EXCEPT index.html itself (which we build specially
// below) -- manifest.json, icons, any other static files the app references. Deliberately
// additive/overwrite-in-place rather than wiping dist/ first: some sandboxed/managed filesystems
// (this repo's own Cowork-mounted workspace folder included) refuse to delete files once written,
// and there's no correctness need to delete anyway -- content-hashed asset filenames mean an old
// build's app.<hash>.js/css from a previous run is simply never referenced by the new index.html,
// harmless if it lingers in dist/assets/.
function copyStaticAssets(){
  const publicDir = path.join(ROOT, 'public');
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  for(const entry of fs.readdirSync(publicDir, { withFileTypes: true })){
    if(entry.name === 'index.html') continue;
    const src = path.join(publicDir, entry.name);
    const dest = path.join(DIST_DIR, entry.name);
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
}

function extractBlock(html, tagRegex){
  const matches = [...html.matchAll(tagRegex)];
  if(!matches.length) throw new Error('No matches for ' + tagRegex);
  // The main script/style block is always the LARGEST match -- same heuristic
  // tests/helpers/harness.js already uses, robust to small inline scripts (theme pre-paint) being
  // added/removed/reordered around it.
  matches.sort((a, b) => b[1].length - a[1].length);
  return matches[0];
}

function build(){
  const html = fs.readFileSync(SRC_HTML, 'utf8');

  const styleMatch = extractBlock(html, /<style>([\s\S]*?)<\/style>/g);
  const scriptMatch = extractBlock(html, /<script>([\s\S]*?)<\/script>/g);

  if(scriptMatch[1].length < 10000){
    throw new Error('Main <script> block looks too small (' + scriptMatch[1].length + ' chars) -- did public/index.html change structure? Refusing to build against what might be the wrong block.');
  }

  const minifiedCss = esbuild.transformSync(styleMatch[1], { loader: 'css', minify: true }).code;
  const minifiedJs = esbuild.transformSync(scriptMatch[1], { loader: 'js', minify: true, target: 'es2019' }).code;

  const cssHash = hashOf(minifiedCss);
  const jsHash = hashOf(minifiedJs);
  const cssFilename = `app.${cssHash}.css`;
  const jsFilename = `app.${jsHash}.js`;

  copyStaticAssets();
  fs.writeFileSync(path.join(ASSETS_DIR, cssFilename), minifiedCss);
  fs.writeFileSync(path.join(ASSETS_DIR, jsFilename), minifiedJs);

  let outHtml = html;
  outHtml = outHtml.replace(styleMatch[0], `<link rel="stylesheet" href="/assets/${cssFilename}">`);
  // `defer` is safe here because the original inline script sits at the very end of <body> (after
  // every element it queries), so it already only ever ran once the whole document was parsed --
  // deferring an external script to the same "after parsing, in order" point is equivalent.
  outHtml = outHtml.replace(scriptMatch[0], `<script src="/assets/${jsFilename}" defer></script>`);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), outHtml);

  const origSize = html.length;
  const newHtmlSize = outHtml.length;
  const report = {
    'original index.html': origSize + ' bytes',
    'built index.html (shell only)': newHtmlSize + ' bytes',
    [cssFilename]: minifiedCss.length + ' bytes (was ' + styleMatch[1].length + ')',
    [jsFilename]: minifiedJs.length + ' bytes (was ' + scriptMatch[1].length + ')',
    'total shipped on first load': (newHtmlSize + minifiedCss.length + minifiedJs.length) + ' bytes vs ' + origSize + ' before',
  };
  console.log('Build complete -> dist/');
  console.table ? console.table(report) : console.log(report);
}

build();
