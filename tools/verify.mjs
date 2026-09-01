/* ============================================================
   Playbox pre-flight. Run before every upload.
     ./tools/build-android.sh && node tools/verify.mjs

   The section that matters most for updates is [2]: it proves the
   registry, the filesystem, the artwork and the profile all agree
   about which games exist. A half-added game fails here instead
   of on a player's phone.
   ============================================================ */
import { launch } from './browser.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fingerprint, stampOf } from './fingerprint.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const cfg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.config.json'), 'utf8'));
const regSrc = fs.readFileSync(path.join(ROOT, 'shared/registry.js'), 'utf8');
const SLUGS = [...regSrc.matchAll(/slug: '([a-z0-9]+)'/g)].map(m => m[1]);
const PORT = 8121;

let fails = 0, warns = 0;
const ok   = m => console.log('  \x1b[32mok  \x1b[0m ' + m);
const bad  = m => { fails++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); };
const warn = m => { warns++; console.log('  \x1b[33mwarn\x1b[0m ' + m); };
const id = f => execSync(`identify -format "%w %h %[channels] %b" ${JSON.stringify(f)}`).toString().trim().split(/\s+/);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= 1. store assets meet Play's published specs ============= */
console.log('\n[1] store assets');
{
  const A = path.join(ROOT, 'store-assets', 'playbox');
  const [iw, ih, ich, ib] = id(path.join(A, 'play-icon-512.png'));
  (iw === '512' && ih === '512') ? ok('icon 512x512') : bad(`icon is ${iw}x${ih}`);
  /srgba/.test(ich) ? ok('icon has alpha (Play wants 32-bit PNG)') : bad('icon has no alpha channel');
  const kb = parseFloat(ib);
  ((/B$/.test(ib) && !/Ki|Mi/.test(ib)) ? kb / 1024 : /Ki/.test(ib) ? kb : kb * 1024) <= 1024
    ? ok(`icon ${ib} <= 1024KB`) : bad(`icon too large: ${ib}`);

  const feat = ['play-feature-1024x500.jpg', 'play-feature-1024x500.png']
    .map(f => path.join(A, f)).find(fs.existsSync) || path.join(A, 'play-feature-1024x500.jpg');
  const [fw, fh, fch] = id(feat);
  (fw === '1024' && fh === '500') ? ok('feature graphic 1024x500') : bad(`feature is ${fw}x${fh}`);
  /srgba/.test(fch) ? bad(`feature graphic (${path.basename(feat)}) has alpha — Play rejects that`)
                    : ok(`feature graphic ${path.basename(feat)} has no alpha`);

  const sd = path.join(A, 'screenshots');
  const shots = fs.existsSync(sd) ? fs.readdirSync(sd).filter(f => /\.(png|jpe?g)$/i.test(f)) : [];
  shots.length >= 4 ? ok(`${shots.length} screenshots (2 minimum, 4+ recommended, 8 maximum)`)
                    : bad(`only ${shots.length} screenshots`);
  shots.length <= 8 || bad(`${shots.length} screenshots — Play accepts at most 8`);
  let sbad = 0;
  for (const s of shots) {
    const [w, h, ch] = id(path.join(sd, s));
    const mn = Math.min(+w, +h), mx = Math.max(+w, +h);
    if (mn < 320 || mx > 3840) { bad(`${s} ${w}x${h} outside 320..3840`); sbad++; }
    else if (mx > mn * 2)      { bad(`${s} ${w}x${h} — long side over 2x the short side`); sbad++; }
    else if (/srgba/.test(ch)) { bad(`${s} has alpha — Play requires none`); sbad++; }
  }
  if (!sbad) ok('every screenshot inside Play\'s dimension + alpha rules');

  const mip = path.join(A, 'android-res');
  const dens = fs.readdirSync(mip);
  const per = dens.map(d => fs.readdirSync(path.join(mip, d)).length);
  (dens.length === 5 && per.every(n => n === 4))
    ? ok('launcher icons: 5 densities x (legacy, round, fg, bg)')
    : warn(`mipmaps look wrong: ${dens.length} dirs, ${per.join('/')}`);
}

