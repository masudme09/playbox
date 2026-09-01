/* ============================================================
   Builds the little public site GitHub Pages serves:
     /                    a landing page with both links
     /privacy.html        the privacy policy — the stable URL to
                          paste into Play Console and AdMob
     /play/               the whole app, playable in a browser
   node tools/build-pages.mjs   ->  site/
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'site');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.config.json'), 'utf8'));
const P = cfg.publisher || {};

const need = [
  ['legal/playbox-privacy.html', 'run node tools/make-privacy.mjs'],
  ['demo/playbox.html', 'run node tools/make-demo.mjs']
];
for (const [f, how] of need) {
  if (!fs.existsSync(path.join(ROOT, f))) { console.error(`missing ${f} — ${how}`); process.exit(1); }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'play'), { recursive: true });

/* the policy, under a stable name and under the name make-privacy.mjs uses */
const policy = fs.readFileSync(path.join(ROOT, 'legal/playbox-privacy.html'));
fs.writeFileSync(path.join(OUT, 'privacy.html'), policy);
fs.writeFileSync(path.join(OUT, 'playbox-privacy.html'), policy);

/* the playable build */
fs.copyFileSync(path.join(ROOT, 'demo/playbox.html'), path.join(OUT, 'play/index.html'));

/* Pages would otherwise run the output through Jekyll and drop anything
   starting with an underscore */
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const games = [...fs.readFileSync(path.join(ROOT, 'shared/registry.js'), 'utf8')
  .matchAll(/name: '([^']+)', tagline: '([^']+)'/g)].map(m => ({ name: m[1], tag: m[2] }));

fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cfg.storeName || cfg.appName}</title>
<meta name="description" content="Five original games in one Android app, with a daily challenge across all of them.">
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#06080f;color:#e6ecf9;
       font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       -webkit-font-smoothing:antialiased;
       background-image:radial-gradient(70% 40% at 50% -6%,rgba(78,225,193,.10),transparent 60%)}
  .wrap{max-width:44rem;margin:0 auto;padding:5rem 1.25rem 6rem}
  h1{font-size:clamp(30px,7vw,46px);font-weight:800;letter-spacing:-.01em;text-wrap:balance}
  .sub{color:#8595b4;margin-top:.6rem;font-size:17px;max-width:34rem}
  .row{display:flex;flex-wrap:wrap;gap:.75rem;margin:2.2rem 0 3rem}
  a.btn{display:inline-block;text-decoration:none;font-weight:600;font-size:15px;
        padding:.8rem 1.4rem;border-radius:12px;background:#4ee1c1;color:#04121a}
  a.btn.ghost{background:transparent;color:#e6ecf9;border:1px solid rgba(146,169,214,.28)}
  h2{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#5c6a86;
     margin:2.5rem 0 1rem;font-weight:600}
  ul{list-style:none;display:grid;gap:.6rem}
  li{border-left:2px solid rgba(78,225,193,.5);padding-left:.9rem}
  li b{font-weight:600}
  li span{color:#8595b4}
  footer{margin-top:3.5rem;border-top:1px solid rgba(146,169,214,.16);padding-top:1.4rem;
         color:#5c6a86;font-size:13.5px}
  footer a{color:#8595b4}
</style>
</head>
<body>
<div class="wrap">
  <h1>${cfg.storeName || cfg.appName}</h1>
  <p class="sub">Five original games in one Android app, with a daily challenge that runs
     across all of them. Plays fully offline.</p>

  <div class="row">
    <a class="btn" href="play/">Play in your browser</a>
    <a class="btn ghost" href="privacy.html">Privacy policy</a>
  </div>

  <h2>What's inside</h2>
  <ul>
${games.map(g => `    <li><b>${g.name}</b> <span>— ${g.tag}</span></li>`).join('\n')}
  </ul>

  <footer>
    Published by ${P.developerName || 'the developer'}.
    Questions: <a href="mailto:${P.supportEmail || ''}">${P.supportEmail || ''}</a><br>
    The browser build is the same code that ships in the app; only the ads are simulated.
  </footer>
</div>
</body>
</html>
`);

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(OUT, p));
  }
})(OUT);
console.log(`site/ built — ${files.length} files`);
for (const f of files) console.log('  ' + f);
console.log('\nprivacy policy URL will be:  <your pages url>/privacy.html');
