/* ============================================================
   Play Store screenshots, captured from the real bundle.
   Serves build/www over http (so the game iframes are same-origin
   exactly as they are under Capacitor) and drives the actual hub.
   Output: 8 x 1080x1920 — the max ratio Play allows — rendered at
   a realistic 405x720 CSS viewport so the UI is phone-sized.

   Run ./tools/build-android.sh first.
   node tools/screenshots.mjs
   ============================================================ */
import { launch } from './browser.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const WWW  = path.join(ROOT, 'build', 'www');
const OUT  = path.join(ROOT, 'store-assets', 'playbox', 'screenshots');
const VW = 405, VH = 720, DSF = 1080 / VW;
const PORT = 8123;

if (!fs.existsSync(WWW)) {
  console.error('build/www not found — run ./tools/build-android.sh first');
  process.exit(1);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  let f = path.join(WWW, decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => {
    if (e) { r.statusCode = 404; r.end('not found'); return; }
    r.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
    r.end(d);
  });
});
await new Promise(r => srv.listen(PORT, r));

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
/* JPEG, because Play requires screenshots to carry no alpha channel and a
   canvas screenshot is always RGBA. Quality 95 on these flat dark UIs is
   visually lossless. */
const shot = (n, label) => page.screenshot({
  path: path.join(OUT, `${String(n).padStart(2, '0')}-${label}.jpg`),
  type: 'jpeg', quality: 95
});

async function boot(seed) {
  await page.goto(`http://localhost:${PORT}/`);
  await sleep(300);
  if (seed) { await page.evaluate(seed); await page.reload(); }
  await sleep(800);
}
/* the game's own document, for driving it from outside */
function frame() { return page.frames().find(f => f !== page.mainFrame()); }
async function openGame(slug) {
  await page.click(`[data-slug="${slug}"]`, { force: true });
  await sleep(1400);
}
async function closeGame() {
  await page.evaluate(() => window.PB_HOST.exit());
  await sleep(600);
}
async function tapIn(re) {
  const fr = frame(); if (!fr) return null;
  for (const el of await fr.$$('button, .btn')) {
    if (!(await el.isVisible())) continue;
    const t = ((await el.textContent()) || '').trim();
    if (re.test(t)) { await el.click({ force: true }); return t; }
  }
  return null;
}
/* pointer coordinates are page-relative; the frame starts below the slim bar */
const BAR = 44;
const tap = (x, y) => page.mouse.click(x, BAR + y);
async function dragIn(x1, y1, x2, y2, steps = 16) {
  await page.mouse.move(x1, BAR + y1); await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + (x2 - x1) * i / steps, BAR + y1 + (y2 - y1) * i / steps);
    await sleep(18);
  }
  await page.mouse.up();
}

/* ---------- 1. the hub, with the daily challenge front and centre ---------- */
await boot();
await shot(1, 'hub');

/* ---------- 2. Echo ---------- */
await openGame('echo');
await tapIn(/^play|continue/i); await sleep(700);
for (let i = 0; i < 2; i++) { await tap(VW / 2, (VH - BAR) * 0.5); await sleep(550); }
await dragIn(VW / 2, (VH - BAR) * 0.5, VW / 2 + 60, (VH - BAR) * 0.34);
await tap(VW * 0.62, (VH - BAR) * 0.4); await sleep(700);
await shot(2, 'echo');
await closeGame();

