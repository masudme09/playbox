/* ============================================================
   Scaffold a new game that already satisfies shared/CONTRACT.md.
     node tools/new-game.mjs <slug> "Display Name"
   Writes games/<slug>/{index.html,game.js} and prints the two
   snippets you paste into shared/registry.js and shared/art.js.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const slug = (process.argv[2] || '').trim();
const name = (process.argv[3] || '').trim() || slug;

if (!/^[a-z][a-z0-9]{1,15}$/.test(slug)) {
  console.error('usage: node tools/new-game.mjs <slug> "Display Name"');
  console.error('       slug: lower-case letters and digits, 2-16 chars');
  process.exit(1);
}
const dir = path.join(ROOT, 'games', slug);
if (fs.existsSync(dir)) { console.error(`games/${slug}/ already exists`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no,maximum-scale=1">
<meta name="theme-color" content="#080b14">
<title>${name}</title>
<link rel="icon" href="data:,">\n<link rel="stylesheet" href="../../shared/style.css">
<style>
  /* game-specific CSS only */
  .hud{opacity:0;transition:opacity .25s ease;pointer-events:none}
  .hud.on{opacity:1;pointer-events:auto}
</style>
</head>
<body>

  <div class="hud" id="hud">
    <div class="stat"><b id="score">0</b><span>score</span></div>
    <button class="icon-btn" id="pause" aria-label="Pause">&#10073;&#10073;</button>
  </div>

  <canvas id="cv"></canvas>

  <div class="screen on" id="menu">
    <h1>${name}</h1>
    <p id="tagline">One line that says what the player does.</p>
    <button class="btn" id="btnPlay">Play</button>
    <div class="chips"><span class="chip" id="chipBest">Best 0</span></div>
  </div>

  <div class="screen" id="over">
    <h2>Run over</h2>
    <p><b id="fScore">0</b></p>
    <button class="btn" id="btnRetry">Retry</button>
    <button class="btn reward" id="btnReward" style="display:none">Watch ad &rarr; revive</button>
    <button class="btn ghost" id="btnMenu">Menu</button>
  </div>

  <div class="toast" id="toast"></div>

<script>window.GAME_ID = '${slug}';</script>
<script src="../../shared/ad-config.js"></script>
<script src="../../shared/ads.js"></script>
<!-- Points Ads at the host app when running inside Playbox; harmless standalone. -->
<script src="../../shared/pb-child.js"></script>
<script src="../../shared/engine.js"></script>
<script src="game.js"></script>
</body>
</html>
`);

fs.writeFileSync(path.join(dir, 'game.js'), `/* ============================================================
   ${name.toUpperCase()} — one line on the core idea.
   Read shared/CONTRACT.md before changing the ad or storage calls.
   ============================================================ */
(function () {
  'use strict';

  var eng = Engine('cv');
  var elHud = document.getElementById('hud');

  var S = { mode: 'menu', score: 0, best: Store.get('best', 0), t: 0 };

  /* ---------------- lifecycle ---------------- */
  function toMenu() {
    S.mode = 'menu';
    elHud.classList.remove('on');
    document.getElementById('chipBest').textContent = 'Best ' + S.best;
    UI.show('menu');
    Ads.showBanner();               // menus and results only — never during play
  }

  function start() {
    S.mode = 'play'; S.score = 0; S.t = 0;
    Ads.hideBanner();
    UI.hide();
    elHud.classList.add('on');
    eng.start();
  }

  async function gameOver() {
    S.mode = 'over';
    elHud.classList.remove('on');
    if (Store.bump('best', S.score)) S.best = S.score;
    document.getElementById('fScore').textContent = S.score;

    /* Tell the hub what happened. Registry goals read these fields. */
    PB.report('run', { score: S.score });

    var btn = document.getElementById('btnReward');
    btn.style.display = (PB.peekBoost('${slug}_revive') > 0 || Ads.isRewardedReady()) ? '' : 'none';

    await Ads.maybeInterstitial();   // self-paced; resolves once the ad is gone
    if (S.mode !== 'over') return;
    UI.show('over');
    Ads.showBanner();
  }

  /* ---------------- loop ---------------- */
  eng.onUpdate = function (dt) {
    if (S.mode !== 'play') return;
    S.t += dt;
    // ... game logic
    document.getElementById('score').textContent = S.score;
  };

  eng.onRender = function (ctx, w, h, t) {
    ctx.clearRect(0, 0, w, h);
    // ... draw
    ctx.fillStyle = '#4ee1c1';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 + Math.sin(t * 2) * 40, 22, 0, Math.PI * 2);
    ctx.fill();
  };

  Input(eng.canvas, {
    down: function (x, y) { if (S.mode === 'play') { S.score++; Sound.tap(); } },
    move: function () {},
    up: function () {}
  });

  /* ---------------- wiring ---------------- */
  document.getElementById('btnPlay').addEventListener('click', function () {
    Sound.tap(); Ads.init(); start();
  });
  document.getElementById('btnRetry').addEventListener('click', function () { Sound.tap(); start(); });
  document.getElementById('btnMenu').addEventListener('click', function () { Sound.tap(); toMenu(); });
  document.getElementById('btnReward').addEventListener('click', async function () {
    this.setAttribute('disabled', '');
    var ok = PB.takeBoost('${slug}_revive', 1) > 0;
    try { if (!ok) ok = await Ads.showRewarded(); }
    finally { this.removeAttribute('disabled'); }
    if (ok) { UI.toast('Revived'); start(); } else UI.toast('No ad available right now');
  });
  document.getElementById('pause').addEventListener('click', function () { eng.stop(); toMenu(); });

  window.Game = { onBackground: function () { eng.stop(); } };
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S.mode === 'play') eng.start();
  });

  toMenu();
  Ads.showBanner();
})();
`);

console.log(`\ncreated games/${slug}/index.html and games/${slug}/game.js`);
console.log(`\n--- 1. paste into the GAMES array in shared/registry.js -------------\n`);
console.log(`    {
      slug: '${slug}', name: '${name}', tagline: 'One line',
      kind: 'Arcade', detail: 'Endless', accent: '#4ee1c1',
      since: 'NEXT_VERSION',
      blurb: 'One sentence for the what\\u2019s-new sheet.',
      goals: [
        { id: '${slug}-a', text: 'Score 10 in ${name}',
          need: 1, count: function (ev) { return ev.type === 'run' && ev.score >= 10; } },
        { id: '${slug}-b', text: 'Finish 3 ${name} runs',
          need: 3, count: function (ev) { return ev.type === 'run'; } }
      ],
      shop: [
        { key: '${slug}_revive', label: 'One free revive', note: 'Skip the ad on your next run', cost: 6, grant: 1 }
      ]
    },`);
console.log(`\n--- 2. paste into EMBLEM in shared/art.js (for the shelf tile) ------\n`);
console.log(`  ${slug}: function (ctx) {
    // draws inside (-0.5..0.5, -0.5..0.5)
    ctx.fillStyle = '#4ee1c1';
    ctx.beginPath(); ctx.arc(0, 0, 0.30, 0, Math.PI * 2); ctx.fill();
  },`);
console.log(`\n--- 3. also do -------------------------------------------------------

  * add a GAMES entry in shared/art.js (name / sub / bg / key) for '${slug}'
  * add the release to CHANGELOG in shared/registry.js, and set 'since'
  * add a case to Profile.gameStat in shared/profile.js
  * bump versionCode AND versionName in app.config.json
  * node tools/render-assets.mjs && node tools/screenshots.mjs
  * node tools/verify.mjs && ./tools/build-android.sh
`);