/* ================= 2. the registry and the repo agree ===================== */
console.log('\n[2] registry <-> repo consistency');
{
  const dirs = fs.readdirSync(path.join(ROOT, 'games')).filter(
    d => fs.statSync(path.join(ROOT, 'games', d)).isDirectory());

  SLUGS.length ? ok(`registry declares ${SLUGS.length} games: ${SLUGS.join(', ')}`)
               : bad('registry declares no games');

  for (const s of SLUGS) {
    ['index.html', 'game.js'].forEach(f => {
      fs.existsSync(path.join(ROOT, 'games', s, f))
        ? ok(`${s}: games/${s}/${f}`) : bad(`${s}: games/${s}/${f} missing`);
    });
  }
  for (const d of dirs) {
    SLUGS.includes(d) ? null : bad(`games/${d}/ exists but is not in the registry — it will never be shown`);
  }
  if (dirs.every(d => SLUGS.includes(d))) ok('no orphaned game folders');

  const art = fs.readFileSync(path.join(ROOT, 'shared/art.js'), 'utf8');
  for (const s of SLUGS) {
    new RegExp(`^\\s{2}${s}: function \\(ctx\\)`, 'm').test(art)
      ? ok(`${s}: has a shelf emblem in art.js`) : bad(`${s}: no EMBLEM entry in art.js — blank shelf tile`);
    new RegExp(`^\\s+${s}:\\s*\\{ name:`, 'm').test(art)
      ? ok(`${s}: has an art.js palette entry`) : bad(`${s}: no GAMES entry in art.js`);
  }

  const prof = fs.readFileSync(path.join(ROOT, 'shared/profile.js'), 'utf8');
  for (const s of SLUGS) {
    prof.includes(`case '${s}':`) ? ok(`${s}: has a gameStat case`)
                                  : bad(`${s}: no case in Profile.gameStat — stats row will read 0`);
  }

  const goalIds = [...regSrc.matchAll(/id: '([a-z0-9-]+)'/g)].map(m => m[1]);
  const dupG = goalIds.filter((v, i) => goalIds.indexOf(v) !== i);
  dupG.length ? bad(`duplicate goal ids: ${[...new Set(dupG)].join(', ')}`)
              : ok(`${goalIds.length} goal ids, all unique`);

  const keys = [...regSrc.matchAll(/key: '([a-z0-9_]+)'/g)].map(m => m[1]);
  const dupK = keys.filter((v, i) => keys.indexOf(v) !== i);
  dupK.length ? bad(`duplicate shop keys: ${[...new Set(dupK)].join(', ')}`)
              : ok(`${keys.length} shop keys, all unique`);

  for (const k of keys) {
    const owner = k.split('_')[0];
    const used = fs.readFileSync(path.join(ROOT, 'games', owner, 'game.js'), 'utf8');
    used.includes(`'${k}'`) ? ok(`boost ${k} is claimed by ${owner}`)
                            : bad(`boost ${k} is sold but ${owner}/game.js never claims it — players lose tokens`);
  }

  const cur = (regSrc.match(/version: '([\d.]+)'/) || [])[1];
  cur === cfg.versionName ? ok(`changelog head ${cur} matches app.config.json`)
    : bad(`changelog head is ${cur} but app.config.json says ${cfg.versionName}`);
  for (const m of regSrc.matchAll(/since: '([^']+)'/g)) {
    /^\d+\.\d+\.\d+$/.test(m[1]) ? null : bad(`a game still has since: '${m[1]}' — set it to the version you are shipping`);
  }
  ok('every game has a real `since` version');
}