/* ---------- 3. Vortex ---------- */
await openGame('vortex');
await tapIn(/^play/i); await sleep(900);
await page.evaluate(() => {
  const w = document.getElementById('gf').contentWindow;
  const V = w.__vortex, S = V.state;
  w.__ap = w.setInterval(() => {
    if (S.mode !== 'play') return;
    S.invuln = 0.09; S.tutorial = 0; S.tutFade = 0;
    let best = null;
    for (const r of V.rings) {
      if (!r.on || r.done || r.r <= V.geom().rShip) continue;
      if (!best || r.r < best.r) best = r;
    }
    if (!best) return;
    let bi = 0, bs = -1;
    for (let i = 0; i < best.n; i++) if (best.sz[i] > bs) { bs = best.sz[i]; bi = i; }
    S.shipA = best.gs[bi] + best.sz[bi] / 2; S.shipV = 0;
  }, 16);
});
await sleep(26000);
await shot(3, 'vortex');
await page.evaluate(() => { const w = document.getElementById('gf').contentWindow; w.clearInterval(w.__ap); });
await closeGame();

/* ---------- 4. Prism ---------- */
await boot(() => { try { localStorage.setItem('prism:unlocked', '40'); } catch (e) {} });
await openGame('prism');
await tapIn(/^levels/i); await sleep(600);
{
  const fr = frame();
  const cells = await fr.$$('.screen.on button');
  if (cells[20]) { await cells[20].click({ force: true }); await sleep(900); }
}
await tap(VW * 0.5, (VH - BAR) * 0.5); await sleep(600);
await shot(4, 'prism');
await closeGame();

/* ---------- 5. Starfall ---------- */
await boot();
await openGame('starfall');
await tapIn(/^play/i); await sleep(700);
/* one firm pull, then catch it mid-climb with planets still in frame */
await page.mouse.move(VW / 2, BAR + (VH - BAR) * 0.62); await page.mouse.down();
for (let i = 1; i <= 20; i++) { await page.mouse.move(VW / 2 - i * 1.5, BAR + (VH - BAR) * 0.62 + i * 6); await sleep(16); }
await page.mouse.up();
await sleep(1800);
await shot(5, 'starfall');
await closeGame();

/* ---------- 6. Daily Lock ---------- */
await openGame('dailylock');
await tapIn(/today|^play/i); await sleep(800);
for (let i = 0; i < 5; i++) {
  const fr = frame(); const b = fr && await fr.$('#cNext');
  if (b && await b.isVisible()) { await b.click({ force: true }); await sleep(240); } else break;
}
async function guess(idxs) {
  const fr = frame(); if (!fr) return;
  const k = await fr.$$('#keys button');
  for (const i of idxs) if (k[i]) { await k[i].click({ force: true }); await sleep(130); }
  await tapIn(/submit/i); await sleep(800);
}
await guess([0, 1, 2, 3, 4]);
await guess([1, 2, 3, 4, 5]);
await guess([0, 2, 4, 5, 6]);
/* let any rule-rejection toast fade before the shutter — a toast over the
   lock body makes a poor store screenshot */
await sleep(2600);
await shot(6, 'dailylock');
await closeGame();

/* ---------- 7. the token shop ---------- */
await page.click('#navShop', { force: true }).catch(async () => {
  for (const el of await page.$$('button')) {
    const l = (await el.getAttribute('aria-label')) || '';
    if (/shop/i.test(l)) { await el.click({ force: true }); break; }
  }
});
await sleep(600);
await shot(7, 'shop');

/* ---------- 8. the challenge, finished ---------- */
await boot(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('playbox:profile') || '{}');
    raw.firstRunPaid = true; raw.tokens = 34;
    raw.streak = 4; raw.maxStreak = 6;
    localStorage.setItem('playbox:profile', JSON.stringify(raw));
  } catch (e) {}
});
await page.evaluate(() => {
  const P = window.Profile, d = P.refresh();
  d.goals.forEach(g => { g.done = true; g.progress = 99; });
  d.bonusPaid = true;
  P.state.lastCompleteDay = d.day;
  P.save();
});
await page.reload(); await sleep(900);
await shot(8, 'challenge-complete');

await browser.close();
srv.close();

console.log(`8 screenshots -> ${path.relative(ROOT, OUT)}`);
console.log('console:', errs.length ? errs.slice(0, 6).join(' | ') : 'clean');
process.exit(errs.length ? 1 : 0);
