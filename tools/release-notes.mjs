/* ============================================================
   Turns the CHANGELOG in shared/registry.js into Play release
   notes, so the notes players see in the store and the notes
   they see in the app's what's-new sheet can never disagree.

     node tools/release-notes.mjs              # print them
     node tools/release-notes.mjs --write      # also write the
         distribution/whatsnew/ directory the upload action reads

   Play allows 500 characters per locale. Over that, the store
   silently truncates, so this fails loudly instead.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const LIMIT = 500;
const LOCALES = ['en-US', 'en-GB'];

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.config.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'shared/registry.js'), 'utf8');

/* pull the CHANGELOG array out of the registry without executing it */
const block = src.slice(src.indexOf('var CHANGELOG = ['), src.indexOf('\n  var R = {'));
const entries = [];
for (const m of block.matchAll(/\{\s*version: '([\d.]+)',\s*date: '([\d-]+)',\s*notes: \[([\s\S]*?)\]\s*\}/g)) {
  const notes = [...m[3].matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map(n => n[1].replace(/\\'/g, "'").replace(/\\u2019/g, '’').replace(/\\\\/g, '\\'));
  entries.push({ version: m[1], date: m[2], notes });
}

if (!entries.length) {
  console.error('no CHANGELOG entries found in shared/registry.js');
  process.exit(1);
}

const want = process.argv.find(a => /^\d+\.\d+\.\d+$/.test(a)) || cfg.versionName;
const entry = entries.find(e => e.version === want);
if (!entry) {
  console.error(`no CHANGELOG entry for version ${want}.`);
  console.error(`registry has: ${entries.map(e => e.version).join(', ')}`);
  console.error('Add one to CHANGELOG in shared/registry.js before releasing.');
  process.exit(1);
}

const text = entry.notes.map(n => '• ' + n).join('\n');

if (text.length > LIMIT) {
  console.error(`release notes for ${want} are ${text.length} characters; Play allows ${LIMIT}.`);
  console.error('Shorten the notes for this version in shared/registry.js.');
  process.exit(1);
}

console.log(`--- ${want} (${entry.date}) — ${text.length}/${LIMIT} chars ---`);
console.log(text);

if (process.argv.includes('--write')) {
  const dir = path.join(ROOT, 'distribution', 'whatsnew');
  fs.mkdirSync(dir, { recursive: true });
  for (const loc of LOCALES) fs.writeFileSync(path.join(dir, `whatsnew-${loc}`), text + '\n');
  console.log(`\nwrote ${LOCALES.map(l => `distribution/whatsnew/whatsnew-${l}`).join(', ')}`);
}