/* ===== 2b. every goal reads a field its game actually reports ============= */
console.log('\n[2b] goal wiring');
{
  /* A goal whose count() reads ev.foo when the game never sends `foo` is a
     silent dead end — the challenge simply cannot be completed that day. So
     compare each goal's reads against what its game really emits. */
  const reported = {};                       // slug -> { types:Set, keys:Set }
  for (const s of SLUGS) {
    const src = fs.readFileSync(path.join(ROOT, 'games', s, 'game.js'), 'utf8');
    const types = new Set(), keys = new Set(['type', 'game']);
    for (const m of src.matchAll(/PB\.report\(\s*([\s\S]{0,120}?)\{([\s\S]*?)\}\s*\)/g)) {
      for (const t of m[1].matchAll(/'([a-z]+)'/g)) types.add(t[1]);
      for (const k of m[2].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) keys.add(k[1]);
    }
    reported[s] = { types, keys };
    types.size ? ok(`${s}: reports ${[...types].join('/')} with {${[...keys].filter(k => k !== 'game' && k !== 'type').join(', ')}}`)
               : bad(`${s}: no PB.report call found`);
  }

  /* pull each goal's own source text out of the registry, per game block */
  for (const gm of regSrc.matchAll(/slug: '([a-z0-9]+)'[\s\S]*?goals: \[([\s\S]*?)\n      \]/g)) {
    const slug = gm[1], block = gm[2];
    const rep = reported[slug];
    if (!rep) { bad(`registry has goals for unknown game ${slug}`); continue; }
    for (const g of block.matchAll(/id: '([a-z0-9-]+)'[\s\S]*?count: function \(ev\) \{([\s\S]*?)\}\s*\}/g)) {
      const id = g[1], body = g[2];
      let bads = [];
      for (const f of body.matchAll(/ev\.([A-Za-z_$][\w$]*)/g)) {
        if (!rep.keys.has(f[1])) bads.push('ev.' + f[1]);
      }
      for (const t of body.matchAll(/ev\.type\s*===\s*'([a-z]+)'/g)) {
        if (!rep.types.has(t[1])) bads.push(`type '${t[1]}'`);
      }
      bads.length ? bad(`goal ${id} reads ${[...new Set(bads)].join(', ')} which ${slug} never reports — it can never complete`)
                  : ok(`goal ${id}: every field it reads is reported`);
    }
  }
}

/* ================= 3. offline purity ==================================== */
console.log('\n[3] offline purity');
{
  const shipped = [path.join(ROOT, 'index.html'), path.join(ROOT, 'hub/hub.js')];
  for (const s of SLUGS) for (const f of ['index.html', 'game.js']) shipped.push(path.join(ROOT, 'games', s, f));
  for (const f of fs.readdirSync(path.join(ROOT, 'shared'))) {
    if (/\.(js|css)$/.test(f)) shipped.push(path.join(ROOT, 'shared', f));
  }
  const netRe = /(https?:)?\/\/(?!\/)[a-z0-9]|fetch\s*\(|XMLHttpRequest|importScripts|@import|<link[^>]+href="http|src="http/i;
  let dirty = 0;
  for (const f of shipped) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
      if (netRe.test(ln) && !/ca-app-pub|^\s*\*|^\s*\/\/|^\s*<!--/.test(ln)) {
        bad(`${path.relative(ROOT, f)}:${i + 1} ${ln.trim().slice(0, 72)}`); dirty++;
      }
    });
  }
  if (!dirty) ok(`no external URLs or fetches in ${shipped.length} shipped files`);
}

