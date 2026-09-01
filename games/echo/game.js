/* ============================================================
   ECHO — see with sound.
   A dark maze. Tap to ping. Walls light where the ring touches,
   then fade. Navigate from memory.
   ============================================================ */
(function () {
  'use strict';

  var MAXLV   = 60;
  var FADE    = 3.5;          // seconds a lit wall takes to die
  var PR      = 0.17;         // player radius, in cells
  var SPEED   = 3.15;         // cells / second
  var PING_PX = 420;          // ring speed, px / second

  var E  = Engine('cv');
  var ctx = E.ctx;
  var cv  = E.canvas;
  var el  = function (id) { return document.getElementById(id); };

  /* ---------------- persistence ---------------- */
  var unlocked = Store.get('unlocked', 1);
  var bests    = Store.get('bests', {});

  /* ---------------- runtime state ---------------- */
  var mode = 'menu';                 // menu | levels | play | pause | clear | fail
  var lvl  = null;
  var now  = 0;                      // engine clock, seconds
  var startedAt = 0, elapsed = 0;
  var bonusPings = 0;
  var hintA = 0;
  var adsBooted = false;

  var P = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
  var pings = [];
  var pingsLeft = 0;

  /* pointer */
  var drag = false, dragX = 0, dragY = 0, downT = 0, downX = 0, downY = 0;

  /* layout (px) */
  var cs = 24, offX = 0, offY = 0;
  var lineW = 2, halo = null, haloR = 0;

  /* audio pacing */
  var subT = 0, sirT = 0, exitPulseT = 0;

  /* render buckets — pre-allocated, never re-created */
  var NB = 6, bkt = [];
  for (var _b = 0; _b < NB; _b++) bkt.push([]);

  /* ============================================================
     LEVEL GENERATION — recursive backtracker, fully seeded
     ============================================================ */
  function buildLevel(n) {
    var rnd = U.seeded(n * 9176 + 1337);
    var C, R;
    if (n === 1) { C = 4; R = 5; }
    else {
      var g = Math.floor((n - 1) / 4);
      C = Math.min(11, 6 + g);
      R = Math.min(16, 9 + g);
    }

    var r, c, i;
    var hw = [], vw = [];                       // hw[r][c] : wall above cell (r,c)
    for (r = 0; r <= R; r++) { var row = []; for (c = 0; c < C; c++) row.push(true); hw.push(row); }
    for (r = 0; r < R; r++)  { var rw = [];  for (c = 0; c <= C; c++) rw.push(true); vw.push(rw); }

    var seen = [], stack = [0];
    for (i = 0; i < C * R; i++) seen.push(false);
    seen[0] = true;
    var nb = [];
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cr = (cur / C) | 0, cc = cur % C;
      nb.length = 0;
      if (cr > 0     && !seen[cur - C]) nb.push(0);
      if (cc < C - 1 && !seen[cur + 1]) nb.push(1);
      if (cr < R - 1 && !seen[cur + C]) nb.push(2);
      if (cc > 0     && !seen[cur - 1]) nb.push(3);
      if (!nb.length) { stack.pop(); continue; }
      var d = nb[(rnd() * nb.length) | 0], nx;
      if (d === 0)      { hw[cr][cc] = false;     nx = cur - C; }
      else if (d === 1) { vw[cr][cc + 1] = false; nx = cur + 1; }
      else if (d === 2) { hw[cr + 1][cc] = false; nx = cur + C; }
      else              { vw[cr][cc] = false;     nx = cur - 1; }
      seen[nx] = true; stack.push(nx);
    }

    function open(rr, cch, dir) {
      if (dir === 0) return !hw[rr][cch];
      if (dir === 1) return !vw[rr][cch + 1];
      if (dir === 2) return !hw[rr + 1][cch];
      return !vw[rr][cch];
    }

    /* BFS from cell 0 -> distances, exit = farthest */
    var dist = [], q = [0], head = 0;
    for (i = 0; i < C * R; i++) dist.push(-1);
    dist[0] = 0;
    while (head < q.length) {
      var k = q[head++]; var kr = (k / C) | 0, kc = k % C;
      if (kr > 0     && open(kr, kc, 0) && dist[k - C] < 0) { dist[k - C] = dist[k] + 1; q.push(k - C); }
      if (kc < C - 1 && open(kr, kc, 1) && dist[k + 1] < 0) { dist[k + 1] = dist[k] + 1; q.push(k + 1); }
      if (kr < R - 1 && open(kr, kc, 2) && dist[k + C] < 0) { dist[k + C] = dist[k] + 1; q.push(k + C); }
      if (kc > 0     && open(kr, kc, 3) && dist[k - 1] < 0) { dist[k - 1] = dist[k] + 1; q.push(k - 1); }
    }
    var exitCell = 0, far = -1;
    if (n === 1) {                                   // teaching level: exit close by
      var want = 4, bestD = 1e9;
      for (i = 1; i < C * R; i++) {
        if (dist[i] < 0) continue;
        var gap = Math.abs(dist[i] - want);
        if (gap < bestD) { bestD = gap; exitCell = i; }
      }
    } else {
      for (i = 0; i < C * R; i++) if (dist[i] > far) { far = dist[i]; exitCell = i; }
    }

    /* flat, pre-computed segment list (cell space) */
    var segs = [], hwIdx = [], vwIdx = [];
    var echoChance = n >= 12 ? Math.min(0.22, 0.10 + (n - 12) * 0.012) : 0;
    for (r = 0; r <= R; r++) {
      var hr = [];
      for (c = 0; c < C; c++) {
        if (!hw[r][c]) { hr.push(-1); continue; }
        var border = (r === 0 || r === R);
        hr.push(segs.length);
        segs.push({ mx: c + 0.5, my: r, hw: 0.5, hh: 0, litAt: -99, litAmp: 0,
                    echo: !border && rnd() < echoChance });
      }
      hwIdx.push(hr);
    }
    for (r = 0; r < R; r++) {
      var vr = [];
      for (c = 0; c <= C; c++) {
        if (!vw[r][c]) { vr.push(-1); continue; }
        var bd = (c === 0 || c === C);
        vr.push(segs.length);
        segs.push({ mx: c, my: r + 0.5, hw: 0, hh: 0.5, litAt: -99, litAmp: 0,
                    echo: !bd && rnd() < echoChance });
      }
      vwIdx.push(vr);
    }

    /* per-cell segment index for cheap collision */
    var cellSegs = [];
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) {
      var list = [];
      if (hwIdx[r][c]     >= 0) list.push(hwIdx[r][c]);
      if (hwIdx[r + 1][c] >= 0) list.push(hwIdx[r + 1][c]);
      if (vwIdx[r][c]     >= 0) list.push(vwIdx[r][c]);
      if (vwIdx[r][c + 1] >= 0) list.push(vwIdx[r][c + 1]);
      cellSegs.push(list);
    }

    /* pick cells that are far from both start and exit */
    var pool = [];
    for (i = 0; i < C * R; i++) if (dist[i] > 3 && i !== exitCell) pool.push(i);

    function take() {
      if (!pool.length) return -1;
      var j = (rnd() * pool.length) | 0, v = pool[j];
      pool.splice(j, 1);
      return v;
    }

    var drifters = [];
    if (n >= 4) {
      var dn = Math.min(5, 1 + Math.floor((n - 4) / 3));
      for (i = 0; i < dn; i++) {
        var dc = take(); if (dc < 0) break;
        drifters.push({ x: (dc % C) + 0.5, y: ((dc / C) | 0) + 0.5,
                        tr: (dc / C) | 0, tc: dc % C, from: -1, litAt: -99 });
      }
    }
    var sirens = [];
    if (n >= 8) {
      var sn = Math.min(4, 1 + Math.floor((n - 8) / 4));
      for (i = 0; i < sn; i++) {
        var sc = take(); if (sc < 0) break;
        sirens.push({ x: (sc % C) + 0.5, y: ((sc / C) | 0) + 0.5 });
      }
    }

    var area = C * R;
    var budget = Math.max(5, Math.round(8 * area / 54));

    return {
      n: n, C: C, R: R, hw: hw, vw: vw, open: open,
      segs: segs, cellSegs: cellSegs,
      ex: (exitCell % C) + 0.5, ey: ((exitCell / C) | 0) + 0.5,
      drifters: drifters, sirens: sirens, budget: budget
    };
  }

  /* ============================================================
     LAYOUT
     ============================================================ */
  function layout() {
    if (!lvl) return;
    var pad = 12;
    /* The frame can report a zero (or briefly negative-after-padding) box while
       it is being shown or rotated. An unclamped cell size makes haloR negative
       and createRadialGradient throws, killing the level. */
    cs = Math.min((E.w - pad * 2) / lvl.C, (E.h - pad * 2) / lvl.R);
    if (!(cs > 0.5)) cs = 0.5;
    offX = (E.w - cs * lvl.C) / 2;
    offY = (E.h - cs * lvl.R) / 2;
    lineW = Math.max(2, cs * 0.075);
    haloR = cs * 1.15;
    halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
    halo.addColorStop(0,    'rgba(200,255,244,0.55)');
    halo.addColorStop(0.18, 'rgba(78,225,193,0.26)');
    halo.addColorStop(0.55, 'rgba(78,225,193,0.07)');
    halo.addColorStop(1,    'rgba(78,225,193,0)');
    pings.length = 0;
  }
  E.onResize = layout;

  /* ============================================================
     LEVEL LIFECYCLE
     ============================================================ */
  function startLevel(n) {
    lvl = buildLevel(n);
    layout();
    P.x = 0.5; P.y = 0.5; P.vx = 0; P.vy = 0;
    pings.length = 0;
    pingsLeft = lvl.budget + bonusPings;
    lvl.pipTotal = pingsLeft;
    bonusPings = 0;
    drag = false;
    elapsed = 0; startedAt = now;
    subT = 0.5; sirT = 0.3; exitPulseT = 1.0;
    hintA = (n === 1) ? 1 : 0;
    mode = 'play';
    el('hudLv').textContent = n;
    el('hud').classList.add('on');
    renderPips(true);
    UI.hide();
    Ads.hideBanner();
    E.start();
  }

  function renderPips(force) {
    var box = el('pips');
    var total = lvl ? lvl.pipTotal : 0;
    if (force || box.childElementCount !== total) {
      box.textContent = '';
      if (total > 14) box.classList.add('sm'); else box.classList.remove('sm');
      for (var i = 0; i < total; i++) box.appendChild(document.createElement('i'));
    }
    var kids = box.children;
    for (var j = 0; j < kids.length; j++) {
      var on = j < pingsLeft;
      if (on) kids[j].classList.remove('off'); else kids[j].classList.add('off');
    }
  }

  function firePing() {
    if (pingsLeft <= 0) {
      /* Pings bought with Playbox tokens are claimed here, at the moment the
         player actually runs out and needs them — not at level start, where
         quitting or failing the level would have burned them for nothing. */
      var bought = PB.takeBoost('echo_pings', 3);
      if (bought > 0) {
        pingsLeft += bought;
        lvl.pipTotal += bought;
        UI.toast('+' + bought + ' pings from your token boost');
        Sound.good();
      } else {
        Sound.tone(140, 0.10, 'sine', 0.05);
        return;
      }
    }
    pingsLeft--;
    renderPips(false);
    pings.push({ x: P.x, y: P.y, r: 0, amp: 1,
                 max: (0.65 * Math.min(E.w, E.h)) / cs, sp: PING_PX / cs, born: now });
    Sound.ping();
    Buzz(8);
    if (hintA > 0) hintA = -1;         // start the fade-out
  }

  function emitExitPulse() {
    pings.push({ x: lvl.ex, y: lvl.ey, r: 0, amp: 0.26,
                 max: (0.34 * Math.min(E.w, E.h)) / cs, sp: (PING_PX * 0.62) / cs, born: now });
  }

  function winLevel() {
    mode = 'clear';
    el('hud').classList.remove('on');
    var key = String(lvl.n);
    var prev = bests[key];
    var isBest = (prev === undefined || elapsed < prev);
    if (isBest) { bests[key] = elapsed; Store.set('bests', bests); }
    if (lvl.n + 1 > unlocked && lvl.n < MAXLV) {
      unlocked = lvl.n + 1; Store.set('unlocked', unlocked); refreshMenu();
    }
    el('clearTitle').textContent = 'Level ' + lvl.n + ' Clear';
    el('clearTime').textContent = fmt(elapsed);
    el('clearBest').textContent = (isBest ? 'New best · ' : 'Best ') + fmt(bests[key]);
    el('btnNext').textContent = lvl.n >= MAXLV ? 'Menu' : 'Next';
    PB.report('level', { level: lvl.n, pingsLeft: pingsLeft, time: elapsed });
    Sound.great();
    UI.show('clear');
    Ads.showBanner();
  }

  function loseLevel(msg) {
    mode = 'fail';
    el('hud').classList.remove('on');
    el('failMsg').textContent = msg;
    Sound.bad(); Buzz(90);
    el('btnReward').style.display = Ads.isRewardedReady() ? '' : 'none';
    UI.show('fail');
    Ads.showBanner();
  }

  function fmt(s) { return (Math.round(s * 10) / 10).toFixed(1) + 's'; }

  /* ============================================================
     UPDATE
     ============================================================ */
  E.onUpdate = function (dt, t) {
    now = t;
    if (mode !== 'play' || !lvl) return;
    elapsed += dt;

    /* --- steering --- */
    var dvx = 0, dvy = 0;
    if (drag) {
      var tx = (dragX - offX) / cs, ty = (dragY - offY) / cs;
      var dx = tx - P.x, dy = ty - P.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.06) { dvx = dx / d * SPEED; dvy = dy / d * SPEED; }
    }
    var k = 1 - Math.exp(-dt * 22);            // tiny smoothing, no inertia to speak of
    P.vx += (dvx - P.vx) * k;
    P.vy += (dvy - P.vy) * k;
    P.x += P.vx * dt;
    P.y += P.vy * dt;
    resolve();

    /* --- pings --- */
    var i, j;
    for (i = pings.length - 1; i >= 0; i--) {
      var p = pings[i];
      p.r += p.sp * dt;
      if (p.r > p.max) { pings.splice(i, 1); continue; }
      var segs = lvl.segs;
      for (j = 0; j < segs.length; j++) {
        var s = segs[j];
        if (s.echo || s.litAt >= p.born) continue;
        var ax = Math.abs(p.x - s.mx) - s.hw; if (ax < 0) ax = 0;
        var ay = Math.abs(p.y - s.my) - s.hh; if (ay < 0) ay = 0;
        if (ax * ax + ay * ay <= p.r * p.r) { s.litAt = now; s.litAmp = p.amp; }
      }
      var dr = lvl.drifters;
      for (j = 0; j < dr.length; j++) {
        var g = dr[j];
        if (g.litAt >= p.born) continue;
        var gx = p.x - g.x, gy = p.y - g.y;
        if (gx * gx + gy * gy <= p.r * p.r) g.litAt = now;
      }
    }

    /* --- exit's own faint heartbeat --- */
    exitPulseT -= dt;
    if (exitPulseT <= 0) { exitPulseT = 2.0; emitExitPulse(); }

    /* --- drifters --- */
    for (i = 0; i < lvl.drifters.length; i++) {
      var m = lvl.drifters[i];
      var cx = m.tc + 0.5, cy = m.tr + 0.5;
      var mdx = cx - m.x, mdy = cy - m.y, md = Math.sqrt(mdx * mdx + mdy * mdy);
      if (md < 0.04) { pickDrifterTarget(m); }
      else {
        var st = Math.min(0.95 * dt, md);
        m.x += mdx / md * st; m.y += mdy / md * st;
      }
      var pdx = m.x - P.x, pdy = m.y - P.y;
      if (pdx * pdx + pdy * pdy < 0.058) { loseLevel('A drifter found you.'); return; }
    }

    /* --- sirens: audio only, lethal at the core --- */
    var nearest = 1e9;
    for (i = 0; i < lvl.sirens.length; i++) {
      var sr = lvl.sirens[i];
      var sdx = sr.x - P.x, sdy = sr.y - P.y;
      var sd = Math.sqrt(sdx * sdx + sdy * sdy);
      if (sd < nearest) nearest = sd;
      if (sd < 0.30) { loseLevel('You walked into a siren.'); return; }
    }
    sirT -= dt;
    if (sirT <= 0) {
      if (nearest < 4.2) {
        var cl = 1 - nearest / 4.2;
        sirT = U.lerp(0.85, 0.13, cl);
        Sound.tone(120 + 70 * cl, U.lerp(0.16, 0.07, cl), 'triangle', 0.015 + 0.13 * cl * cl);
      } else sirT = 0.4;
    }

    /* --- sub-tone: rises as the exit nears --- */
    var edx = lvl.ex - P.x, edy = lvl.ey - P.y;
    var ed = Math.sqrt(edx * edx + edy * edy);
    var span = Math.sqrt(lvl.C * lvl.C + lvl.R * lvl.R);
    var near = U.clamp(1 - ed / span, 0, 1);
    subT -= dt;
    if (subT <= 0) {
      subT = U.lerp(1.7, 0.62, near);
      Sound.tone(56 + 150 * near * near, 0.30, 'sine', 0.055);
    }

    /* --- exit reached? --- */
    if (ed < 0.36) { winLevel(); return; }

    /* --- hint fade --- */
    if (hintA < 0) { hintA += dt * 0.9; if (hintA >= 0) hintA = 0; }
  };

  function pickDrifterTarget(m) {
    var opts = [], rr = m.tr, cc = m.tc;
    if (rr > 0          && lvl.open(rr, cc, 0)) opts.push(0);
    if (cc < lvl.C - 1  && lvl.open(rr, cc, 1)) opts.push(1);
    if (rr < lvl.R - 1  && lvl.open(rr, cc, 2)) opts.push(2);
    if (cc > 0          && lvl.open(rr, cc, 3)) opts.push(3);
    if (opts.length > 1 && m.from >= 0) {
      var idx = opts.indexOf(m.from);
      if (idx >= 0) opts.splice(idx, 1);
    }
    if (!opts.length) return;
    var d = opts[(Math.random() * opts.length) | 0];
    m.from = (d + 2) % 4;
    if (d === 0) m.tr--; else if (d === 1) m.tc++; else if (d === 2) m.tr++; else m.tc--;
  }

  function resolve() {
    var cr = U.clamp(Math.floor(P.y), 0, lvl.R - 1);
    var cc = U.clamp(Math.floor(P.x), 0, lvl.C - 1);
    for (var it = 0; it < 3; it++) {
      var hit = false;
      for (var r = cr - 1; r <= cr + 1; r++) {
        if (r < 0 || r >= lvl.R) continue;
        for (var c = cc - 1; c <= cc + 1; c++) {
          if (c < 0 || c >= lvl.C) continue;
          var list = lvl.cellSegs[r * lvl.C + c];
          for (var i = 0; i < list.length; i++) {
            var s = lvl.segs[list[i]];
            var qx = U.clamp(P.x, s.mx - s.hw, s.mx + s.hw);
            var qy = U.clamp(P.y, s.my - s.hh, s.my + s.hh);
            var dx = P.x - qx, dy = P.y - qy;
            var d2 = dx * dx + dy * dy;
            if (d2 < PR * PR) {
              var d = Math.sqrt(d2);
              if (d < 1e-5) { dx = 0; dy = -1; d = 1; }
              var push = PR - d;
              P.x += dx / d * push; P.y += dy / d * push;
              hit = true;
            }
          }
        }
      }
      if (!hit) break;
      cr = U.clamp(Math.floor(P.y), 0, lvl.R - 1);
      cc = U.clamp(Math.floor(P.x), 0, lvl.C - 1);
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function decay(age) {
    if (age < 0 || age > FADE) return 0;
    var u = 1 - age / FADE;
    return Math.pow(u, 1.6);
  }

  E.onRender = function (c2, w, h, t) {
    c2.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
    c2.fillStyle = '#04060c';
    c2.fillRect(0, 0, w, h);
    if (!lvl || (mode !== 'play' && mode !== 'pause')) { ambient(c2, w, h, t); return; }

    var i, j;

    /* ---- lit walls, bucketed by brightness: two strokes per bucket ---- */
    for (i = 0; i < NB; i++) bkt[i].length = 0;
    var segs = lvl.segs;
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.echo) continue;
      var a = decay(now - s.litAt) * s.litAmp;
      if (a < 0.025) continue;
      var b = (a * NB) | 0; if (b >= NB) b = NB - 1;
      bkt[b].push(i);
    }
    c2.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      c2.lineWidth  = pass === 0 ? lineW * 3.0 : lineW;
      c2.strokeStyle = pass === 0 ? '#2ad0b0' : '#dbfff5';
      for (b = 0; b < NB; b++) {
        var list = bkt[b];
        if (!list.length) continue;
        var al = (b + 0.5) / NB;
        c2.globalAlpha = pass === 0 ? al * 0.15 : al;
        c2.beginPath();
        for (j = 0; j < list.length; j++) {
          var g = segs[list[j]];
          c2.moveTo(offX + (g.mx - g.hw) * cs, offY + (g.my - g.hh) * cs);
          c2.lineTo(offX + (g.mx + g.hw) * cs, offY + (g.my + g.hh) * cs);
        }
        c2.stroke();
      }
    }
    c2.globalAlpha = 1;

    /* ---- ping rings ---- */
    c2.lineWidth = 1.6;
    for (i = 0; i < pings.length; i++) {
      var p = pings[i];
      var f = 1 - p.r / p.max;
      c2.globalAlpha = U.clamp(f * f * 0.85 * p.amp + 0.03 * p.amp, 0, 1);
      c2.strokeStyle = p.amp > 0.5 ? '#9ff5e2' : '#7c5cff';
      c2.beginPath();
      c2.arc(offX + p.x * cs, offY + p.y * cs, p.r * cs, 0, 6.2832);
      c2.stroke();
    }
    c2.globalAlpha = 1;

    /* ---- exit gate ---- */
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.3);
    var ex = offX + lvl.ex * cs, ey = offY + lvl.ey * cs;
    c2.strokeStyle = '#4ee1c1';
    c2.lineWidth = 2;
    c2.globalAlpha = 0.16 + 0.20 * pulse;
    c2.beginPath();
    c2.arc(ex, ey, cs * (0.20 + 0.10 * pulse), 0, 6.2832);
    c2.stroke();
    c2.globalAlpha = 0.10 + 0.10 * pulse;
    c2.beginPath();
    c2.arc(ex, ey, cs * 0.34, 0, 6.2832);
    c2.stroke();
    c2.globalAlpha = 1;

    /* ---- drifters: only where a ping washed over them ---- */
    for (i = 0; i < lvl.drifters.length; i++) {
      var m = lvl.drifters[i];
      var da = decay((now - m.litAt) * (FADE / 1.4));
      if (da < 0.03) continue;
      c2.globalAlpha = da;
      c2.fillStyle = '#ff6b6b';
      c2.beginPath();
      c2.arc(offX + m.x * cs, offY + m.y * cs, cs * 0.16, 0, 6.2832);
      c2.fill();
      c2.globalAlpha = da * 0.35;
      c2.strokeStyle = '#ff6b6b'; c2.lineWidth = 1.5;
      c2.beginPath();
      c2.arc(offX + m.x * cs, offY + m.y * cs, cs * 0.30, 0, 6.2832);
      c2.stroke();
    }
    c2.globalAlpha = 1;

    /* ---- player: always a faint halo, never lost ---- */
    var px = offX + P.x * cs, py = offY + P.y * cs;
    c2.save();
    c2.translate(px, py);
    if (halo) { c2.fillStyle = halo; c2.beginPath(); c2.arc(0, 0, haloR, 0, 6.2832); c2.fill(); }
    c2.fillStyle = '#eafff9';
    c2.beginPath(); c2.arc(0, 0, Math.max(2.2, cs * 0.10), 0, 6.2832); c2.fill();
    c2.restore();

    /* ---- first-run hint ---- */
    if (hintA !== 0) {
      c2.globalAlpha = Math.abs(hintA) * 0.85;
      c2.fillStyle = '#8b98b4';
      c2.textAlign = 'center';
      c2.font = '600 13px system-ui,-apple-system,sans-serif';
      c2.fillText('TAP TO PING  ·  DRAG TO MOVE', w / 2, h - 26);
      c2.globalAlpha = 1;
    }

    if (mode === 'pause') {
      c2.fillStyle = 'rgba(4,6,12,.55)';
      c2.fillRect(0, 0, w, h);
    }
  };

  /* menu / screens backdrop: slow silent sonar, purely decorative */
  function ambient(c2, w, h, t) {
    var cx = w / 2, cy = h * 0.42, R = Math.min(w, h) * 0.55;
    c2.strokeStyle = '#4ee1c1';
    c2.lineWidth = 1.2;
    for (var i = 0; i < 3; i++) {
      var f = ((t * 0.16) + i / 3) % 1;
      c2.globalAlpha = (1 - f) * 0.13;
      c2.beginPath();
      c2.arc(cx, cy, f * R, 0, 6.2832);
      c2.stroke();
    }
    c2.globalAlpha = 1;
  }

  /* ============================================================
     INPUT
     ============================================================ */
  Input(cv, {
    down: function (x, y) {
      if (mode !== 'play') return;
      drag = true; dragX = x; dragY = y;
      downT = Date.now(); downX = x; downY = y;
    },
    move: function (x, y) {
      if (mode !== 'play') return;
      dragX = x; dragY = y;
    },
    up: function (x, y) {
      if (mode !== 'play') { drag = false; return; }
      drag = false;
      var dt = Date.now() - downT;
      var mv = U.dist(x, y, downX, downY);
      if (dt < 180 && mv < 12) firePing();
    }
  });

  /* ============================================================
     SCREENS / UI
     ============================================================ */
  function bootAds() {
    if (adsBooted) return;
    adsBooted = true;
    Ads.init();
  }

  function refreshMenu() {
    el('chipBest').textContent = 'Best level ' + unlocked;
    el('chipMute').textContent = Sound.muted ? 'Sound off' : 'Sound on';
    var grid = el('lvGrid');
    var kids = grid.children;
    for (var i = 0; i < kids.length; i++) {
      var n = i + 1;
      if (n <= unlocked) kids[i].removeAttribute('disabled');
      else kids[i].setAttribute('disabled', '');
      if (bests[String(n)] !== undefined) kids[i].classList.add('done');
    }
  }

  (function buildGrid() {
    var grid = el('lvGrid');
    for (var n = 1; n <= MAXLV; n++) {
      var b = document.createElement('button');
      b.textContent = n;
      b.dataset.n = n;
      b.addEventListener('click', function () {
        bootAds(); Sound.tap();
        startLevel(parseInt(this.dataset.n, 10));
      });
      grid.appendChild(b);
    }
  })();

  function toMenu() {
    mode = 'menu';
    lvl = null;
    el('hud').classList.remove('on');
    refreshMenu();
    UI.show('menu');
    Ads.showBanner();
  }

  el('btnPlay').addEventListener('click', function () {
    bootAds(); Sound.tap(); startLevel(Math.min(unlocked, MAXLV));
  });
  el('btnLevels').addEventListener('click', function () {
    bootAds(); Sound.tap(); refreshMenu(); UI.show('levels');
  });
  el('btnLvBack').addEventListener('click', function () { Sound.tap(); UI.show('menu'); });
  el('chipMute').addEventListener('click', function () {
    Sound.toggle(); el('chipMute').textContent = Sound.muted ? 'Sound off' : 'Sound on';
  });

  el('pauseBtn').addEventListener('click', function () {
    if (mode !== 'play') return;
    mode = 'pause';
    drag = false;
    UI.show('pause');
  });
  el('btnResume').addEventListener('click', function () {
    if (mode !== 'pause') return;
    mode = 'play'; UI.hide();
  });
  el('btnRestart').addEventListener('click', function () {
    Sound.tap(); startLevel(lvl ? lvl.n : 1);
  });
  el('btnQuit').addEventListener('click', function () { Sound.tap(); toMenu(); });
  el('btnClearMenu').addEventListener('click', function () { Sound.tap(); toMenu(); });
  el('btnFailMenu').addEventListener('click', function () { Sound.tap(); toMenu(); });

  el('btnNext').addEventListener('click', async function () {
    Sound.tap();
    var n = lvl ? lvl.n : 1;
    if (n >= MAXLV) { toMenu(); return; }
    this.setAttribute('disabled', '');
    await Ads.maybeInterstitial();
    this.removeAttribute('disabled');
    startLevel(n + 1);
  });

  el('btnRetry').addEventListener('click', function () {
    Sound.tap(); startLevel(lvl ? lvl.n : 1);
  });

  el('btnReward').addEventListener('click', async function () {
    var btn = this;
    btn.setAttribute('disabled', '');
    var ok = await Ads.showRewarded();
    btn.removeAttribute('disabled');
    if (ok) {
      bonusPings = 4;
      UI.toast('+4 pings on this run');
      startLevel(lvl ? lvl.n : 1);
    } else {
      UI.toast('No ad available right now');
    }
  });

  /* pause when the app goes to the background */
  window.Game = {
    onBackground: function () {
      if (mode === 'play') { mode = 'pause'; drag = false; UI.show('pause'); }
    }
  };

  /* ---------------- boot ---------------- */
  refreshMenu();
  UI.show('menu');
  Ads.showBanner();
  E.start();
})();
