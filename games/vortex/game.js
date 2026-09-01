/* ============================================================
   VORTEX — fall inward, don't touch the walls.
   Radial inward-collapsing dodge game.
   ============================================================ */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2, PI = Math.PI;
  var D2R = PI / 180;

  /* ------------------------------------------------------------------
     FAIRNESS MODEL  (pure, dependency-free — the headless test slices
     this block straight out of the source file and runs it in node)
     ------------------------------------------------------------------ */
  /*__FAIR_START__*/
  var FAIR_TAU = Math.PI * 2;

  function fwrap(a) { a %= FAIR_TAU; if (a < 0) a += FAIR_TAU; return a; }

  /* Signed angular displacement achievable in `t` seconds while pushing
     in the POSITIVE direction the whole time, starting at velocity v0,
     with angular acceleration `acc` and hard cap `cap`. */
  function reachIn(t, v0, acc, cap) {
    if (!(t > 0)) return 0;
    var v = v0;
    if (v > cap) v = cap; else if (v < -cap) v = -cap;
    var tcap = (cap - v) / acc;
    if (tcap >= t) return v * t + 0.5 * acc * t * t;
    return v * tcap + 0.5 * acc * tcap * tcap + cap * (t - tcap);
  }

  /* Does the closed interval of achievable displacements [lo,hi] contain a
     landing that puts the ship inside a gap whose centre sits `d` radians
     ahead (mod 2pi), with `half` radians of slack either side?

     The interval is first shrunk TOWARD ITS MIDPOINT — 8% and then a flat
     0.04 rad — so every approval keeps real slack in hand. Shrinking toward
     the midpoint (rather than scaling toward zero) is what makes the result
     a genuine subset of what the ship can actually do. */
  function fairHits(lo, hi, d, half) {
    var mid = (lo + hi) * 0.5, hw = (hi - lo) * 0.5 * 0.92 - 0.04;
    if (hw < 0) hw = 0;
    lo = mid - hw; hi = mid + hw;
    if (hi - lo >= FAIR_TAU) return true;
    var k0 = Math.floor((lo - d - half) / FAIR_TAU);
    var k1 = Math.ceil((hi - d + half) / FAIR_TAU);
    for (var k = k0; k <= k1; k++) {
      var c = d + k * FAIR_TAU;
      if (c + half >= lo && c - half <= hi) return true;
    }
    return false;
  }

  /* Can the ship be inside at least one gap of this ring when it arrives?

     c = {
       t          seconds until the ring reaches the ship's orbit
       refA       ship angle at t=0 (or the angle it is pinned to by an
                  earlier ring that arrives first)
       refV       ship angular velocity at t=0
       acc, cap   ship angular acceleration / hard speed cap
       dash       angular size of one dash
       dashTime   seconds the dash snap costs (no steering during it)
       dashReady  is a dash available inside this window
       shipHalf   half the ship's angular width
       margin     extra safety slack demanded of every approved gap
       ringW      ring's angular velocity (rad/s, signed)
       n          number of gaps
       gs[]       gap start angles at t=0
       sz[]       gap ANGULAR SIZE AT ARRIVAL (shutter rings shrink!)
     }

     Without a dash the ship can land anywhere in one contiguous interval.
     A dash SHIFTS that interval by +/- dash and shortens it (the snap eats
     dashTime), and the three resulting windows may not overlap — so each is
     tested separately rather than being lumped into one fat range. */
  function isFair(c) {
    if (!(c.t > 0)) return false;
    var loBase = -reachIn(c.t, -c.refV, c.acc, c.cap);
    var hiBase = reachIn(c.t, c.refV, c.acc, c.cap);
    var td = c.t - c.dashTime;
    var canDash = !!c.dashReady && td > 0;
    var loD = 0, hiD = 0;
    if (canDash) {
      loD = -reachIn(td, -c.refV, c.acc, c.cap);
      hiD = reachIn(td, c.refV, c.acc, c.cap);
    }
    for (var i = 0; i < c.n; i++) {
      var half = c.sz[i] * 0.5 - c.shipHalf - c.margin;
      if (half <= 0) continue;                       // gap too tight, ever
      var centre = c.gs[i] + c.sz[i] * 0.5 + c.ringW * c.t;
      var d = fwrap(centre - c.refA);
      if (fairHits(loBase, hiBase, d, half)) return true;
      if (canDash) {
        if (fairHits(loD + c.dash, hiD + c.dash, d, half)) return true;
        if (fairHits(loD - c.dash, hiD - c.dash, d, half)) return true;
      }
    }
    return false;
  }
  /*__FAIR_END__*/

  /* ------------------------------------------------------------------
     tunables
     ------------------------------------------------------------------ */
  var SHIP_ACC   = 26;          // rad/s^2
  var SHIP_DEC   = 34;          // rad/s^2 (quick stop => crisp)
  var SHIP_CAP   = 3.7;         // rad/s
  var SHIP_HALF  = 0.078;       // half angular width, rad
  var FAIR_MARGIN = 0.045;      // slack isFair() insists on
  var DASH_ANG   = 50 * D2R;
  var DASH_TIME  = 0.07;        // near-instant, but readable
  var DASH_CD    = 1.55;
  var MAX_RINGS  = 14;
  var MAX_PARTS  = 220;
  var DRAG_PX    = 24;          // travel before a hold becomes a drag
  var DBLTAP_MS  = 300;

  var K_BASIC = 0, K_ROT = 1, K_TWIN = 2, K_SHUT = 3, K_REV = 4, K_PHAN = 5;
  var KIND_GATE = [0, 8, 18, 30, 45, 60];
  var DOUBLE_GATE = 80;

  var PU_NONE = -1, PU_SLOW = 0, PU_SHIELD = 1, PU_X2 = 2;

  var ZONES = [
    ['AZURE', 190], ['CRIMSON', 2], ['VIOLET', 268], ['AMBER', 40],
    ['JADE', 148], ['ROSE', 330], ['SOLAR', 58], ['ABYSS', 214]
  ];

  /* ------------------------------------------------------------------
     dom
     ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }
  var elHud = $('hud'), elScore = $('score'), elZoneName = $('zoneName'), elZoneNo = $('zoneNo');
  var elPuSlow = $('puSlow'), elPuSlowT = $('puSlowT'), elPuShield = $('puShield');
  var elPuDbl = $('puDbl'), elPuDblT = $('puDblT');
  var elBest = $('best'), elRuns = $('runs');
  var elFScore = $('fscore'), elFBest = $('fbest'), elRec = $('rec'), elCause = $('cause');
  var elRevive = $('revive'), elMute = $('mute'), elMotion = $('motion'), elPrivacy = $('privacy');

  /* ------------------------------------------------------------------
     state
     ------------------------------------------------------------------ */
  var eng = Engine('cv');
  var cx = 0, cy = 0, R_SHIP = 0, R_OUT = 0, THICK = 12, SCALE = 1;

  var S = {
    mode: 'menu',                 // menu | play | dying | over
    paused: false,
    score: 0, best: Store.get('best', 0), runs: Store.get('runs', 0),
    zone: 0, zoneCard: 0, zoneCardName: '',
    shipA: -PI / 2, shipV: 0,
    steer: 0,                     // -1 / 0 / +1 held direction
    dragging: false, dragA: 0,
    dashCd: 0, dashT: 0, dashFrom: 0, dashTo: 0, dashDir: 0,
    speed: 60, lastDir: 1,
    slowT: 0, shield: 0, x2: 0,
    invuln: 0,
    combo: 0, pitch: 0, dyingT: 0,
    shake: 0, sceneRot: 0,
    spawned: 0, elapsed: 0,
    cause: '', reviveUsed: false,
    tutorial: Store.get('taught', 0) ? 0 : 1,   // 1 = show prompt
    tutFade: 1,
    reduceMotion: Store.get('reduce', false),
    flash: 0, flashCol: '#fff',
    coreFlare: 0
  };

  /* ---- ring pool ---- */
  var rings = [];
  (function () {
    for (var i = 0; i < 28; i++) {
      rings.push({
        on: false, r: 0, w: 0, n: 1, kind: K_BASIC, dir: 1,
        gs: [0, 0], sz: [0, 0], sz0: [0, 0], sz1: [0, 0],
        pu: PU_NONE, puGap: 0, done: false, alpha: 1, spawnR: 0, prog: 0,
        pair: 0
      });
    }
  })();

  /* ---- particle pool ---- */
  var parts = [];
  (function () {
    for (var i = 0; i < MAX_PARTS; i++) {
      parts.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, sz: 2, col: '#fff' });
    }
  })();
  var partHead = 0;

  /* ---- palette ---- */
  var P = {};
  var SHUT_STEPS = 8;
  function buildPalette(zi) {
    var h = ZONES[zi % ZONES.length][1];
    P.h = h;
    P.bg = 'hsl(' + h + ',38%,5%)';
    P.base = 'hsl(' + h + ',82%,62%)';
    P.baseGlow = 'hsla(' + h + ',90%,64%,0.13)';
    P.rot = 'hsl(' + ((h + 26) % 360) + ',86%,64%)';
    P.rotGlow = 'hsla(' + ((h + 26) % 360) + ',90%,64%,0.13)';
    P.twin = 'hsl(' + ((h + 52) % 360) + ',86%,66%)';
    P.twinGlow = 'hsla(' + ((h + 52) % 360) + ',90%,66%,0.13)';
    P.core = 'hsl(' + ((h + 18) % 360) + ',92%,72%)';
    P.coreDim = 'hsla(' + ((h + 18) % 360) + ',92%,62%,0.55)';
    P.guide = 'hsla(' + h + ',55%,62%,0.11)';
    P.guide2 = 'hsla(' + h + ',60%,66%,0.26)';
    P.ship = '#eaf4ff';
    P.revCw = '#ffc857';
    P.revCwGlow = 'rgba(255,200,87,0.13)';
    P.revCcw = '#7c5cff';
    P.revCcwGlow = 'rgba(124,92,255,0.15)';
    P.phan = '#dbe6ff';
    P.phanGlow = 'rgba(219,230,255,0.13)';
    P.shut = [];
    P.shutGlow = [];
    for (var i = 0; i < SHUT_STEPS; i++) {
      var t = i / (SHUT_STEPS - 1);
      var hh = (h + 60) - ((h + 60) - 4) * t;           // slides toward red
      P.shut.push('hsl(' + (((hh % 360) + 360) % 360) + ',90%,' + (64 - 6 * t).toFixed(0) + '%)');
      P.shutGlow.push('hsla(' + (((hh % 360) + 360) % 360) + ',90%,62%,0.14)');
    }
    P.puCol = ['#7ee8ff', '#4ee1c1', '#ffc857'];
    P.puName = ['SLOW', 'SHIELD', 'x2'];
  }
  buildPalette(0);

  /* ------------------------------------------------------------------
     helpers
     ------------------------------------------------------------------ */
  function wrap(a) { a %= TAU; if (a < 0) a += TAU; return a; }
  function shortest(a, b) { var d = wrap(b - a); return d > PI ? d - TAU : d; }

  function diffT() { return U.clamp(S.score / 95, 0, 1); }

  function emit(x, y, n, col, spd, life, sz) {
    for (var i = 0; i < n; i++) {
      var p = parts[partHead];
      partHead = (partHead + 1) % MAX_PARTS;
      var a = Math.random() * TAU, s = spd * (0.35 + Math.random() * 0.85);
      p.on = true; p.x = x; p.y = y;
      p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.max = life * (0.6 + Math.random() * 0.7); p.life = p.max;
      p.sz = sz * (0.6 + Math.random() * 0.9); p.col = col;
    }
  }

  /* ------------------------------------------------------------------
     layout
     ------------------------------------------------------------------ */
  var TRAVEL = 1;
  eng.onResize = function (w, h) {
    cx = w / 2; cy = h / 2;
    var m = Math.min(w, h);
    SCALE = m / 390;
    R_SHIP = m * 0.26;
    THICK = U.clamp(m * 0.038, 9, 20);
    /* Spawn radius is a compromise: far enough that a ring is in flight for
       a readable beat, near enough that most of it is on screen from the
       moment it appears (a ring is fully visible once r <= w/2). */
    R_OUT = m * 0.62;
    TRAVEL = R_OUT - R_SHIP;
    FONT_ZONE = '800 ' + Math.round(19 * SCALE) + 'px system-ui,-apple-system,sans-serif';
    FONT_TUT = '800 ' + Math.round(15 * SCALE) + 'px system-ui,-apple-system,sans-serif';
    FONT_SUB = '600 ' + Math.round(12 * SCALE) + 'px system-ui,-apple-system,sans-serif';
    FONT_BIG = '800 ' + Math.round(22 * SCALE) + 'px system-ui,-apple-system,sans-serif';
    FONT_MID = '600 ' + Math.round(13 * SCALE) + 'px system-ui,-apple-system,sans-serif';
    coreGradR = -1;
  };
  var FONT_ZONE = '', FONT_TUT = '', FONT_SUB = '', FONT_BIG = '', FONT_MID = '';

  /* ------------------------------------------------------------------
     ring spawning
     ------------------------------------------------------------------ */
  function freeRing() {
    for (var i = 0; i < rings.length; i++) if (!rings[i].on) return rings[i];
    return null;
  }
  function liveCount() {
    var n = 0;
    for (var i = 0; i < rings.length; i++) if (rings[i].on) n++;
    return n;
  }
  /* the pending ring that will arrive LAST — the one that pins the ship
     just before the new ring lands */
  function lastPending(exclude) {
    var best = null;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (r === exclude) continue;
      if (r.on && !r.done && r.r > R_SHIP) { if (!best || r.r > best.r) best = r; }
    }
    return best;
  }
  function outermostR() {
    var m = -1;
    for (var i = 0; i < rings.length; i++) if (rings[i].on && rings[i].r > m) m = rings[i].r;
    return m;
  }

  function pickKind() {
    var sc = S.score;
    // weights, index-aligned with K_*
    var w0 = 10, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0;
    if (sc >= KIND_GATE[K_ROT]) { w1 = 9; w0 = 7; }
    if (sc >= KIND_GATE[K_TWIN]) { w2 = 7; w0 = 5; }
    if (sc >= KIND_GATE[K_SHUT]) { w3 = 6; w0 = 4; }
    if (sc >= KIND_GATE[K_REV]) { w4 = 6; w0 = 3; }
    if (sc >= KIND_GATE[K_PHAN]) { w5 = 5; w0 = 2; }
    var tot = w0 + w1 + w2 + w3 + w4 + w5, r = Math.random() * tot;
    if ((r -= w0) < 0) return K_BASIC;
    if ((r -= w1) < 0) return K_ROT;
    if ((r -= w2) < 0) return K_TWIN;
    if ((r -= w3) < 0) return K_SHUT;
    if ((r -= w4) < 0) return K_REV;
    return K_PHAN;
  }

  /* fill a ring's geometry; returns the ring */
  function configureRing(rg, kind, radius, pairIdx) {
    var d = diffT();
    var gapBase = U.lerp(1.28, 0.66, d);
    rg.on = true; rg.done = false; rg.r = radius; rg.spawnR = radius;
    rg.kind = kind; rg.pu = PU_NONE; rg.puGap = 0; rg.alpha = 1;
    rg.prog = 0; rg.pair = pairIdx || 0;

    var rot = U.lerp(0, 1.05, U.clamp((S.score - KIND_GATE[K_ROT]) / 60, 0, 1));

    if (kind === K_BASIC) {
      rg.n = 1; rg.w = 0; rg.dir = 1;
      rg.sz0[0] = rg.sz1[0] = gapBase * 1.05;
    } else if (kind === K_ROT) {
      rg.n = 1; rg.dir = Math.random() < 0.5 ? -1 : 1;
      rg.w = rot * rg.dir * U.rand(0.75, 1.15);
      rg.sz0[0] = rg.sz1[0] = gapBase;
    } else if (kind === K_TWIN) {
      rg.n = 2; rg.dir = Math.random() < 0.5 ? -1 : 1;
      rg.w = rot * rg.dir * U.rand(0.4, 0.85);
      rg.sz0[0] = rg.sz1[0] = gapBase * 0.82;
      rg.sz0[1] = rg.sz1[1] = gapBase * 0.82;
    } else if (kind === K_SHUT) {
      rg.n = 1; rg.dir = Math.random() < 0.5 ? -1 : 1;
      rg.w = rot * rg.dir * U.rand(0.25, 0.6);
      rg.sz0[0] = gapBase * 1.7;
      rg.sz1[0] = Math.max(0.40, gapBase * 0.80);
    } else if (kind === K_REV) {
      rg.n = 1; rg.dir = -S.lastDir;
      rg.w = rot * rg.dir * U.rand(0.95, 1.35);
      rg.sz0[0] = rg.sz1[0] = gapBase * 1.02;
    } else { /* K_PHAN */
      rg.n = 1; rg.dir = Math.random() < 0.5 ? -1 : 1;
      rg.w = rot * rg.dir * U.rand(0.3, 0.7);
      rg.sz0[0] = rg.sz1[0] = gapBase * 1.22;
    }
    if (rg.w !== 0) S.lastDir = rg.w > 0 ? 1 : -1;

    // gentle opening: the very first rings of a first run are kind
    if (S.tutorial && S.spawned < 4) {
      rg.n = 1; rg.w = 0; rg.kind = K_BASIC; rg.dir = 1;
      rg.sz0[0] = rg.sz1[0] = 1.55;
    }

    rg.sz[0] = rg.sz0[0]; rg.sz[1] = rg.sz0[1];

    // provisional gap placement — the very first ring of a first run opens
    // right where the player already is, so nobody dies before they learn
    var base = (S.tutorial && S.spawned === 0) ? S.shipA : Math.random() * TAU;
    rg.gs[0] = base - rg.sz0[0] * 0.5;
    if (rg.n === 2) rg.gs[1] = base + PI - rg.sz0[1] * 0.5;

    makeFair(rg);
    maybePowerup(rg);
    return rg;
  }

  /* Time (s) until a ring at radius r reaches the ship's orbit.
     Deliberately quoted at FULL speed even while SLOW is active: if the
     power-up expires mid-flight the ring speeds back up, and a promise made
     on the slowed timing would quietly become a lie. */
  function arriveT(r) {
    return Math.max(0.001, (r - R_SHIP) / S.speed);
  }

  var fairCfg = {                       // reused, never re-allocated
    t: 0, refA: 0, refV: 0, acc: SHIP_ACC, cap: SHIP_CAP,
    dash: DASH_ANG, dashTime: DASH_TIME, dashReady: true,
    shipHalf: SHIP_HALF, margin: FAIR_MARGIN,
    ringW: 0, n: 1, gs: [0, 0], sz: [0, 0]
  };

  /* Check the candidate ring against every place the ship could legally
     be when it arrives, and nudge its gaps if the answer is "nowhere".

     The binding constraint is not "where is the ship now" but "where will
     the ship be pinned by the ring that lands just before this one", so we
     chain off that ring's gaps whenever one is in flight. */
  function makeFair(rg) {
    var tArr = arriveT(rg.r);
    var prev = lastPending(rg);
    var refA, refV, tWin, rewind, dashReady, i;

    if (prev) {
      var tPrev = arriveT(prev.r);
      tWin = tArr - tPrev;
      if (tWin < 0.02) {                          // effectively simultaneous
        prev = null;
        refA = S.shipA; refV = S.shipV; tWin = tArr; rewind = 0;
        dashReady = S.dashCd <= 0;
      } else {
        refV = 0;                                 // pessimistic: assume stopped
        rewind = tPrev;
        dashReady = (S.dashCd - tPrev) <= 0;
        refA = prev.gs[0] + prev.sz1[0] * 0.5 + prev.w * tPrev;
      }
    } else {
      refA = S.shipA; refV = S.shipV; tWin = tArr; rewind = 0;
      dashReady = S.dashCd <= 0;
    }

    fairCfg.acc = SHIP_ACC; fairCfg.cap = SHIP_CAP;
    fairCfg.dash = DASH_ANG; fairCfg.dashTime = DASH_TIME;
    fairCfg.shipHalf = SHIP_HALF; fairCfg.margin = FAIR_MARGIN;
    fairCfg.ringW = rg.w; fairCfg.n = rg.n;
    fairCfg.t = tWin; fairCfg.refV = refV; fairCfg.dashReady = dashReady;
    /* gap starts are quoted at t=0; the window opens `rewind` seconds later */
    fairCfg.gs[0] = rg.gs[0] + rg.w * rewind;
    fairCfg.gs[1] = rg.gs[1] + rg.w * rewind;
    fairCfg.sz[0] = rg.sz1[0]; fairCfg.sz[1] = rg.sz1[1];   // size AT ARRIVAL

    var ok = false;
    if (prev) {
      for (i = 0; i < prev.n; i++) {
        fairCfg.refA = prev.gs[i] + prev.sz1[i] * 0.5 + prev.w * rewind;
        if (isFair(fairCfg)) { ok = true; break; }
      }
    } else {
      fairCfg.refA = refA;
      ok = isFair(fairCfg);
    }
    if (ok) return true;

    /* Unfair — relocate gap 0 to somewhere provably inside the ship's
       steering reach (no dash assumed, so the rescue is never a coin flip),
       but never dead-centre: keep a readable offset. */
    var reach = reachIn(tWin, refV, SHIP_ACC, SHIP_CAP) * 0.9;
    var half = Math.max(0, rg.sz1[0] * 0.5 - SHIP_HALF - FAIR_MARGIN);
    var maxOff = Math.min(0.55, half + reach * 0.7);
    var lo = Math.min(0.05, maxOff * 0.3);
    var off = (Math.random() < 0.5 ? -1 : 1) * U.rand(lo, maxOff);
    rg.gs[0] = refA + off - rg.w * tArr - rg.sz1[0] * 0.5;
    if (rg.n === 2) rg.gs[1] = rg.gs[0] + PI;
    return false;
  }

  function maybePowerup(rg) {
    if (S.score < 5) return;
    if (Math.random() > 0.085) return;
    var t = U.ri(0, 2);
    if (t === PU_SLOW && S.slowT > 0) return;
    if (t === PU_SHIELD && S.shield > 0) return;
    if (t === PU_X2 && S.x2 > 0) return;
    rg.pu = t; rg.puGap = U.ri(0, rg.n - 1);
  }

  function spawnWave() {
    if (liveCount() >= MAX_RINGS - 1) return;
    var kind = pickKind();
    var rg = freeRing(); if (!rg) return;
    configureRing(rg, kind, R_OUT, 0);
    S.spawned++;
    if (rg.kind === K_PHAN) Sound.tone(1500, 0.16, 'sine', 0.07, 520);

    /* double rings: a second one right on its heels with an offset gap.
       The offset is sized to sit just beyond pure steering reach in the
       0.3 s window between them, so a dash is the natural answer — and
       makeFair() will pull it back in if the dash is on cooldown. */
    if (S.score >= DOUBLE_GATE && Math.random() < 0.3) {
      var rg2 = freeRing();
      if (rg2) {
        configureRing(rg2, Math.random() < 0.5 ? K_BASIC : K_ROT,
                      R_OUT + Math.max(THICK * 2.4, S.speed * 0.30), 1);
        rg2.gs[0] = rg.gs[0] + (Math.random() < 0.5 ? 1 : -1) * U.rand(0.92, 1.25);
        rg2.pu = PU_NONE;
        makeFair(rg2);
        S.spawned++;
      }
    }
  }

  /* ------------------------------------------------------------------
     run control
     ------------------------------------------------------------------ */
  function resetRun() {
    for (var i = 0; i < rings.length; i++) rings[i].on = false;
    for (i = 0; i < parts.length; i++) parts[i].on = false;
    S.score = 0; S.zone = 0; S.zoneCard = 0;
    S.shipA = -PI / 2; S.shipV = 0; S.steer = 0; S.dragging = false;
    S.dashCd = 0; S.dashT = 0;
    S.slowT = 0; S.shield = 0; S.x2 = 0; S.invuln = 0.6;
    S.combo = 0; S.pitch = 0; S.shake = 0; S.sceneRot = 0;
    S.speed = TRAVEL * 0.335; S.spawned = 0; S.elapsed = 0;
    S.cause = ''; S.reviveUsed = false; reviveTries = 0; S.flash = 0; S.coreFlare = 0;
    S.tutFade = S.tutorial ? 1 : 0;
    buildPalette(0);
    syncHud(true);
  }

  var adsReady = false;
  async function firstGesture() {
    if (adsReady) return;
    adsReady = true;
    try { await Ads.init(); } catch (e) {}
  }
  /* settings taps are gestures too — use one to warm the ad stack up so the
     banner and the revive offer are ready by the first game over */
  function warmAds() { firstGesture(); }

  async function startRun() {
    await firstGesture();
    try { Ads.hideBanner(); } catch (e) {}
    resetRun();
    S.runs++; Store.set('runs', S.runs);
    S.mode = 'play'; S.paused = false;
    UI.hide();
    elHud.classList.add('on');
    eng.start();
  }

  function die(kind) {
    if (S.invuln > 0) return;
    if (S.shield > 0) {
      S.shield = 0;
      S.invuln = 0.85;
      S.combo = 0; S.pitch = 0;
      S.flash = 1; S.flashCol = P.puCol[PU_SHIELD];
      shake(9);
      Sound.tone(320, 0.22, 'square', 0.12, 780);
      Buzz(24);
      emitRing(P.puCol[PU_SHIELD], 26);
      syncHud(true);
      return;
    }
    S.cause = causeText(kind);
    S.mode = 'dying';
    S.dyingT = 0;
    S.shake = 1;
    S.flash = 1; S.flashCol = '#ff6b6b';
    Sound.bad();
    Buzz(60);
    emitRing('#ff6b6b', 46);
    var sx = cx + Math.cos(S.shipA) * R_SHIP, sy = cy + Math.sin(S.shipA) * R_SHIP;
    emit(sx, sy, 30, '#ffd6d6', 260 * SCALE, 0.9, 3.2 * SCALE);
  }

  function emitRing(col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      emit(cx + Math.cos(a) * R_SHIP, cy + Math.sin(a) * R_SHIP, 1, col, 150 * SCALE, 0.7, 2.4 * SCALE);
    }
  }

  function causeText(kind) {
    switch (kind) {
      case K_ROT:  return 'A rotating ring turned the gap away from you.';
      case K_TWIN: return 'You split the difference between two gaps.';
      case K_SHUT: return 'A shutter ring closed on you.';
      case K_REV:  return 'A reverse ring spun the other way.';
      case K_PHAN: return 'You died to a phantom ring.';
      default:     return 'You clipped a plain ring. It happens.';
    }
  }

  async function gameOver() {
    S.mode = 'over';
    elHud.classList.remove('on');
    var rec = Store.bump('best', S.score);
    if (rec) S.best = S.score;
    Store.set('taught', 1);
    S.tutorial = 0;
    elFScore.textContent = S.score;
    elFBest.textContent = S.best;
    elCause.textContent = S.cause;
    elRec.classList.toggle('on', !!rec);
    /* A revive bought with Playbox tokens works exactly like the ad one,
       minus the ad. */
    var freeRevive = PB.peekBoost('vortex_revive') > 0;
    var canRevive = !S.reviveUsed && S.score >= 4 && (freeRevive || Ads.isRewardedReady());
    elRevive.textContent = freeRevive ? 'Revive (1 token boost)' : 'Watch ad \u2192 revive';
    PB.report('run', { score: S.score, zone: S.zone, cause: S.cause,
                       continued: S.reviveUsed });
    elRevive.classList.toggle('on', canRevive);
    try { await Ads.maybeInterstitial(); } catch (e) {}
    if (S.mode !== 'over') return;                 // player already moved on
    UI.show('over');
    try { Ads.showBanner(); } catch (e) {}
    if (rec) Sound.great();
  }

  function toMenu() {
    S.mode = 'menu';
    elHud.classList.remove('on');
    elBest.textContent = S.best;
    elRuns.textContent = S.runs;
    UI.show('menu');
    try { Ads.showBanner(); } catch (e) {}
  }

  var reviveTries = 0;
  async function doRevive() {
    S.reviveUsed = true;
    elRevive.classList.remove('on');
    reviveTries++;
    /* A token boost buys the same revive with no ad. Spent only here, at the
       moment it actually revives. */
    var ok = PB.takeBoost('vortex_revive', 1) > 0;
    if (!ok) {
      try { ok = await Ads.showRewarded(); } catch (e) { ok = false; }
    }
    if (!ok) {
      /* the ad failed, not the player — don't burn their one offer for it */
      UI.toast('No ad available right now');
      if (reviveTries < 2 && Ads.isRewardedReady()) {
        S.reviveUsed = false;
        elRevive.classList.add('on');
      }
      return;
    }
    try { Ads.hideBanner(); } catch (e) {}
    for (var i = 0; i < rings.length; i++) rings[i].on = false;
    S.invuln = 1.8; S.shield = 1; S.shipV = 0; S.combo = 0; S.pitch = 0;
    S.mode = 'play'; S.paused = false;
    UI.hide(); elHud.classList.add('on');
    syncHud(true);
    Sound.great();
    eng.start();
  }

  /* ------------------------------------------------------------------
     input
     ------------------------------------------------------------------ */
  var touch = { down: false, x0: 0, y0: 0, t0: 0, side: 0, drag: false };
  var lastTapT = 0, lastTapSide = 0;

  function dash(dir) {
    if (S.dashCd > 0 || S.mode !== 'play' || S.paused) return;
    S.dashCd = DASH_CD;
    S.dashT = DASH_TIME;
    S.dashFrom = S.shipA;
    S.dashTo = S.shipA + DASH_ANG * dir;
    S.dashDir = dir;
    Sound.tone(880, 0.10, 'triangle', 0.10, 1500);
    Buzz(10);
    var sx = cx + Math.cos(S.shipA) * R_SHIP, sy = cy + Math.sin(S.shipA) * R_SHIP;
    emit(sx, sy, 8, P.core, 120 * SCALE, 0.35, 2.2 * SCALE);
  }

  Input(eng.canvas, {
    down: function (x, y) {
      if (S.mode !== 'play') return;
      if (S.paused) { S.paused = false; eng.start(); return; }
      var now = performance.now();
      var side = (x < eng.w * 0.5) ? -1 : 1;
      touch.down = true; touch.x0 = x; touch.y0 = y; touch.t0 = now;
      touch.side = side; touch.drag = false;
      S.steer = side;
      if (S.tutorial) { S.tutorial = 2; }
      if (now - lastTapT < DBLTAP_MS && lastTapSide === side) {
        dash(side);
        lastTapT = 0;
      } else {
        lastTapT = now; lastTapSide = side;
      }
    },
    move: function (x, y) {
      if (!touch.down || S.mode !== 'play') return;
      if (!touch.drag) {
        var dx = x - touch.x0, dy = y - touch.y0;
        if (dx * dx + dy * dy > DRAG_PX * DRAG_PX) { touch.drag = true; S.dragging = true; S.steer = 0; }
      }
      if (touch.drag) {
        S.dragA = Math.atan2(y - cy, x - cx) - S.sceneRot;
        if (S.tutorial) S.tutorial = 2;
      }
    },
    up: function () {
      /* only a short, stationary press counts toward a double-tap, so a
         drag or a long steer never accidentally arms a dash */
      if (touch.drag || performance.now() - touch.t0 > 260) lastTapT = 0;
      touch.down = false; touch.drag = false;
      S.steer = 0; S.dragging = false;
    }
  });

  /* keyboard, for desktop QA */
  global.addEventListener('keydown', function (e) {
    if (S.mode !== 'play') return;
    if (e.key === 'ArrowLeft')  { S.steer = -1; S.dragging = false; }
    if (e.key === 'ArrowRight') { S.steer = 1;  S.dragging = false; }
    if (e.key === ' ') dash(S.steer || 1);
  });
  global.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft' && S.steer === -1) S.steer = 0;
    if (e.key === 'ArrowRight' && S.steer === 1) S.steer = 0;
  });

  /* ------------------------------------------------------------------
     hud
     ------------------------------------------------------------------ */
  var hudT = 0, lastScoreShown = -1;
  function syncHud(force) {
    if (S.score !== lastScoreShown || force) {
      elScore.textContent = S.score;
      lastScoreShown = S.score;
    }
    var z = ZONES[S.zone % ZONES.length];
    if (elZoneName.textContent !== z[0]) {
      elZoneName.textContent = z[0];
      elZoneNo.textContent = 'Zone ' + (S.zone + 1);
    }
    elPuSlow.classList.toggle('on', S.slowT > 0);
    if (S.slowT > 0) elPuSlowT.textContent = S.slowT.toFixed(1) + 's';
    elPuShield.classList.toggle('on', S.shield > 0);
    elPuDbl.classList.toggle('on', S.x2 > 0);
    if (S.x2 > 0) elPuDblT.textContent = 'x2 ' + S.x2;
  }

  /* ------------------------------------------------------------------
     update
     ------------------------------------------------------------------ */
  function shake(v) { if (!S.reduceMotion) S.shake = Math.max(S.shake, v / 14); }

  eng.onUpdate = function (dt) {
    if (S.paused) return;
    if (S.mode === 'over' || S.mode === 'menu') { updateParts(dt); return; }

    if (S.mode === 'dying') {
      S.dyingT += dt;
      updateParts(dt);
      S.shake = Math.max(0, S.shake - dt * 2.2);
      S.flash = Math.max(0, S.flash - dt * 3.2);
      for (var q = 0; q < rings.length; q++) {
        var rr = rings[q];
        if (rr.on) { rr.r -= S.speed * 0.25 * dt; if (rr.r < 4) rr.on = false; }
      }
      if (S.dyingT > 0.85) { S.mode = 'over'; gameOver(); }
      return;
    }

    S.elapsed += dt;
    var d = diffT();
    /* speed as a fraction of the flight path per second: a ring takes ~3.0 s
       to arrive at the start and ~1.05 s at full tilt, on any screen size */
    S.speed = TRAVEL * (U.lerp(0.335, 0.95, d) + Math.max(0, S.score - 95) * 0.0035);
    if (S.tutorial && S.spawned < 4) S.speed *= 0.72;

    /* --- powerup timers --- */
    if (S.slowT > 0) S.slowT = Math.max(0, S.slowT - dt);
    if (S.invuln > 0) S.invuln = Math.max(0, S.invuln - dt);
    if (S.dashCd > 0) S.dashCd = Math.max(0, S.dashCd - dt);

    /* --- ship --- */
    if (S.dashT > 0) {
      S.dashT = Math.max(0, S.dashT - dt);
      var k = 1 - S.dashT / DASH_TIME;
      k = k * k * (3 - 2 * k);
      S.shipA = S.dashFrom + (S.dashTo - S.dashFrom) * k;
      if (S.dashT === 0) S.shipA = S.dashTo;
    } else if (S.dragging) {
      var del = shortest(S.shipA, S.dragA);
      var step = del * (1 - Math.exp(-22 * dt));
      var maxStep = SHIP_CAP * 1.45 * dt;
      if (step > maxStep) step = maxStep; else if (step < -maxStep) step = -maxStep;
      S.shipA += step;
      S.shipV = step / Math.max(dt, 0.0001);
    } else {
      if (S.steer !== 0) {
        S.shipV += SHIP_ACC * S.steer * dt;
        if (S.shipV > SHIP_CAP) S.shipV = SHIP_CAP;
        if (S.shipV < -SHIP_CAP) S.shipV = -SHIP_CAP;
      } else {
        var dec = SHIP_DEC * dt;
        if (S.shipV > dec) S.shipV -= dec;
        else if (S.shipV < -dec) S.shipV += dec;
        else S.shipV = 0;
      }
      S.shipA += S.shipV * dt;
    }
    S.shipA = wrap(S.shipA);

    /* --- scene vertigo --- */
    if (!S.reduceMotion) {
      var target = -U.clamp(S.shipV / SHIP_CAP, -1, 1) * 0.075;   // <= 4.3 deg/s
      S.sceneRot += target * dt;
    }

    /* --- tutorial fade --- */
    if (S.tutorial === 2) {
      S.tutFade = Math.max(0, S.tutFade - dt * 1.6);
      if (S.tutFade === 0) S.tutorial = 0;
    }

    /* --- spawn --- */
    var spacing = TRAVEL * U.lerp(0.74, 0.46, d);
    if (S.tutorial && S.spawned < 4) spacing = TRAVEL * 1.05;
    var om = outermostR();
    if (om < R_OUT - spacing || om < 0) spawnWave();

    /* --- rings --- */
    var sp = S.speed * (S.slowT > 0 ? 0.5 : 1);
    var span = R_OUT - R_SHIP;
    for (var i = 0; i < rings.length; i++) {
      var rg = rings[i];
      if (!rg.on) continue;
      var prevR = rg.r;
      rg.r -= sp * dt;
      rg.gs[0] += rg.w * dt;
      if (rg.n === 2) rg.gs[1] += rg.w * dt;
      rg.prog = U.clamp((rg.spawnR - rg.r) / Math.max(1, rg.spawnR - R_SHIP), 0, 1);

      if (rg.kind === K_SHUT) {
        var t2 = rg.prog * rg.prog;
        rg.sz[0] = U.lerp(rg.sz0[0], rg.sz1[0], t2);
      } else {
        rg.sz[0] = rg.sz0[0]; rg.sz[1] = rg.sz0[1];
      }
      if (rg.kind === K_PHAN) {
        rg.alpha = U.clamp((rg.prog - 0.48) / 0.22, 0, 1);
      } else {
        rg.alpha = U.clamp(rg.prog / 0.10, 0, 1);   // materialise out of the dark
      }

      if (!rg.done && prevR > R_SHIP && rg.r <= R_SHIP) {
        resolveRing(rg);
      }
      if (rg.r <= 6) {
        rg.on = false;
        S.coreFlare = Math.min(1, S.coreFlare + 0.5);
      }
    }

    updateParts(dt);
    S.shake = Math.max(0, S.shake - dt * 2.6);
    S.flash = Math.max(0, S.flash - dt * 3.4);
    S.coreFlare = Math.max(0, S.coreFlare - dt * 2.2);
    if (S.zoneCard > 0) S.zoneCard = Math.max(0, S.zoneCard - dt);

    hudT += dt;
    if (hudT > 0.1) { hudT = 0; syncHud(false); }
  };

  function updateParts(dt) {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.955; p.vy *= 0.955;
    }
  }

  function resolveRing(rg) {
    rg.done = true;
    var hit = -1, bestOff = 9;
    for (var i = 0; i < rg.n; i++) {
      var half = rg.sz[i] * 0.5;
      var centre = rg.gs[i] + half;
      var off = Math.abs(shortest(centre, S.shipA));
      if (off <= half - SHIP_HALF) {
        if (off < bestOff) { bestOff = off; hit = i; }
      }
    }
    if (hit < 0) { die(rg.kind); return; }

    /* passed */
    var gained = S.x2 > 0 ? 2 : 1;
    S.score += gained;
    if (S.x2 > 0) S.x2--;
    S.combo++;

    var half2 = rg.sz[hit] * 0.5 - SHIP_HALF;
    var closeness = half2 > 0 ? bestOff / half2 : 1;
    if (closeness > 0.72) {
      S.pitch = 0;                              // close call resets the run of pitch
      Sound.tone(300, 0.09, 'sawtooth', 0.07, 220);
      shake(5);
    } else {
      S.pitch = Math.min(S.pitch + 1, 22);
      var base = 380;
      if (rg.kind === K_ROT) base = 420;
      else if (rg.kind === K_TWIN) base = 466;
      else if (rg.kind === K_SHUT) base = 350;
      else if (rg.kind === K_REV) base = 494;
      else if (rg.kind === K_PHAN) base = 588;
      var f = base * Math.pow(2, S.pitch / 12);
      Sound.tone(Math.min(f, 2600), 0.09, rg.kind === K_PHAN ? 'sine' : 'triangle', 0.10);
    }
    S.flash = Math.max(S.flash, 0.45);
    S.flashCol = ringColour(rg, true);
    Buzz(8);

    var sx = cx + Math.cos(S.shipA) * R_SHIP, sy = cy + Math.sin(S.shipA) * R_SHIP;
    emit(sx, sy, 9, ringColour(rg, false), 150 * SCALE, 0.45, 2.4 * SCALE);

    if (rg.pu !== PU_NONE && rg.puGap === hit) {
      grantPowerup(rg.pu, sx, sy);
      rg.pu = PU_NONE;
    }

    var z = Math.floor(S.score / 25);
    if (z !== S.zone) {
      S.zone = z;
      buildPalette(S.zone);
      S.zoneCard = 2.1;
      S.zoneCardName = 'ZONE ' + (S.zone + 1) + ' · ' + ZONES[S.zone % ZONES.length][0];
      Sound.tone(660, 0.20, 'sine', 0.10, 1320);
    }
    syncHud(false);
  }

  function grantPowerup(t, x, y) {
    if (t === PU_SLOW) { S.slowT = 2.5; }
    else if (t === PU_SHIELD) { S.shield = 1; }
    else { S.x2 = 10; }
    Sound.good();
    Buzz(18);
    emit(x, y, 16, P.puCol[t], 200 * SCALE, 0.6, 3 * SCALE);
    UI.toast(P.puName[t] + (t === PU_X2 ? ' · 10 rings' : ''), 900);
    syncHud(true);
  }

  /* ------------------------------------------------------------------
     render
     ------------------------------------------------------------------ */
  function ringColour(rg, glow) {
    switch (rg.kind) {
      case K_ROT:  return glow ? P.rotGlow : P.rot;
      case K_TWIN: return glow ? P.twinGlow : P.twin;
      case K_SHUT:
        var i = Math.min(SHUT_STEPS - 1, Math.floor(rg.prog * SHUT_STEPS));
        return glow ? P.shutGlow[i] : P.shut[i];
      case K_REV:  return rg.w >= 0 ? (glow ? P.revCwGlow : P.revCw) : (glow ? P.revCcwGlow : P.revCcw);
      case K_PHAN: return glow ? P.phanGlow : P.phan;
      default:     return glow ? P.baseGlow : P.base;
    }
  }

  function arcSeg(ctx, r, a0, a1, thick) {
    var sweep = a1 - a0;
    if (sweep <= 0.001) return;
    var cap = (thick * 0.5) / r;
    if (sweep > cap * 2.2) { a0 += cap; a1 -= cap; ctx.lineCap = 'round'; }
    else ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.stroke();
  }

  function drawRing(ctx, rg) {
    var r = rg.r;
    if (r < 8) return;
    var a = rg.alpha;
    var thick = THICK * (rg.pair ? 0.82 : 1);
    if (r < R_SHIP) {                       // being swallowed by the core
      var k = U.clamp(r / (R_SHIP * 0.92), 0, 1);
      a *= k * k;
      thick *= 0.45 + 0.55 * k;
    }
    if (a <= 0.004) return;
    var col = ringColour(rg, false), glow = ringColour(rg, true);

    // solid segments = complement of the gaps
    var s0 = rg.gs[0], z0 = rg.sz[0];
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = glow;
    ctx.lineWidth = thick * 2.1;
    if (rg.n === 1) {
      arcSeg(ctx, r, s0 + z0, s0 + TAU, thick * 2.1);
    } else {
      var s1 = rg.gs[1], z1 = rg.sz[1];
      var d1 = wrap(s1 - (s0 + z0));
      arcSeg(ctx, r, s0 + z0, s0 + z0 + d1, thick * 2.1);
      var d2 = wrap(s0 - (s1 + z1));
      arcSeg(ctx, r, s1 + z1, s1 + z1 + d2, thick * 2.1);
    }
    ctx.globalAlpha = a;
    ctx.strokeStyle = col;
    ctx.lineWidth = thick;
    if (rg.n === 1) {
      arcSeg(ctx, r, s0 + z0, s0 + TAU, thick);
    } else {
      var e1 = rg.gs[1], y1 = rg.sz[1];
      var q1 = wrap(e1 - (s0 + z0));
      arcSeg(ctx, r, s0 + z0, s0 + z0 + q1, thick);
      var q2 = wrap(s0 - (e1 + y1));
      arcSeg(ctx, r, e1 + y1, e1 + y1 + q2, thick);
    }

    // rotation tell: a short tick riding the leading gap edge
    if (rg.w !== 0 && a > 0.5) {
      var lead = rg.w > 0 ? (s0 + z0) : s0;
      ctx.globalAlpha = a * 0.85;
      ctx.lineWidth = thick * 0.34;
      ctx.lineCap = 'round';
      var tick = 0.16 * (rg.w > 0 ? 1 : -1);
      ctx.beginPath();
      ctx.arc(0, 0, r + thick * 0.85, lead, lead + tick, tick < 0);
      ctx.stroke();
    }

    // powerup orb sitting in its gap
    if (rg.pu !== PU_NONE) {
      var ga = rg.gs[rg.puGap] + rg.sz[rg.puGap] * 0.5;
      var px = Math.cos(ga) * r, py = Math.sin(ga) * r;
      ctx.globalAlpha = a;
      ctx.fillStyle = P.puCol[rg.pu];
      ctx.beginPath();
      ctx.arc(px, py, thick * 0.42, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = a * 0.28;
      ctx.beginPath();
      ctx.arc(px, py, thick * 0.85, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  var coreGrad = null, coreGradR = -1, coreGradH = -1;
  function core(ctx, t) {
    var pulse = 1 + Math.sin(t * 3.1) * 0.06 + S.coreFlare * 0.35;
    var rr = R_SHIP * 0.30 * pulse;
    var q = Math.round(rr);
    if (coreGradR !== q || coreGradH !== P.h) {
      coreGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, Math.max(2, rr * 2.6));
      coreGrad.addColorStop(0, P.core);
      coreGrad.addColorStop(0.35, P.coreDim);
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      coreGradR = q; coreGradH = P.h;
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.arc(0, 0, rr * 2.6, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 26; ctx.shadowColor = P.core;
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.44, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function ship(ctx, t) {
    var a = S.shipA;
    var x = Math.cos(a) * R_SHIP, y = Math.sin(a) * R_SHIP;
    var s = R_SHIP * 0.085;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);

    // dash cooldown ring
    var cd = S.dashCd / DASH_CD;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = P.core;
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(0, 0, s * 2.1, 0, TAU); ctx.stroke();
    if (cd > 0) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, s * 2.1, -PI / 2, -PI / 2 + TAU * (1 - cd)); ctx.stroke();
    } else {
      ctx.globalAlpha = 0.55 + Math.sin(t * 6) * 0.18;
      ctx.strokeStyle = P.core;
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, 0, s * 2.1, 0, TAU); ctx.stroke();
    }

    ctx.globalAlpha = 1;
    if (S.invuln > 0 && Math.floor(S.invuln * 12) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.fillStyle = S.shield > 0 ? P.puCol[PU_SHIELD] : P.ship;
    ctx.shadowBlur = 16; ctx.shadowColor = S.shield > 0 ? P.puCol[PU_SHIELD] : P.core;
    ctx.beginPath();
    ctx.moveTo(s * 1.25, 0);
    ctx.lineTo(-s * 0.75, -s * 0.92);
    ctx.lineTo(-s * 0.30, 0);
    ctx.lineTo(-s * 0.75, s * 0.92);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    if (S.shield > 0) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = P.puCol[PU_SHIELD];
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(0, 0, s * 1.6, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  eng.onRender = function (ctx, w, h, t) {
    ctx.fillStyle = '#080b14';
    ctx.fillRect(0, 0, w, h);

    // faint zone wash
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    ctx.save();
    var sh = S.shake;
    if (sh > 0 && !S.reduceMotion) {
      ctx.translate(cx + (Math.random() - 0.5) * 16 * sh, cy + (Math.random() - 0.5) * 16 * sh);
    } else {
      ctx.translate(cx, cy);
    }
    ctx.rotate(S.sceneRot);

    // guide circles
    ctx.lineWidth = 1;
    for (var g = 1; g <= 5; g++) {
      ctx.strokeStyle = P.guide;
      ctx.beginPath(); ctx.arc(0, 0, R_SHIP * 0.42 + (R_OUT - R_SHIP * 0.42) * (g / 5), 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = P.guide2;
    ctx.setLineDash(DASHPAT);
    ctx.beginPath(); ctx.arc(0, 0, R_SHIP, 0, TAU); ctx.stroke();
    ctx.setLineDash(EMPTYPAT);

    // rings, outer first
    for (var i = 0; i < rings.length; i++) if (rings[i].on) drawRing(ctx, rings[i]);

    core(ctx, t);
    if (S.mode === 'play' || S.mode === 'dying') ship(ctx, t);

    ctx.restore();

    // particles (screen space)
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p.on) continue;
      ctx.globalAlpha = U.clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.sz * 0.5, p.y - p.sz * 0.5, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;

    // pass flash
    if (S.flash > 0.01) {
      ctx.globalAlpha = S.flash * 0.16;
      ctx.fillStyle = S.flashCol;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    overlays(ctx, w, h);
  };

  var DASHPAT = [3, 9], EMPTYPAT = [];

  function overlays(ctx, w, h) {
    ctx.textAlign = 'center';

    if (S.zoneCard > 0) {
      var k = S.zoneCard > 1.7 ? (2.1 - S.zoneCard) / 0.4 : Math.min(1, S.zoneCard / 0.6);
      ctx.globalAlpha = U.clamp(k, 0, 1);
      ctx.fillStyle = P.core;
      ctx.font = FONT_ZONE;
      ctx.fillText(S.zoneCardName, w * 0.5, h * 0.22);
      ctx.globalAlpha = U.clamp(k, 0, 1) * 0.5;
      ctx.fillRect(w * 0.5 - 46 * SCALE, h * 0.22 + 10 * SCALE, 92 * SCALE, 2);
      ctx.globalAlpha = 1;
    }

    if (S.mode === 'play' && S.tutorial && S.tutFade > 0) {
      ctx.globalAlpha = S.tutFade * 0.85;
      ctx.fillStyle = '#e8edf7';
      ctx.font = FONT_TUT;
      ctx.fillText('HOLD  LEFT', w * 0.24, h - 46 * SCALE);
      ctx.fillText('HOLD  RIGHT', w * 0.76, h - 46 * SCALE);
      ctx.globalAlpha = S.tutFade * 0.35;
      ctx.fillRect(w * 0.5 - 0.5, h - 78 * SCALE, 1, 46 * SCALE);
      ctx.font = FONT_SUB;
      ctx.fillStyle = '#8b98b4';
      ctx.globalAlpha = S.tutFade * 0.8;
      ctx.fillText('steer into the gap', w * 0.5, h - 22 * SCALE);
      ctx.globalAlpha = 1;
    }

    if (S.paused && S.mode === 'play') {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#080b14';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8edf7';
      ctx.font = FONT_BIG;
      ctx.fillText('PAUSED', w * 0.5, h * 0.48);
      ctx.font = FONT_MID;
      ctx.fillStyle = '#8b98b4';
      ctx.fillText('tap to resume', w * 0.5, h * 0.48 + 26 * SCALE);
    }
  }

  /* ------------------------------------------------------------------
     menus / settings
     ------------------------------------------------------------------ */
  function labelSettings() {
    elMute.textContent = 'Sound: ' + (Sound.muted ? 'off' : 'on');
    elMotion.textContent = 'Motion: ' + (S.reduceMotion ? 'reduced' : 'full');
  }

  $('play').addEventListener('click', function () { startRun(); });
  $('retry').addEventListener('click', function () { startRun(); });
  $('home').addEventListener('click', function () { toMenu(); });
  elRevive.addEventListener('click', function () { doRevive(); });
  elMute.addEventListener('click', function () {
    warmAds();
    Sound.toggle(); labelSettings();
    if (!Sound.muted) Sound.tap();
  });
  elMotion.addEventListener('click', function () {
    S.reduceMotion = !S.reduceMotion;
    Store.set('reduce', S.reduceMotion);
    if (S.reduceMotion) { S.shake = 0; S.sceneRot = 0; }
    labelSettings();
  });
  if (Ads.isNative()) {
    elPrivacy.classList.add('on');
    elPrivacy.addEventListener('click', function () { Ads.showPrivacyOptions(); });
  }

  global.Game = {
    onBackground: function () {
      if (S.mode === 'play') { S.paused = true; S.steer = 0; S.dragging = false; }
    }
  };

  /* ------------------------------------------------------------------
     boot
     ------------------------------------------------------------------ */
  labelSettings();
  elBest.textContent = S.best;
  elRuns.textContent = S.runs;
  UI.show('menu');
  eng.start();

  // menu attract loop: a few slow rings drifting inward
  (function attract() {
    setInterval(function () {
      if (S.mode !== 'menu' && S.mode !== 'over') return;
      if (liveCount() > 4) return;
      var rg = freeRing(); if (!rg) return;
      rg.on = true; rg.done = true; rg.r = R_OUT; rg.spawnR = R_OUT;
      rg.kind = K_BASIC; rg.n = 1; rg.w = U.rand(-0.2, 0.2);
      rg.gs[0] = Math.random() * TAU;
      rg.sz0[0] = rg.sz1[0] = rg.sz[0] = U.rand(0.9, 1.6);
      rg.pu = PU_NONE; rg.alpha = 1; rg.prog = 0; rg.pair = 0;
    }, 900);
    // drift them in from the render loop's sibling: a tiny menu updater
    setInterval(function () {
      if (S.mode !== 'menu' && S.mode !== 'over') return;
      for (var i = 0; i < rings.length; i++) {
        var rg = rings[i];
        if (!rg.on) continue;
        rg.r -= TRAVEL * 0.012;
        rg.gs[0] += rg.w * 0.033;
        rg.prog = U.clamp((rg.spawnR - rg.r) / Math.max(1, rg.spawnR - R_SHIP), 0, 1);
        if (rg.r <= 6) rg.on = false;
      }
    }, 33);
  })();

  /* No banner before Ads.init(), and init needs a real user gesture (consent
     + autoplay). So the first menu is clean and the banner joins from the
     first return to the menu / game-over onward. */

  /* QA hooks — pure reads, no effect on play */
  global.__vortex = {
    isFair: isFair, reachIn: reachIn,
    state: S, rings: rings,
    geom: function () { return { cx: cx, cy: cy, rShip: R_SHIP, rOut: R_OUT }; }
  };

})(window);