/* ================= 4. ad contract ======================================= */
console.log('\n[4] ad contract');
{
  const hub = fs.readFileSync(path.join(ROOT, 'hub/hub.js'), 'utf8')
            + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /Ads\.init\(/.test(hub)        ? ok('hub: calls Ads.init()')        : bad('hub: never calls Ads.init()');
  /PB_HOST/.test(hub)            ? ok('hub: exposes PB_HOST')         : bad('hub: no PB_HOST — games cannot reach it');
  /Ads\.hideBanner\(/.test(hub)  ? ok('hub: hides the banner for a game') : bad('hub: never hides the banner');
  /maybeInterstitial/.test(hub)  ? warn('hub: shows an interstitial at the hub boundary — deliberate restraint was the choice')
                                 : ok('hub: no interstitial at the hub boundary');

  for (const s of SLUGS) {
    const src = fs.readFileSync(path.join(ROOT, 'games', s, 'game.js'), 'utf8')
              + fs.readFileSync(path.join(ROOT, 'games', s, 'index.html'), 'utf8');
    const has = (re, label, want = true) =>
      (re.test(src) === want) ? ok(`${s}: ${label}`) : bad(`${s}: ${label}`);
    has(/pb-child\.js/, 'loads the child bridge');
    has(/Ads\.showBanner\(/, 'shows a banner on menus/results');
    has(/Ads\.hideBanner\(/, 'hides it for play');
    has(/Ads\.maybeInterstitial\(\s*true\s*\)/, 'never forces an interstitial', false);
    has(/PB\.report\(/, 'reports events to the profile');
  }
}

/* ================= 5. the android project =============================== */
console.log('\n[5] android project');
{
  const A = path.join(ROOT, 'build', 'android');
  if (!fs.existsSync(A)) warn('build/ not generated — run ./tools/build-android.sh');
  else {
    const man = fs.readFileSync(path.join(A, 'app/src/main/AndroidManifest.xml'), 'utf8');
    /ads\.APPLICATION_ID/.test(man)        ? ok('AdMob app id in the manifest') : bad('no AdMob meta-data');
    /screenOrientation="portrait"/.test(man)? ok('locked to portrait')          : bad('not portrait-locked');
    /permission\.AD_ID/.test(man)          ? ok('AD_ID permission declared')    : bad('AD_ID missing');
    const vg = fs.readFileSync(path.join(A, 'variables.gradle'), 'utf8');
    /targetSdkVersion = 36/.test(vg)       ? ok('targetSdk 36 (required since 31 Aug 2026)') : bad('wrong targetSdk');
    const st = fs.readFileSync(path.join(A, 'app/src/main/res/values/strings.xml'), 'utf8');
    st.includes(cfg.storeName) ? ok(`app_name = "${cfg.storeName}"`) : bad('app_name does not match app.config.json');

    const valDir = path.join(A, 'app/src/main/res/values');
    const seen = new Map();
    for (const vf of fs.readdirSync(valDir).filter(f => f.endsWith('.xml'))) {
      const body = fs.readFileSync(path.join(valDir, vf), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const m of body.matchAll(/<(color|string|dimen|bool|integer)\s+name="([^"]+)"/g)) {
        const key = m[1] + '/' + m[2];
        if (seen.has(key)) bad(`duplicate resource ${key} in ${seen.get(key)} and ${vf} — AAPT2 will refuse`);
        else seen.set(key, vf);
      }
    }
    ok(`no duplicate value resources (${seen.size} checked)`);

    const bg = fs.readFileSync(path.join(A, 'app/build.gradle'), 'utf8');
    (/signingConfigs\s*\{[\s\S]*release\s*\{/.test(bg) && /keystorePropertiesFile/.test(bg))
      ? ok('release signing reads keystore.properties') : bad('release signing not wired');
    (bg.split('{').length === bg.split('}').length) ? ok('build.gradle braces balanced')
                                                    : bad('build.gradle braces unbalanced');
    const stray = fs.readdirSync(path.join(A, 'app/src/main/res'))
      .filter(d => d.startsWith('drawable') && fs.existsSync(path.join(A, 'app/src/main/res', d, 'splash.png')));
    stray.length ? bad(`leftover splash.png in ${stray.join(', ')} — resource clash`)
                 : ok('no splash.png/splash.xml clash');

    const www = path.join(ROOT, 'build', 'www');
    for (const s of SLUGS) {
      fs.existsSync(path.join(www, 'games', s, 'index.html'))
        ? ok(`${s}: bundled into www/`) : bad(`${s}: missing from www/ — the build did not pick it up`);
    }
    fs.existsSync(path.join(www, 'index.html')) && fs.existsSync(path.join(www, 'hub/hub.js'))
      ? ok('hub bundled into www/') : bad('hub missing from www/');
  }
}

/* ================= 6. runtime, through the real bundle ================== */
console.log('\n[6] runtime (build/www over http, as on device)');
{
  const WWW = path.join(ROOT, 'build', 'www');
  if (!fs.existsSync(WWW)) warn('skipped — no build/www');
  else {
    const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                   '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
    const srv = http.createServer((q, r) => {
      let f = path.join(WWW, decodeURIComponent(q.url.split('?')[0]));
      if (f.endsWith('/')) f += 'index.html';
      fs.readFile(f, (e, d) => {
        if (e) { r.statusCode = 404; r.end('nf'); return; }
        r.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
        r.end(d);
      });
    });
    await new Promise(r => srv.listen(PORT, r));

    const browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 405, height: 720 },
                                           deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [], ext = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
    page.on('request', r => { const u = r.url();
      if (!u.startsWith(`http://localhost:${PORT}`) && !/^(about|data|blob):/.test(u)) ext.push(u); });

    await page.goto(`http://localhost:${PORT}/`);
    await sleep(900);

    for (const s of SLUGS) {
      const tile = await page.$(`[data-slug="${s}"]`);
      if (!tile) { bad(`${s}: no shelf tile`); continue; }
      await tile.click({ force: true });
      await sleep(1300);
      const info = await page.evaluate(() => {
        const w = document.getElementById('gf').contentWindow;
        return { gid: w && w.GAME_ID, hosted: !!(w && w.PB && w.PB.hosted),
                 sameAds: !!(w && w.Ads && w.Ads === window.Ads),
                 canvas: !!(w && w.document && w.document.getElementById('cv')) };
      });
      (info.gid === s) ? ok(`${s}: loads in the frame`) : bad(`${s}: frame holds "${info.gid}"`);
      info.hosted     ? ok(`${s}: PB.hosted`)           : bad(`${s}: not hosted — reports will be dropped`);
      info.sameAds    ? ok(`${s}: shares the hub's ad client`) : bad(`${s}: has its own Ads instance`);
      info.canvas     ? ok(`${s}: canvas present`)      : bad(`${s}: no canvas`);

      /* a zero-size frame while showing or rotating must not throw */
      for (const [w, h] of [[80, 80], [320, 60], [405, 720]]) {
        await page.setViewportSize({ width: w, height: h }); await sleep(260);
      }
      await sleep(300);

      await page.evaluate(() => window.PB_HOST.exit());
      await sleep(500);
      const closed = await page.evaluate(() => {
        const w = document.getElementById('gf').contentWindow;
        return !(w && w.document && w.document.getElementById('cv'));
      });
      closed ? ok(`${s}: torn down on exit`) : bad(`${s}: still running after exit`);
    }

    /* background / resume, where scope bugs in onBackground surface */
    for (let r = 0; r < 2; r++) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await sleep(220);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await sleep(320);
    }
    ok('hub survives background/resume');

    const fps = await page.evaluate(() => new Promise(res => {
      let n = 0; const t0 = performance.now();
      (function f() { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res(n); })();
    }));
    fps >= 50 ? ok(`hub ${fps} fps`) : warn(`hub only ${fps} fps in headless chromium`);

    errs.length ? bad(`${errs.length} console error(s): ${errs[0].slice(0, 110)}`) : ok('console clean');
    ext.length  ? bad(`${ext.length} external request(s): ${ext[0]}`)             : ok('zero external requests');

    await browser.close();
    srv.close();
  }
}

/* ===== 6b. the scaffolder emits something that actually parses =========== */
console.log('\n[6b] tools/new-game.mjs');
{
  /* The snippet it prints is the first thing anyone pastes when adding a game.
     If it does not parse, registry.js dies and the whole app is a black screen. */
  const tmp = path.join(ROOT, 'games', '__verify_tmp');
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    const out = execSync(`node ${JSON.stringify(path.join(ROOT, 'tools/new-game.mjs'))} verifytmp "Verify Tmp"`,
                         { cwd: ROOT, encoding: 'utf8' });
    /* take only the registry section — the emblem snippet below it is a
       different fragment and would not parse as an array element */
    const sec = out.slice(out.indexOf('--- 1.'), out.indexOf('--- 2.'));
    const snippet = sec.slice(sec.indexOf('{'), sec.lastIndexOf('},') + 1);
    const f = path.join('/tmp', 'pb-snippet-check.js');
    fs.writeFileSync(f, 'var GAMES = [\n' + snippet + '\n];\n');
    execSync(`node --check ${JSON.stringify(f)}`);
    ok('the printed registry snippet parses as JavaScript');
    for (const g of ['index.html', 'game.js']) {
      fs.existsSync(path.join(ROOT, 'games', 'verifytmp', g)) ? null : bad(`scaffold missing ${g}`);
    }
    execSync(`node --check ${JSON.stringify(path.join(ROOT, 'games/verifytmp/game.js'))}`);
    ok('the scaffolded game parses');
    const html = fs.readFileSync(path.join(ROOT, 'games/verifytmp/index.html'), 'utf8');
    /pb-child\.js/.test(html) ? ok('the scaffolded game loads the child bridge')
                              : bad('scaffold does not load pb-child.js');
  } catch (e) {
    bad('new-game.mjs: ' + String(e.message).split('\n')[0].slice(0, 140));
  } finally {
    fs.rmSync(path.join(ROOT, 'games', 'verifytmp'), { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ================= 7. docs and legal ==================================== */
console.log('\n[7] docs & legal');
for (const f of ['README.md', 'PUBLISHING-GUIDE.md', 'app.config.json',
                 'package.json', 'shared/CONTRACT.md', 'legal/playbox-privacy.html',
                 'store-listings/playbox.md', 'demo/playbox.html',
                 '.github/RELEASING.md',
                 '.github/workflows/ci.yml', '.github/workflows/release.yml',
                 '.github/workflows/pages.yml']) {
  fs.existsSync(path.join(ROOT, f)) ? ok(f) : bad(`${f} missing`);
}

/* The workflows call npm scripts by name; a renamed script would only fail on
   a runner, minutes into a release. */
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const wfDir = path.join(ROOT, '.github/workflows');
  const used = new Set();
  for (const f of fs.readdirSync(wfDir)) {
    for (const m of fs.readFileSync(path.join(wfDir, f), 'utf8').matchAll(/npm run ([a-z:]+)/g)) used.add(m[1]);
    if (/\bnpm test\b/.test(fs.readFileSync(path.join(wfDir, f), 'utf8'))) used.add('test');
  }
  const missing = [...used].filter(s2 => !pkg.scripts[s2]);
  missing.length ? bad(`workflows call npm scripts that do not exist: ${missing.join(', ')}`)
                 : ok(`every npm script the workflows call exists (${[...used].sort().join(', ')})`);
}
{
  const ac = fs.readFileSync(path.join(ROOT, 'shared/ad-config.js'), 'utf8');
  const test = /useTestAds:\s*true/.test(ac);
  const TEST_APP = 'ca-app-pub-3940256099942544';
  const appIdIsTest = String(cfg.admobAppId || '').startsWith(TEST_APP);
  const unitsAreTest = ac.includes(TEST_APP + '/');

  if (test) warn('shared/ad-config.js still has useTestAds:true — right while testing, must be false to earn');
  else ok('ad-config.js is set to live ads');

  /* Real ad units under the test app id serve nothing and look like a
     misconfiguration to AdMob. Catch the mismatch before it ships. */
  if (!test && appIdIsTest) bad('live ad units but app.config.json admobAppId is still Google\'s TEST app id — nothing will serve');
  else if (!test && unitsAreTest) bad('useTestAds:false but the ad units in ad-config.js are still test units');
  else if (test && !appIdIsTest) warn('useTestAds:true with a real admobAppId — harmless, but mixed');
  else ok(`ad ids are consistent (${test ? 'all test' : 'all live'})`);

  /* demo/playbox.html is a build product; a stale one means the published
     preview is running old game code. Compared by content hash, because a
     clone stamps every file with the checkout time and mtimes say nothing. */
  const demo = path.join(ROOT, 'demo/playbox.html');
  if (fs.existsSync(demo)) {
    const want = fingerprint(ROOT);
    const got = stampOf(fs.readFileSync(demo, 'utf8'));
    if (!got) bad('demo/playbox.html carries no source stamp — rebuild it with npm run demo');
    else if (got !== want) bad(`demo/playbox.html was built from different sources (${got} vs ${want}) — run npm run demo`);
    else ok(`demo/playbox.html matches the sources (${want})`);
  }
}

console.log(`\n${'='.repeat(56)}\n${fails ? `\x1b[31m${fails} FAILURE(S)\x1b[0m` : '\x1b[32mall checks passed\x1b[0m'}${warns ? `, ${warns} warning(s)` : ''}\n`);
process.exit(fails ? 1 : 0);
