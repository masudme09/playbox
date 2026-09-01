/* ============================================================
   STARFALL — slingshot through a dying galaxy
   Endless vertical orbital-mechanics arcade.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- tuning ---------------- */
  var LY_PER_PX      = 0.35;     // world px -> light years
  var G              = 2400;     // gravitational constant
  var SOFT           = 600;      // softening (px^2)
  var CHUNK          = 900;      // vertical generation chunk height (px)
  var MAX_DRAG       = 140;      // px of drag for full power
  var LAUNCH_MAX     = 780;      // px/s at full power
  var MAX_SPEED      = 1500;
  var DAMP_K         = 0.85;     // interstellar medium drag (1/s)
  var REST_SPEED     = 78;       // below this the comet counts as "at rest"
  var RELAUNCH_COST  = 0.25;
  var BURN_COST      = 0.09;
  var BURN_IMPULSE   = 270;
  var MOTE_FUEL      = 0.16;
  var MOTE_SCORE     = 30;
  var ASSIST_SCORE   = 120;
  var PULSAR_LY      = 2000;
  var HOLE_LY        = 5000;
  var PRED_STEPS     = 130;      // ~2.6 s — covers a whole coast
  var PRED_DT        = 1 / 50;

  var COL_BG   = '#080b14';
  var ACCENT   = '#4ee1c1';
  var ACCENT2  = '#7c5cff';
  var GOLD     = '#ffc857';
  var DANGER   = '#ff6b6b';

  /* ---------------- engine ---------------- */
  var eng = Engine('cv');
  var ctx = eng.ctx;
  var W = 390, H = 700;

  /* ---------------- dom ---------------- */
  function $(id) { return document.getElementById(id); }
  var elHud = $('hud'), elAlt = $('alt'), elCombo = $('combo'), elComboWrap = $('combowrap');
  var elBest = $('best'), elRuns = $('runs'), elFinal = $('final'), elDetail = $('detail');
  var elRecord = $('record'), elBest2 = $('best2'), btnCont = $('cont'), btnMute = $('mute');

  /* ---------------- state ---------------- */
  var ST_MENU = 0, ST_PLAY = 1, ST_DYING = 2, ST_OVER = 3, ST_PAUSE = 4;
  var state = ST_MENU;

  var runSeed = 1, runTime = 0, camY = 0, deathFlash = 0;
  var startY = 0, maxY = 0, bonus = 0, score = 0, altLy = 0;
  var combo = 0, comboT = 0, usedContinue = false, invuln = 0;
  var launchCount = 0, dyingT = 0, firstRunHint = true, hintT = 0;
  var shake = 0, shakeT = 0;
  var lastAltShown = -1, lastComboShown = -1;

  /* comet */
  var cx = 0, cy = 0, cvx = 0, cvy = 0, fuel = 1, cr = 6.5, alive = true;

  /* aiming */
  var aiming = false, dragging = false, downX = 0, downY = 0, curX = 0, curY = 0;
  var downT = 0, aimPow = 0, aimAX = 0, aimAY = 0;

  /* ---------------- world objects ---------------- */
  var planets = [];            // {x,y,r,m,type,infl2,hue,rot,spin,wt,waveR,waveOn,waveHit,charge,id}
  var motes = [];              // {x,y,ox,oy,orbR,orbA,orbS,phase,taken}
  var genTop = -1;             // highest chunk index generated
  var corridorX = 0;
  var nextId = 1;

  /* particle pool (no per-frame allocation) */
  var PN = 120;
  var ppx = new Float32Array(PN), ppy = new Float32Array(PN);
  var pvx = new Float32Array(PN), pvy = new Float32Array(PN);
  var plf = new Float32Array(PN), pml = new Float32Array(PN);
  var psz = new Float32Array(PN), ptp = new Uint8Array(PN);
  var pHead = 0;

  /* floating popups */
  var QN = 6;
  var qx = new Float32Array(QN), qy = new Float32Array(QN), qt = new Float32Array(QN);
  var qtxt = ['', '', '', '', '', ''], qcol = ['', '', '', '', '', ''];
  var qHead = 0;

  /* prediction buffer */
  var prX = new Float32Array(PRED_STEPS), prY = new Float32Array(PRED_STEPS);
  var prN = 0, prHit = false;

  /* parallax starfield (3 layers) */
  var SL = [0.12, 0.30, 0.62];
  var starX = [null, null, null], starY = [null, null, null], starR = [null, null, null];
  var STAR_SPAN = 1;

  /* cached background gradient */
  var bgGrad = null;
  var DASH = [5, 6], NODASH = [];

  /* ---------------- helpers ---------------- */
  var _ax = 0, _ay = 0;

  function gravAt(x, y) {
    var ax = 0, ay = 0, i, p, dx, dy, d2, d, a;
    for (i = 0; i < planets.length; i++) {
      p = planets[i];
      dx = p.x - x; dy = p.y - y;
      d2 = dx * dx + dy * dy;
      if (d2 > p.infl2) continue;
      d = Math.sqrt(d2); if (d < 0.001) d = 0.001;
      a = G * p.m / (d2 + SOFT);
      ax += a * dx / d; ay += a * dy / d;
    }
    _ax = ax; _ay = ay;
  }

  function spawnP(x, y, vx, vy, life, size, type) {
    var i = pHead; pHead = (pHead + 1) % PN;
    ppx[i] = x; ppy[i] = y; pvx[i] = vx; pvy[i] = vy;
    plf[i] = life; pml[i] = life; psz[i] = size; ptp[i] = type;
  }

  function popup(x, y, txt, col) {
    var i = qHead; qHead = (qHead + 1) % QN;
    qx[i] = x; qy[i] = y; qt[i] = 1; qtxt[i] = txt; qcol[i] = col;
  }

  function addShake(a) { if (a > shake) shake = a; shakeT = 1; }

  /* ---------------- procedural field ---------------- */
  function clearField() {
    planets.length = 0; motes.length = 0; genTop = -1; corridorX = W * 0.5; nextId = 1;
  }

  function chunkClear(x, y, r, arr) {
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      var dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < (p.r + r + 104) * (p.r + r + 104)) return false;
    }
    return true;
  }

  function genChunk(idx) {
    var rng = U.seeded((runSeed * 7919 + idx * 104729 + 12345) >>> 0);
    var y0 = idx * CHUNK;
    var alt = y0 * LY_PER_PX;

    var prevCorr = corridorX;
    corridorX = U.clamp(prevCorr + (rng() * 2 - 1) * 95, 62, Math.max(70, W - 62));

    var count = 2 + Math.min(3, Math.floor(alt / 2200));
    if (alt < 700) count = 2;
    if (idx === 0) count = 1;

    var pulsarP = alt >= PULSAR_LY ? Math.min(0.42, 0.2 + (alt - PULSAR_LY) / 14000) : 0;
    var holeP   = alt >= HOLE_LY   ? Math.min(0.24, 0.1 + (alt - HOLE_LY) / 30000)  : 0;

    for (var n = 0; n < count; n++) {
      var tries = 0, placed = false, x = 0, y = 0, r = 0, type = 0;
      while (tries++ < 26 && !placed) {
        var roll = rng();
        type = roll < holeP ? 2 : (roll < holeP + pulsarP ? 1 : 0);
        r = type === 2 ? 15 + rng() * 11
                       : 24 + rng() * (22 + Math.min(18, alt / 900));
        x = 26 + rng() * Math.max(20, W - 52);
        y = y0 + 70 + rng() * (CHUNK - 140);
        if (idx === 0 && y < 320) continue;

        // keep a straight, navigable corridor through the chunk
        var clr = (type === 2 ? r * 3.4 : r) + 62;
        if (Math.abs(x - corridorX) < clr) continue;
        if (Math.abs(x - prevCorr) < clr) continue;
        if (!chunkClear(x, y, r, planets)) continue;
        placed = true;
      }
      if (!placed) continue;

      var p = {
        id: nextId++, x: x, y: y, r: r, type: type,
        m: type === 2 ? r * r * 5.2 : r * r,
        infl2: 0, hue: rng(), rot: rng() * 6.28, spin: (rng() - 0.5) * 0.4,
        wt: rng() * 3.4, waveR: 0, waveOn: false, waveHit: false, charge: 0
      };
      p.infl2 = (p.r * (type === 2 ? 18 : 9)) * (p.r * (type === 2 ? 18 : 9));
      planets.push(p);

      // stardust ring around some planets (greedy line = dangerous line)
      if (type !== 2 && rng() < 0.55) {
        var mc = 3 + Math.floor(rng() * 3);
        var orb = p.r * (1.9 + rng() * 0.7);
        var a0 = rng() * 6.28, spd = (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.35);
        for (var k = 0; k < mc; k++) {
          var ma = a0 + k * (6.283 / mc);
          motes.push({
            x: p.x + Math.cos(ma) * orb, y: p.y + Math.sin(ma) * orb,
            ox: p.x, oy: p.y, orbR: orb,
            orbA: ma, orbS: spd, phase: rng() * 6.28, taken: false
          });
        }
      }
    }

    // free-floating motes near the corridor
    var fc = 1 + Math.floor(rng() * 3);
    for (var f = 0; f < fc; f++) {
      motes.push({
        x: U.clamp(corridorX + (rng() * 2 - 1) * 70, 16, Math.max(20, W - 16)),
        y: y0 + 100 + rng() * (CHUNK - 200),
        ox: 0, oy: 0, orbR: 0, orbA: 0, orbS: 0, phase: rng() * 6.28, taken: false
      });
    }
  }

  function ensureChunks(topY) {
    var need = Math.floor(topY / CHUNK) + 1;
    if (need > genTop + 24) need = genTop + 24;
    while (genTop < need) { genTop++; genChunk(genTop); }
  }

  function cullField() {
    var lim = camY - H * 0.9, i, w = 0;
    for (i = 0; i < planets.length; i++) {
      if (planets[i].y + planets[i].r * 3 > lim) planets[w++] = planets[i];
    }
    planets.length = w;
    w = 0;
    for (i = 0; i < motes.length; i++) {
      if (!motes[i].taken && motes[i].y > lim - 60) motes[w++] = motes[i];
    }
    motes.length = w;
  }

  /* ---------------- starfield ---------------- */
  function buildStars() {
    STAR_SPAN = Math.max(1, H);
    for (var L = 0; L < 3; L++) {
      var n = L === 0 ? 70 : (L === 1 ? 46 : 26);
      var sx = new Float32Array(n), sy = new Float32Array(n), sr = new Float32Array(n);
      var rng = U.seeded(9001 + L * 733);
      for (var i = 0; i < n; i++) {
        sx[i] = rng() * W; sy[i] = rng() * STAR_SPAN;
        sr[i] = 0.5 + rng() * (0.6 + L * 0.7);
      }
      starX[L] = sx; starY[L] = sy; starR[L] = sr;
    }
  }

  function buildBg() {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0c1226');
    bgGrad.addColorStop(0.55, '#080b14');
    bgGrad.addColorStop(1, '#0a0710');
  }

  /* ---------------- run control ---------------- */
  function resetRun() {
    runSeed = (Math.floor(Math.random() * 1e9) + 1) >>> 0;
    runTime = 0; camY = -H * 0.18; startY = 0;
    cx = W * 0.5; cy = 60; cvx = 0; cvy = 0; fuel = 1; alive = true;
    startY = cy; maxY = cy; bonus = 0; score = 0; altLy = 0;
    combo = 0; comboT = 0; usedContinue = false; invuln = 0;
    assistCount = 0;
    launchCount = 0; dyingT = 0; deathFlash = 0;
    trackP = null; shake = 0; shakeT = 0;
    lastAltShown = -1; lastComboShown = -1;
    for (var i = 0; i < PN; i++) plf[i] = 0;
    for (var q = 0; q < QN; q++) qt[q] = 0;
    clearField();
    ensureChunks(camY + H * 2.2);
    hintT = 0;
    firstRunHint = !Store.get('played', false);
  }

  function startRun() {
    resetRun();
    Store.set('runs', Store.get('runs', 0) + 1);
    state = ST_PLAY;
    UI.hide();
    elHud.classList.add('on');
    Ads.hideBanner();
    eng.start();
  }

  function toMenu() {
    state = ST_MENU;
    elHud.classList.remove('on');
    elBest.textContent = Store.get('best', 0);
    elRuns.textContent = Store.get('runs', 0);
    UI.show('menu');
    Ads.showBanner();
  }

  function die(reason) {
    if (state !== ST_PLAY || invuln > 0) return;
    alive = false; state = ST_DYING; dyingT = 0; deathFlash = 1;
    combo = 0;
    Sound.bad(); Buzz(60); addShake(16);
    for (var i = 0; i < 26; i++) {
      var a = (i / 26) * 6.283, s = 90 + Math.random() * 260;
      spawnP(cx, cy, Math.cos(a) * s, Math.sin(a) * s, 0.5 + Math.random() * 0.7, 2 + Math.random() * 3.5, 2);
    }
    popup(cx, cy - 30, reason || 'DESTROYED', DANGER);
  }

  async function gameOver() {
    state = ST_OVER;
    elHud.classList.remove('on');
    score = Math.floor(altLy) + bonus;
    var rec = Store.bump('best', score);
    Store.set('played', true);
    elFinal.textContent = score;
    elDetail.textContent = 'Altitude ' + Math.floor(altLy) + ' ly  ·  Bonus ' + bonus;
    elBest2.textContent = Store.get('best', 0);
    if (rec) { elRecord.classList.add('on'); Sound.great(); }
    else elRecord.classList.remove('on');
    var freeCont = PB.peekBoost('starfall_continue') > 0;
    btnCont.textContent = freeCont ? 'Continue (1 token boost)' : 'Watch ad \u2192 continue';
    btnCont.style.display = (!usedContinue && (freeCont || Ads.isRewardedReady())) ? '' : 'none';
    /* `continued` lets "finish N runs" goals ignore a revived run, which would
       otherwise report twice for one sitting. */
    PB.report('run', { score: score, assists: assistCount, continued: usedContinue });
    await Ads.maybeInterstitial();
    if (state !== ST_OVER) return;
    UI.show('over');
    Ads.showBanner();
  }

  function continueRun() {
    usedContinue = true;
    state = ST_PLAY; alive = true; invuln = 1.4;
    fuel = 1; cvx = 0; cvy = 0;
    cy = camY + H * 0.45; cx = U.clamp(cx, 30, W - 30);
    // clear anything sitting on top of the respawn point
    var w = 0;
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      if (U.dist(p.x, p.y, cx, cy) > p.r + 110) planets[w++] = planets[i];
    }
    planets.length = w;
    ensureChunks(camY + H * 2.2);
    UI.hide(); elHud.classList.add('on');
    Ads.hideBanner();
    Sound.good();
    eng.start();
  }

  /* ---------------- physics step for prediction ---------------- */
  function predict() {
    var x = cx, y = cy, vx = aimAX, vy = aimAY, i, dt = PRED_DT, dm;
    prN = 0; prHit = false;
    for (i = 0; i < PRED_STEPS; i++) {
      gravAt(x, y);
      vx += _ax * dt; vy += _ay * dt;
      dm = Math.exp(-DAMP_K * dt);
      vx *= dm; vy *= dm;
      x += vx * dt; y += vy * dt;
      if (x < cr) { x = cr; vx = -vx * 0.6; }
      else if (x > W - cr) { x = W - cr; vx = -vx * 0.6; }
      prX[prN] = x; prY[prN] = y; prN++;
      for (var j = 0; j < planets.length; j++) {
        var p = planets[j];
        var ddx = p.x - x, ddy = p.y - y;
        var rr = p.type === 2 ? p.r * 1.2 : p.r + cr * 0.35;
        if (ddx * ddx + ddy * ddy < rr * rr) { prHit = true; return; }
      }
      if (y < camY - 40) { prHit = true; return; }
    }
  }

  /* ---------------- gravity-assist tracking ---------------- */
  var trackP = null, trackVX = 0, trackVY = 0;
  var assistCount = 0;          // gravity assists this run, for the daily challenge

  function finishAssist() {
    if (!trackP) return;
    var e = Math.sqrt(trackVX * trackVX + trackVY * trackVY);
    var s = Math.sqrt(cvx * cvx + cvy * cvy);
    if (e > 150 && s > 120) {
      var a1 = Math.atan2(trackVY, trackVX), a2 = Math.atan2(cvy, cvx);
      var d = a2 - a1;
      while (d > Math.PI) d -= 6.283185;
      while (d < -Math.PI) d += 6.283185;
      if (Math.abs(d) > 1.047) {     // > 60 degrees
        combo++; comboT = 8;
        var gain = ASSIST_SCORE * combo;
        bonus += gain;
        assistCount++;
        fuel = U.clamp(fuel + 0.05, 0, 1);
        cvx *= 1.08; cvy *= 1.08;
        popup(cx, cy - 26, combo > 1 ? 'ASSIST x' + combo + '  +' + gain : 'GRAVITY ASSIST  +' + gain, GOLD);
        addShake(combo > 1 ? 7 : 4.5);
        Buzz(14);
        if (combo > 1) Sound.great(); else Sound.good();
        for (var i = 0; i < 10; i++) {
          var aa = Math.random() * 6.283, sp = 60 + Math.random() * 150;
          spawnP(cx, cy, Math.cos(aa) * sp, Math.sin(aa) * sp, 0.4 + Math.random() * 0.4, 2 + Math.random() * 2, 3);
        }
      }
    }
    trackP = null;
  }

  /* ---------------- input ---------------- */
  function canAimNow(held) {
    var sp = Math.sqrt(cvx * cvx + cvy * cvy);
    return sp < REST_SPEED || held > 0.22;
  }

  function doLaunch() {
    var costOk = 1;
    if (launchCount > 0) {
      costOk = 0.35 + 0.65 * U.clamp(fuel / RELAUNCH_COST, 0, 1);
      fuel = U.clamp(fuel - RELAUNCH_COST, 0, 1);
    }
    var pw = aimPow * costOk;
    var len = Math.sqrt(aimAX * aimAX + aimAY * aimAY);
    if (len < 1) return;
    var ux = aimAX / len, uy = aimAY / len;
    var sp = LAUNCH_MAX * pw;
    cvx = ux * sp; cvy = uy * sp;
    launchCount++;
    firstRunHint = false;
    Store.set('played', true);
    Sound.tone(190, 0.34, 'sawtooth', 0.11, 760 + 400 * pw);
    Sound.noise(0.16, 0.05);
    Buzz(18);
    addShake(3 + pw * 3);
    for (var i = 0; i < 12; i++) {
      var a = Math.atan2(-uy, -ux) + (Math.random() - 0.5) * 1.1;
      var s = 60 + Math.random() * 200 * pw;
      spawnP(cx, cy, Math.cos(a) * s, Math.sin(a) * s, 0.3 + Math.random() * 0.4, 2 + Math.random() * 2, 1);
    }
  }

  function doBurn() {
    if (fuel <= 0.005) { UI.toast('No fuel'); return; }
    var sp = Math.sqrt(cvx * cvx + cvy * cvy);
    if (sp < 12) return;
    fuel = U.clamp(fuel - BURN_COST, 0, 1);
    cvx += cvx / sp * BURN_IMPULSE; cvy += cvy / sp * BURN_IMPULSE;
    Sound.tone(420, 0.12, 'square', 0.08, 900);
    Buzz(10);
    for (var i = 0; i < 8; i++) {
      var a = Math.atan2(-cvy, -cvx) + (Math.random() - 0.5) * 0.9;
      var s = 70 + Math.random() * 170;
      spawnP(cx, cy, Math.cos(a) * s, Math.sin(a) * s, 0.28 + Math.random() * 0.3, 1.6 + Math.random() * 2, 1);
    }
  }

  Input(eng.canvas, {
    down: function (x, y) {
      firstGesture();
      if (state !== ST_PLAY) return;
      downX = x; downY = y; curX = x; curY = y;
      downT = runTime; dragging = false; aiming = false;
      if (canAimNow(0)) { aiming = true; aimPow = 0; aimAX = 0; aimAY = 0; }
    },
    move: function (x, y) {
      if (state !== ST_PLAY) return;
      curX = x; curY = y;
      var dx = x - downX, dy = y - downY;
      if (dx * dx + dy * dy > 144) dragging = true;
      if (!aiming && dragging && canAimNow(runTime - downT)) {
        aiming = true;
        cvx = 0; cvy = 0;
      }
      if (aiming) {
        var len = Math.sqrt(dx * dx + dy * dy);
        aimPow = U.clamp(len / MAX_DRAG, 0, 1);
        // screen delta -> world velocity: opposite the drag, y flipped (world y is up)
        if (len > 1) { aimAX = -dx / len * LAUNCH_MAX * aimPow; aimAY = dy / len * LAUNCH_MAX * aimPow; }
        else { aimAX = 0; aimAY = 0; aimPow = 0; }
      }
    },
    up: function () {
      if (state !== ST_PLAY) { aiming = false; dragging = false; return; }
      if (aiming && aimPow > 0.06) doLaunch();
      else if (!dragging && (runTime - downT) < 0.3) doBurn();
      aiming = false; dragging = false;
    }
  });

  /* ---------------- update ---------------- */
  function update(dt) {
    if (state === ST_MENU || state === ST_PAUSE) { menuTime += dt; return; }
    runTime += dt;

    if (state === ST_DYING) {
      dyingT += dt;
      deathFlash = Math.max(0, deathFlash - dt * 2.2);
      updateParticles(dt);
      updatePopups(dt);
      updateShake(dt);
      if (dyingT > 1.05) { eng.stop(); gameOver(); }
      return;
    }

    if (invuln > 0) invuln -= dt;
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
    if (firstRunHint) hintT += dt;

    /* ---- gravity + integrate ---- */
    if (aiming) { cvx = 0; cvy = 0; }   // frozen while you line up the sling
    else {
      gravAt(cx, cy);
      cvx += _ax * dt; cvy += _ay * dt;
    }
    var dm = Math.exp(-DAMP_K * dt);
    cvx *= dm; cvy *= dm;
    var sp2 = cvx * cvx + cvy * cvy;
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      var k = MAX_SPEED / Math.sqrt(sp2); cvx *= k; cvy *= k;
    }
    cx += cvx * dt; cy += cvy * dt;

    if (cx < cr) { cx = cr; cvx = -cvx * 0.62; Sound.tap(); }
    else if (cx > W - cr) { cx = W - cr; cvx = -cvx * 0.62; Sound.tap(); }

    /* ---- pulsars ---- */
    var i, p;
    for (i = 0; i < planets.length; i++) {
      p = planets[i];
      p.rot += p.spin * dt;
      if (p.type !== 1) continue;
      if (p.y < camY - H * 0.6 || p.y > camY + H * 2.1) continue;
      p.wt += dt;
      if (p.wt < 2.45) {
        p.waveOn = false;
        p.charge = p.wt > 1.55 ? (p.wt - 1.55) / 0.9 : 0;
      } else {
        p.charge = 1;
        p.waveOn = true;
        p.waveR = p.r + (p.wt - 2.45) / 0.95 * p.r * 5.5;
        if (!p.waveHit) {
          var d = U.dist(cx, cy, p.x, p.y);
          if (Math.abs(d - p.waveR) < 30) {
            p.waveHit = true;
            var ux = (cx - p.x) / (d || 1), uy = (cy - p.y) / (d || 1);
            cvx += ux * 540; cvy += uy * 540;
            Sound.tone(90, 0.28, 'sawtooth', 0.12, 240);
            addShake(8); Buzz(24);
            for (var q = 0; q < 8; q++) {
              spawnP(cx, cy, ux * (80 + Math.random() * 200), uy * (80 + Math.random() * 200),
                     0.3 + Math.random() * 0.3, 2, 4);
            }
          }
        }
        if (p.wt > 3.45) { p.wt = 0; p.waveHit = false; p.waveOn = false; }
      }
    }

    /* ---- collisions ---- */
    if (invuln <= 0) {
      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        if (p.y < camY - H * 0.6 || p.y > camY + H * 2.1) continue;
        var ddx = p.x - cx, ddy = p.y - cy, dd2 = ddx * ddx + ddy * ddy;
        var kill = p.type === 2 ? p.r * 1.2 : p.r + cr * 0.35;
        if (dd2 < kill * kill) { die(p.type === 2 ? 'SPAGHETTIFIED' : 'IMPACT'); return; }
      }
    }

    /* ---- gravity assist tracking ---- */
    var best = null, bestD = 1e9;
    for (i = 0; i < planets.length; i++) {
      p = planets[i];
      if (p.type === 2) continue;
      var ax2 = p.x - cx, ay2 = p.y - cy, d22 = ax2 * ax2 + ay2 * ay2;
      var lim = p.r * 2.5;
      if (d22 < lim * lim && d22 < bestD) { bestD = d22; best = p; }
    }
    if (best !== trackP) {
      if (trackP) finishAssist();
      trackP = best;
      if (best) { trackVX = cvx; trackVY = cvy; }
    }

    /* ---- stardust ---- */
    for (i = 0; i < motes.length; i++) {
      var m = motes[i];
      if (m.taken) continue;
      if (m.orbR > 0) {
        m.orbA += m.orbS * dt;
        m.x = m.ox + Math.cos(m.orbA) * m.orbR;
        m.y = m.oy + Math.sin(m.orbA) * m.orbR;
      }
      if (m.y < camY - H * 0.6 || m.y > camY + H * 2.1) continue;
      m.phase += dt * 3;
      var mdx = m.x - cx, mdy = m.y - cy;
      if (mdx * mdx + mdy * mdy < 380) {
        m.taken = true;
        fuel = U.clamp(fuel + MOTE_FUEL, 0, 1);
        bonus += MOTE_SCORE;
        Sound.tone(1180, 0.14, 'sine', 0.1, 1760);
        for (var s = 0; s < 6; s++) {
          var aa = Math.random() * 6.283, ss = 40 + Math.random() * 110;
          spawnP(m.x, m.y, Math.cos(aa) * ss, Math.sin(aa) * ss, 0.3 + Math.random() * 0.3, 1.6, 3);
        }
      }
    }

    /* ---- trail ---- */
    var spd = Math.sqrt(cvx * cvx + cvy * cvy);
    trailAcc += dt * (6 + spd * 0.055);
    while (trailAcc >= 1) {
      trailAcc -= 1;
      spawnP(cx + (Math.random() - 0.5) * 5, cy + (Math.random() - 0.5) * 5,
             -cvx * 0.13 + (Math.random() - 0.5) * 40, -cvy * 0.13 + (Math.random() - 0.5) * 40,
             0.35 + Math.random() * 0.45, 2 + Math.random() * 2.6, 0);
    }

    /* ---- camera ---- */
    var creep = Math.min(92, 7 + runTime * 0.85);
    camY += creep * dt;
    var want = cy - H * 0.45;
    if (want > camY) camY += (want - camY) * Math.min(1, dt * 4.2);

    /* ---- score ---- */
    if (cy > maxY) maxY = cy;
    altLy = Math.max(0, (maxY - startY) * LY_PER_PX);

    ensureChunks(camY + H * 2.2);
    cullFrame++;
    if (cullFrame > 40) { cullFrame = 0; cullField(); }

    /* ---- death floor ---- */
    if (cy < camY + 4) { die('LOST TO THE VOID'); return; }

    updateParticles(dt);
    updatePopups(dt);
    updateShake(dt);

    if (aiming) predict();

    /* ---- hud ---- */
    var a = Math.floor(altLy) + bonus;
    if (a !== lastAltShown) { lastAltShown = a; elAlt.textContent = a; }
    if (combo !== lastComboShown) {
      lastComboShown = combo;
      if (combo > 1) { elCombo.textContent = 'x' + combo; elComboWrap.classList.add('on'); }
      else elComboWrap.classList.remove('on');
    }
  }

  var trailAcc = 0, cullFrame = 0, menuTime = 0;

  function updateParticles(dt) {
    for (var i = 0; i < PN; i++) {
      if (plf[i] <= 0) continue;
      plf[i] -= dt;
      ppx[i] += pvx[i] * dt; ppy[i] += pvy[i] * dt;
      pvx[i] *= 0.965; pvy[i] *= 0.965;
    }
  }

  function updatePopups(dt) {
    for (var i = 0; i < QN; i++) {
      if (qt[i] <= 0) continue;
      qt[i] -= dt * 0.75;
      qy[i] += 34 * dt;
    }
  }

  function updateShake(dt) {
    if (shakeT > 0) { shakeT -= dt * 3.4; if (shakeT <= 0) { shakeT = 0; shake = 0; } }
  }

  /* ---------------- render ---------------- */
  function sy(worldY) { return H - (worldY - camY); }

  function render(c, w, h, t) {
    c.save();
    if (shakeT > 0 && shake > 0) {
      var s = shake * shakeT;
      c.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    c.fillStyle = bgGrad || COL_BG;
    c.fillRect(-30, -30, w + 60, h + 60);

    drawStars(c, w, h);

    if (state === ST_MENU || state === ST_PAUSE) { drawMenuBg(c, w, h, t); c.restore(); return; }

    drawVoid(c, w, h, t);
    drawPlanets(c, w, h, t);
    drawMotes(c, t);
    drawParticles(c);
    if (state === ST_PLAY) {
      if (aiming) drawAim(c);
      drawComet(c, t);
      if (firstRunHint && launchCount === 0 && !aiming) drawHint(c);
    }
    drawPopups(c);

    if (deathFlash > 0) {
      c.globalAlpha = deathFlash * 0.5;
      c.fillStyle = DANGER; c.fillRect(-30, -30, w + 60, h + 60);
      c.globalAlpha = 1;
    }
    c.restore();
  }

  function drawStars(c, w, h) {
    for (var L = 0; L < 3; L++) {
      var X = starX[L], Y = starY[L], R = starR[L];
      if (!X) continue;
      var off = (camY * SL[L]) % STAR_SPAN;
      c.fillStyle = L === 2 ? 'rgba(255,255,255,.85)' : (L === 1 ? 'rgba(200,215,255,.55)' : 'rgba(160,180,220,.32)');
      for (var i = 0; i < X.length; i++) {
        var yy = (Y[i] + off) % STAR_SPAN;
        if (yy < 0) yy += STAR_SPAN;
        c.fillRect(X[i], yy, R[i], R[i]);
      }
    }
  }

  function drawMenuBg(c, w, h, t) {
    // slow ambient planets behind the menu
    var n = 3;
    for (var i = 0; i < n; i++) {
      var px2 = w * (0.2 + 0.3 * i) + Math.sin(t * 0.12 + i) * 20;
      var py2 = h * (0.22 + 0.28 * i) + Math.cos(t * 0.1 + i * 2) * 16;
      var r = 40 + i * 22;
      c.globalAlpha = 0.16;
      c.fillStyle = i === 1 ? ACCENT2 : ACCENT;
      c.beginPath(); c.arc(px2, py2, r, 0, 6.283); c.fill();
      c.globalAlpha = 0.3;
      c.strokeStyle = i === 1 ? ACCENT2 : ACCENT; c.lineWidth = 1.2;
      c.beginPath(); c.arc(px2, py2, r + 8, 0, 6.283); c.stroke();
    }
    c.globalAlpha = 1;
  }

  function drawVoid(c, w, h, t) {
    var danger = U.clamp(1 - (cy - camY) / (h * 0.5), 0, 1);
    var band = 86 + danger * 60;
    c.globalAlpha = 0.16 + danger * 0.42;
    c.fillStyle = danger > 0.55 ? DANGER : ACCENT2;
    for (var i = 0; i < 7; i++) {
      c.globalAlpha = (0.05 + danger * 0.13) * (1 - i / 7);
      c.fillRect(0, h - band * (1 - i / 7), w, band);
    }
    c.globalAlpha = 0.75 + danger * 0.25;
    c.strokeStyle = danger > 0.55 ? DANGER : ACCENT2;
    c.lineWidth = 2;
    c.beginPath();
    for (var x = 0; x <= w; x += 12) {
      var yy = h - 2 + Math.sin(x * 0.05 + t * 3) * (1.5 + danger * 3);
      if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  function drawPlanets(c, w, h, t) {
    var top = camY - h * 0.55, bot = camY + h * 2.0;
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      if (p.y < top || p.y > bot) continue;
      var Y = sy(p.y), X = p.x;
      if (p.type === 2) { drawHole(c, X, Y, p, t); continue; }

      var col = p.type === 1 ? '#ff7ae0' : (p.hue < 0.34 ? ACCENT : (p.hue < 0.68 ? ACCENT2 : GOLD));

      // influence halo
      c.globalAlpha = 0.055;
      c.fillStyle = col;
      c.beginPath(); c.arc(X, Y, p.r * 2.5, 0, 6.283); c.fill();

      // body
      c.globalAlpha = 1;
      c.fillStyle = '#0d1526';
      c.beginPath(); c.arc(X, Y, p.r, 0, 6.283); c.fill();
      c.globalAlpha = 0.34;
      c.fillStyle = col;
      c.beginPath(); c.arc(X, Y, p.r, 0, 6.283); c.fill();
      c.globalAlpha = 0.28;
      c.beginPath(); c.arc(X - p.r * 0.28, Y - p.r * 0.3, p.r * 0.62, 0, 6.283); c.fill();

      // surface bands
      c.globalAlpha = 0.22; c.strokeStyle = col; c.lineWidth = 1.4;
      c.beginPath();
      c.ellipse(X, Y, p.r * 0.82, p.r * 0.3, p.rot, 0, 6.283);
      c.stroke();

      c.globalAlpha = 1; c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.arc(X, Y, p.r, 0, 6.283); c.stroke();

      if (p.type === 1) {
        if (p.charge > 0) {
          c.globalAlpha = 0.35 + 0.55 * p.charge;
          c.strokeStyle = '#fff'; c.lineWidth = 1 + 3 * p.charge;
          c.beginPath(); c.arc(X, Y, p.r + 5 + 5 * (1 - p.charge), 0, 6.283); c.stroke();
        }
        if (p.waveOn) {
          var wr = p.waveR;
          c.globalAlpha = U.clamp(1 - (wr - p.r) / (p.r * 5.5), 0, 1) * 0.85;
          c.strokeStyle = '#ff7ae0'; c.lineWidth = 5;
          c.beginPath(); c.arc(X, Y, wr, 0, 6.283); c.stroke();
          c.globalAlpha *= 0.45; c.lineWidth = 12;
          c.beginPath(); c.arc(X, Y, wr, 0, 6.283); c.stroke();
        }
      }
      c.globalAlpha = 1;
    }
  }

  function drawHole(c, X, Y, p, t) {
    c.globalAlpha = 0.05; c.fillStyle = ACCENT2;
    c.beginPath(); c.arc(X, Y, p.r * 9, 0, 6.283); c.fill();
    c.globalAlpha = 0.05;
    c.beginPath(); c.arc(X, Y, p.r * 5, 0, 6.283); c.fill();
    // lensing ring
    c.globalAlpha = 0.85;
    c.strokeStyle = '#c8b6ff'; c.lineWidth = 2.2;
    c.beginPath(); c.ellipse(X, Y, p.r * 2.05, p.r * 0.75, t * 0.5, 0, 6.283); c.stroke();
    c.globalAlpha = 0.4; c.strokeStyle = ACCENT2; c.lineWidth = 6;
    c.beginPath(); c.ellipse(X, Y, p.r * 2.05, p.r * 0.75, t * 0.5, 0, 6.283); c.stroke();
    // event horizon
    c.globalAlpha = 1; c.fillStyle = '#02030a';
    c.beginPath(); c.arc(X, Y, p.r * 1.2, 0, 6.283); c.fill();
    c.globalAlpha = 0.55; c.strokeStyle = '#8f7bff'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(X, Y, p.r * 1.2, 0, 6.283); c.stroke();
    c.globalAlpha = 1;
  }

  function drawMotes(c, t) {
    var top = camY - H * 0.55, bot = camY + H * 2.0;
    c.fillStyle = GOLD;
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      if (m.taken || m.y < top || m.y > bot) continue;
      var Y = sy(m.y);
      var pl = 0.6 + 0.4 * Math.sin(m.phase + t * 2);
      c.globalAlpha = 0.9 * pl;
      c.beginPath(); c.arc(m.x, Y, 3.1, 0, 6.283); c.fill();
      c.globalAlpha = 0.18 * pl;
      c.beginPath(); c.arc(m.x, Y, 8, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawParticles(c) {
    for (var i = 0; i < PN; i++) {
      if (plf[i] <= 0) continue;
      var k = plf[i] / pml[i];
      var Y = sy(ppy[i]);
      if (Y < -20 || Y > H + 20) continue;
      var tp = ptp[i];
      c.globalAlpha = k * (tp === 0 ? 0.75 : 0.9);
      c.fillStyle = tp === 0 ? (k > 0.6 ? '#ffffff' : ACCENT)
                  : tp === 1 ? ACCENT
                  : tp === 2 ? DANGER
                  : tp === 3 ? GOLD : '#ff7ae0';
      var s = psz[i] * k;
      c.beginPath(); c.arc(ppx[i], Y, s, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }

  function drawAim(c) {
    // dotted predicted arc (real physics)
    for (var i = 0; i < prN; i += 4) {
      var Y = sy(prY[i]);
      if (Y < -20 || Y > H + 20) continue;
      var k = 1 - i / PRED_STEPS;
      c.globalAlpha = 0.16 + 0.6 * k;
      c.fillStyle = prHit ? DANGER : ACCENT;
      c.beginPath(); c.arc(prX[i], Y, 2.4 * (0.4 + k * 0.8), 0, 6.283); c.fill();
    }
    // pull-back indicator
    var Yc = sy(cy);
    c.globalAlpha = 0.5;
    c.strokeStyle = prHit ? DANGER : ACCENT;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, Yc);
    c.lineTo(cx - aimAX * 0.11, Yc + aimAY * 0.11);
    c.stroke();
    c.globalAlpha = 0.9;
    c.beginPath(); c.arc(cx, Yc, 16 + 12 * aimPow, 0, 6.283); c.stroke();
    c.globalAlpha = 1;
  }

  function drawComet(c, t) {
    var Y = sy(cy);
    var pulse = 0.7 + 0.3 * Math.sin(t * 8);
    // glow
    c.globalAlpha = 0.16;
    c.fillStyle = ACCENT;
    c.beginPath(); c.arc(cx, Y, 20, 0, 6.283); c.fill();
    // core
    c.globalAlpha = invuln > 0 ? (0.4 + 0.6 * Math.abs(Math.sin(t * 14))) : 1;
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(cx, Y, cr, 0, 6.283); c.fill();
    c.globalAlpha = 0.7 * pulse;
    c.strokeStyle = ACCENT; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, Y, cr + 3, 0, 6.283); c.stroke();

    // fuel ring
    c.globalAlpha = 0.22; c.strokeStyle = '#ffffff'; c.lineWidth = 3;
    c.beginPath(); c.arc(cx, Y, 15, 0, 6.283); c.stroke();
    c.globalAlpha = 1;
    c.strokeStyle = fuel < 0.26 ? DANGER : (fuel < 0.55 ? GOLD : ACCENT);
    c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.arc(cx, Y, 15, -1.5708, -1.5708 + 6.283 * U.clamp(fuel, 0, 1)); c.stroke();
    c.lineCap = 'butt';
    c.globalAlpha = 1;
  }

  function drawHint(c) {
    var Y = sy(cy);
    var k = (hintT % 2.4) / 2.4;
    var e = k < 0.72 ? k / 0.72 : 1;
    var ox = 0, oy = 78 * e;
    var fade = k < 0.08 ? k / 0.08 : (k > 0.82 ? Math.max(0, (1 - k) / 0.18) : 1);
    c.globalAlpha = 0.35 * fade;
    c.strokeStyle = '#ffffff'; c.lineWidth = 2;
    c.setLineDash(DASH);
    c.beginPath(); c.moveTo(cx, Y); c.lineTo(cx + ox, Y + oy); c.stroke();
    c.setLineDash(NODASH);
    c.globalAlpha = 0.55 * fade;
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(cx + ox, Y + oy, 15, 0, 6.283); c.fill();
    c.globalAlpha = 0.9 * fade;
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.6;
    c.beginPath(); c.arc(cx + ox, Y + oy, 15, 0, 6.283); c.stroke();
    c.globalAlpha = 0.75 * fade;
    c.font = '600 12px system-ui,sans-serif';
    c.textAlign = 'center';
    c.fillText('DRAG BACK & RELEASE', cx, Y + oy + 40);
    c.textAlign = 'left';
    c.globalAlpha = 1;
  }

  function drawPopups(c) {
    c.textAlign = 'center';
    for (var i = 0; i < QN; i++) {
      if (qt[i] <= 0) continue;
      var Y = sy(qy[i]);
      c.globalAlpha = U.clamp(qt[i], 0, 1);
      c.fillStyle = qcol[i];
      c.font = '800 14px system-ui,sans-serif';
      c.fillText(qtxt[i], qx[i], Y);
    }
    c.textAlign = 'left';
    c.globalAlpha = 1;
  }

  /* ---------------- wiring ---------------- */
  eng.onUpdate = update;
  eng.onRender = render;
  eng.onResize = function (w, h) {
    W = w; H = h;
    buildStars(); buildBg();
  };

  var adsInited = false;
  function firstGesture() {
    if (adsInited) return;
    adsInited = true;
    try {
      var r = Ads.init();
      if (r && r.then) r.then(function () { if (state !== ST_PLAY) Ads.showBanner(); });
    } catch (e) {}
  }
  document.addEventListener('pointerdown', firstGesture, { once: true, passive: true });

  $('play').addEventListener('click', function () { firstGesture(); Sound.tap(); startRun(); });
  $('retry').addEventListener('click', function () { Sound.tap(); startRun(); });
  $('home').addEventListener('click', function () { Sound.tap(); eng.stop(); toMenu(); eng.start(); });
  $('resume').addEventListener('click', function () {
    Sound.tap(); state = ST_PLAY; UI.hide(); elHud.classList.add('on'); Ads.hideBanner();
  });
  $('quit').addEventListener('click', function () { Sound.tap(); state = ST_DYING; dyingT = 2; });
  btnCont.addEventListener('click', async function () {
    btnCont.disabled = true;
    var ok = PB.takeBoost('starfall_continue', 1) > 0;
    if (!ok) { try { ok = await Ads.showRewarded(); } catch (e) {} }
    btnCont.disabled = false;
    if (ok) { btnCont.style.display = 'none'; continueRun(); }
    else UI.toast('Ad unavailable');
  });

  function syncMute() { btnMute.textContent = Sound.muted ? '🔇' : '🔊'; }
  btnMute.addEventListener('click', function (e) {
    e.stopPropagation(); Sound.toggle(); syncMute(); if (!Sound.muted) Sound.tap();
  });
  syncMute();

  window.Game = {
    onBackground: function () {
      if (state === ST_PLAY) {
        state = ST_PAUSE;
        aiming = false; dragging = false;
        elHud.classList.remove('on');
        UI.show('pause');
      }
    }
  };

  /* boot */
  W = eng.w || 390; H = eng.h || 700;
  buildStars(); buildBg();
  clearField();
  toMenu();
  eng.start();
})();
