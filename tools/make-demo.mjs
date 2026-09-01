/* ============================================================
   Bundles the whole app — hub and all five games — into one
   self-contained HTML file, so Playbox can be tried without
   building anything.
     node tools/make-demo.mjs
   The hub's frameLoad() has a seam for this: define PB_INLINE
   and it swaps documents with srcdoc instead of fetching files.
   srcdoc inherits the parent's origin, so the child still
   reaches PB_HOST and shares localStorage exactly as on device.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fingerprint, MARKER } from './fingerprint.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* slugs come from the registry, so a new game joins the preview for free */
const SLUGS = [...rd('shared/registry.js').matchAll(/slug: '([a-z0-9]+)'/g)].map(m => m[1]);

/* ---------- inline one game into a single document ---------- */
function inlineGame(slug) {
  let html = rd(`games/${slug}/index.html`);
  html = html.replace('<link rel="stylesheet" href="../../shared/style.css">',
    '<style>' + rd('shared/style.css') + '</style>');
  for (const f of ['ad-config.js', 'ads.js', 'pb-child.js', 'engine.js']) {
    const tag = `<script src="../../shared/${f}"></script>`;
    if (!html.includes(tag)) throw new Error(`${slug}: expected ${tag}`);
    html = html.replace(tag, '<script>' + rd(`shared/${f}`) + '<\/script>');
  }
  html = html.replace('<script src="game.js"></script>',
    '<script>' + rd(`games/${slug}/game.js`) + '<\/script>');
  const left = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
    .map(m => m[1]).filter(u => !u.startsWith('data:'));
  if (left.length) throw new Error(`${slug}: un-inlined reference(s): ${left.join(', ')}`);
  return html;
}

/* ---------- inline the hub ---------- */
let hub = rd('index.html');
hub = hub.replace('<link rel="stylesheet" href="shared/style.css">',
  '<style>' + rd('shared/style.css') + '</style>');
for (const f of ['ad-config.js', 'ads.js', 'engine.js', 'art.js', 'registry.js', 'profile.js']) {
  const tag = `<script src="shared/${f}"></script>`;
  if (!hub.includes(tag)) throw new Error(`hub: expected ${tag}`);
  hub = hub.replace(tag, '<script>' + rd(`shared/${f}`) + '<\/script>');
}

/* the games' documents, and the seam, injected just before hub.js runs */
const payload = {};
for (const s of SLUGS) payload[s] = Buffer.from(inlineGame(s), 'utf8').toString('base64');

const seam = `<script>
/* Base64 rather than a JS string literal: a game's markup contains a closing
   script tag, backticks and every quote style, any of which would end this
   block early or break the literal. Base64 has no edge cases. */
window.PB_GAMES_B64 = ${JSON.stringify(payload)};
(function () {
  var dec = new TextDecoder();
  window.PB_INLINE = function (url) {
    var m = /games\\/([a-z0-9]+)\\//.exec(url || '');
    var b64 = m && window.PB_GAMES_B64[m[1]];
    if (!b64) return '';
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return dec.decode(bytes);
  };
})();
<\/script>
`;

const hubTag = '<script src="hub/hub.js"></script>';
if (!hub.includes(hubTag)) throw new Error('hub: expected ' + hubTag);
hub = hub.replace(hubTag, seam + '<script>' + rd('hub/hub.js') + '<\/script>');

/* The published preview keeps the title it was first published under, so the
   artifact stays recognisable in the gallery; the app itself is just "Playbox". */
hub = hub.replace('<title>Playbox</title>', '<title>Playbox Arcade</title>');

/* Artifact publishing wraps the file in its own skeleton, so strip ours. */
hub = hub.replace(/^[\s\S]*?<head>/, '')
         .replace(/<\/head>\s*<body[^>]*>/, '')
         .replace(/<\/body>\s*<\/html>\s*$/, '')
         .replace(/<meta charset="utf-8">\s*/, '')
         .replace(/<meta name="viewport"[^>]*>\s*/, '')
         .trim();

/* `about:blank` is the iframe's parked document, not a resource to inline. */
const left = [...hub.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map(m => m[1]).filter(u => !u.startsWith('data:') && u !== 'about:blank');
if (left.length) throw new Error('hub: un-inlined reference(s): ' + left.join(', '));

/* Stamp what this was built from, so a stale preview is detectable in a fresh
   clone where every mtime is the checkout time. */
hub = `<!-- ${MARKER}: ${fingerprint(ROOT)} -->\n` + hub;

fs.mkdirSync(path.join(ROOT, 'demo'), { recursive: true });
const out = path.join(ROOT, 'demo', 'playbox.html');
fs.writeFileSync(out, hub);
console.log(`wrote demo/playbox.html — ${SLUGS.length} games, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
