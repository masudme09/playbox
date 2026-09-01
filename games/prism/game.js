/* ============================================================
   PRISM — split the light, feed the crystals.
   Colour is three bits: R=1 G=2 B=4, white=7.
   Prisms split it, filters AND it, combiners OR it.
   ============================================================ */
(function () {
  'use strict';

/*<PRISM_SIM>*/
  /* ---- direction 0=N 1=E 2=S 3=W ---- */
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  /* mirror reflection tables: rot0 = "/", rot1 = "\" */
  var REFL = [[1, 0, 3, 2], [3, 2, 1, 0]];
  var COLCH = { r: 1, g: 2, y: 3, b: 4, m: 5, c: 6, w: 7 };
  var T_EMPTY = 0, T_WALL = 1, T_EMIT = 2, T_MIRROR = 3, T_SPLIT = 4,
      T_FILTER = 5, T_COMB = 6, T_CRYS = 7, T_PORT = 8;
  var SIM_CAP = 4000;               /* hard cap on cell re-evaluations */

  /* Two characters per cell:
       ..  empty          ##  wall
       E0-E3 emitter (direction it fires)
       M0/M1 mirror  ( / and \ ),  m0/m1 the same but locked
       P0-P3 prism   (white travelling that way splits), p# locked
       C0-C3 combiner (face it fires from),              c# locked
       F<c>  filter,  X<c> crystal   c in r g y b m c w
       O1/O2, O3/O4  portal pairs                                     */
  function parseLevel(rows) {
    var h = rows.length, w = (rows[0].length / 2) | 0;
    var cells = new Array(w * h), byPid = {};
    for (var r = 0; r < h; r++) {
      for (var c = 0; c < w; c++) {
        var a = rows[r].charAt(c * 2), b = rows[r].charAt(c * 2 + 1);
        var i = r * w + c;
        var cell = { t: T_EMPTY, rot: 0, col: 0, lock: true, states: 1,
                     r: r, c: c, i: i, partner: -1, pid: 0, vs: 0, va: 0, at: 1, dir: 1, sat: false };
        if (a === '#') cell.t = T_WALL;
        else if (a === 'E') { cell.t = T_EMIT; cell.rot = (+b) & 3; }
        else if (a === 'M' || a === 'm') { cell.t = T_MIRROR; cell.rot = (+b) % 2; cell.states = 2; cell.lock = (a === 'm'); }
        else if (a === 'P' || a === 'p') { cell.t = T_SPLIT; cell.rot = (+b) & 3; cell.states = 4; cell.lock = (a === 'p'); }
        else if (a === 'C' || a === 'c') { cell.t = T_COMB; cell.rot = (+b) & 3; cell.states = 4; cell.lock = (a === 'c'); }
        else if (a === 'F') { cell.t = T_FILTER; cell.col = COLCH[b] || 7; }
        else if (a === 'X') { cell.t = T_CRYS; cell.col = COLCH[b] || 7; }
        else if (a === 'O') { cell.t = T_PORT; cell.pid = +b; }
        cell.vs = cell.rot; cell.va = cell.rot;
        cells[i] = cell;
        if (cell.t === T_PORT) { (byPid[cell.pid] = byPid[cell.pid] || []).push(i); }
      }
    }
    var pairs = [[1, 2], [3, 4]];
    for (var k = 0; k < pairs.length; k++) {
      var A = byPid[pairs[k][0]], B = byPid[pairs[k][1]];
      if (A && B) { cells[A[0]].partner = B[0]; cells[B[0]].partner = A[0]; }
    }
    var S = { w: w, h: h, n: w * h, cells: cells, crystals: [], movers: [] };
    for (var q = 0; q < cells.length; q++) {
      if (cells[q].t === T_CRYS) S.crystals.push(q);
      if (cells[q].states > 1 && !cells[q].lock) S.movers.push(q);
    }
    S.inc = new Uint8Array(S.n * 4);
    S.out = new Uint8Array(S.n * 4);
    S.inq = new Uint8Array(S.n);
    return S;
  }

  var _o = [0, 0, 0, 0];

  /* what leaves cell i, given what currently enters every cell */
  function cellOut(S, inc, i, o) {
    o[0] = o[1] = o[2] = o[3] = 0;
    var cl = S.cells[i], d, m, r, base = i * 4;
    switch (cl.t) {
      case T_EMPTY:
        for (d = 0; d < 4; d++) o[d] = inc[base + d];
        break;
      case T_EMIT:
        o[cl.rot] = 7;
        break;
      case T_MIRROR: {
        var tb = REFL[cl.rot];
        for (d = 0; d < 4; d++) { m = inc[base + d]; if (m) o[tb[d]] |= m; }
        break;
      }
      case T_SPLIT:
        r = cl.rot;
        for (d = 0; d < 4; d++) {
          m = inc[base + d]; if (!m) continue;
          if (d === r && m === 7) { o[r] |= 1; o[(r + 1) & 3] |= 2; o[(r + 3) & 3] |= 4; }
          else o[d] |= m;                       /* coloured light just passes */
        }
        break;
      case T_FILTER:
        for (d = 0; d < 4; d++) o[d] = inc[base + d] & cl.col;
        break;
      case T_COMB: {
        r = cl.rot; var back = (r + 2) & 3, acc = 0;
        for (d = 0; d < 4; d++) if (d !== back) acc |= inc[base + d];
        o[r] = acc;
        break;
      }
      case T_PORT: {
        var p = cl.partner;
        if (p >= 0) { var pb = p * 4; for (d = 0; d < 4; d++) o[d] = inc[pb + d]; }
        break;
      }
      default: break;                            /* wall + crystal swallow light */
    }
  }

  /* Whole-board relaxation. Every edge has exactly one source, so this
     settles; the cap only exists to make loops provably safe.        */
  function simulate(S) {
    var w = S.w, h = S.h, n = S.n, inc = S.inc, out = S.out, inq = S.inq;
    inc.fill(0); out.fill(0); inq.fill(1);
    var q = new Array(n), head = 0, tail = n, i;
    for (i = 0; i < n; i++) q[i] = i;
    var steps = 0;
    while (head < tail && steps < SIM_CAP) {
      i = q[head++]; inq[i] = 0; steps++;
      cellOut(S, inc, i, _o);
      for (var d = 0; d < 4; d++) {
        var v = _o[d], b = i * 4 + d;
        if (v === out[b]) continue;
        out[b] = v;
        var nc = (i % w) + DX[d], nr = ((i / w) | 0) + DY[d];
        if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
        var j = nr * w + nc;
        if (inc[j * 4 + d] === v) continue;
        inc[j * 4 + d] = v;
        if (!inq[j]) { inq[j] = 1; q[tail++] = j; }
        var p = S.cells[j].partner;               /* portals read a far cell's input */
        if (p >= 0 && !inq[p]) { inq[p] = 1; q[tail++] = p; }
      }
    }
    S.steps = steps;
    return S;
  }

  function evaluate(S) {
    simulate(S);
    var all = S.crystals.length > 0, k, d;
    for (k = 0; k < S.crystals.length; k++) {
      var i = S.crystals[k], m = 0, b = i * 4;
      for (d = 0; d < 4; d++) m |= S.inc[b + d];
      var ok = (m === S.cells[i].col);
      S.cells[i].sat = ok;
      if (!ok) all = false;
    }
    S.solved = all;
    return S;
  }

  function stateOf(S) {
    var s = '';
    for (var k = 0; k < S.movers.length; k++) s += S.cells[S.movers[k]].rot;
    return s;
  }
  function setState(S, str) {
    for (var k = 0; k < S.movers.length; k++) S.cells[S.movers[k]].rot = +str.charAt(k);
  }

  /* Breadth-first over every reachable rotation combination. One tap
     advances one piece by one step, so BFS depth == minimum taps.    */
  function solveLevel(rows, cap) {
    var S = parseLevel(rows);
    cap = cap || 500000;
    var start = stateOf(S);
    var dist = Object.create(null);
    dist[start] = 0;
    var q = [start], head = 0, nodes = 0;
    while (head < q.length && nodes < cap) {
      var cur = q[head++]; nodes++;
      setState(S, cur);
      evaluate(S);
      if (S.solved) return { par: dist[cur], sol: cur, start: start, nodes: nodes, states: q.length };
      var d0 = dist[cur];
      for (var k = 0; k < S.movers.length; k++) {
        var nv = ((+cur.charAt(k)) + 1) % S.cells[S.movers[k]].states;
        var nx = cur.substring(0, k) + nv + cur.substring(k + 1);
        if (dist[nx] === undefined) { dist[nx] = d0 + 1; q.push(nx); }
      }
    }
    return { par: -1, sol: null, start: start, nodes: nodes, states: q.length };
  }
/*</PRISM_SIM>*/

/*<PRISM_LEVELS>*/
  var LEVELS = [
    /* 1 */ { par: 1, sol: '0', grid: ['..........','..........','M1......Xw','..........','..........','..........','E0........'] },
    /* 2 */ { par: 2, sol: '10', grid: ['....E2....','........Xw','..........','..........','....M0..M1','..........','..........'] },
    /* 3 */ { par: 2, sol: '110', grid: ['..Xw......','..........','..........','..M0....M0','..........','..........','E1......M0'] },
    /* 4 */ { par: 3, sol: '110', grid: ['..........','........Xw','..........','E1M0##....','..........','..M0....M1','..........'] },
    /* 5 */ { par: 3, sol: '100', grid: ['......E2..','..........','E1......M0','..........','Xw....M1..','..Xw....M1','..........'] },
    /* 6 */ { par: 4, sol: '0111', grid: ['..........','..M1....M0','..........','E1..M0....','..M0..Xw..','..........','....Xw..E0'] },
    /* 7 */ { par: 1, sol: '1', grid: ['..........','....Xb....','..........','E1..P0..Xr','..........','....Xg....','..........'] },
    /* 8 */ { par: 2, sol: '10', grid: ['....Xr....','Xb......Xg','..........','..........','M0..p0..M1','..........','....E0....'] },
    /* 9 */ { par: 3, sol: '02', grid: ['....E2....','..........','M0..P3..Xb','..........','..........','Xg........','....Xr....'] },
    /* 10 */ { par: 3, sol: '000', grid: ['....Xr....','..........','..........','M0..P1..Xg','..........','Xb........','E1..M0....'] },
    /* 11 */ { par: 4, sol: '121', grid: ['..Xg..E2....','............','............','..M0..P0..M0','............','............','..........Xb','......Xr....'] },
    /* 12 */ { par: 3, sol: '101', grid: ['............','............','Xb..M0......','............','M1..p1..M0..','............','............','E0..Xg..Xr..'] },
    /* 13 */ { par: 5, sol: '000', grid: ['....Xr......','..........Xg','............','............','M1..P1....M1','............','............','Xb..E0......'] },
    /* 14 */ { par: 6, sol: '10100', grid: ['..........Xg','............','Xr....M0....','M0......Xb..','............','M0....P1..M1','............','......E0....'] },
    /* 15 */ { par: 1, sol: '0', grid: ['..........','..........','..........','..........','M1..Fr..Xr','..........','E0........'] },
    /* 16 */ { par: 2, sol: '00', grid: ['......E2..','..........','XcFc..M1..','..........','..M1..FyXy','..........','..E0......'] },
    /* 17 */ { par: 3, sol: '101', grid: ['Xb..Xr....Xm','............','..........Fm','............','M0..P2..M1..','............','............','....E0..XgE0'] },
    /* 18 */ { par: 4, sol: '10', grid: ['....Xb......','............','............','....Fb....Xr','............','E1..P2....M1','............','....Xg......'] },
    /* 19 */ { par: 4, sol: '1001', grid: ['..Xm......E2','............','..M0..Fm..M1','............','M1..Fy..M0..','............','............','E0......Xy..'] },
    /* 20 */ { par: 5, sol: '101', grid: ['............','............','Xr..M0......','............','E1FrP1M0....','............','............','....E0Xy....'] },
    /* 21 */ { par: 5, sol: '011', grid: ['......Xb......','..............','..##..Fc......','..............','..M1..P2Fr..M0','..............','......Fy..##Xr','..............','..E0..Xg......'] },
    /* 22 */ { par: 6, sol: '1121', grid: ['E1....M0......','..............','Xg......##....','..............','M0....P3..FcM0','..............','..##..Fr......','............Xb','......Xr......'] },
    /* 23 */ { par: 1, sol: '1', grid: ['....E2....','....Fr....','..........','E1FgC0..Xy','..........','..........','..........'] },
    /* 24 */ { par: 4, sol: '00110', grid: ['....Xw......','............','M0..C1..M0..','............','............','M1..p0..M0..','............','....E0......'] },
    /* 25 */ { par: 4, sol: '000', grid: ['........Xy..','............','............','....M0..C1..','............','Fr..p0..M1..','............','....E0......'] },
    /* 26 */ { par: 5, sol: '0010', grid: ['Xb......Xr..','........Fr..','............','....M1..C1..','............','M0..p0..M0..','............','....E0......'] },
    /* 27 */ { par: 5, sol: '111', grid: ['..E2........','......E1FcM0','..Fr........','............','..C2..M0..Xc','............','..Fb........','..E0..Xm....'] },
    /* 28 */ { par: 6, sol: '000110', grid: ['......Xw......','..............','..M0..C0......','..............','......C1..M0..','..............','..M0..p0..M1..','..............','......E0......'] },
    /* 29 */ { par: 5, sol: '110', grid: ['....Xb........','..............','....Fb........','..............','E1..p1..C2..Xy','..............','....M0..M1....','..............','..............'] },
    /* 30 */ { par: 7, sol: '01000', grid: ['..Xy......E2..','..............','..........Fm..','..C1..M0......','Xm........M0..','FrP1..M0......','..............','..............','..E0..........'] },
    /* 31 */ { par: 7, sol: '01100', grid: ['......Xy......','..............','..M1........Xb','..............','......c0..M0..','..............','..M0..P1..M1..','..............','......E0......'] },
    /* 32 */ { par: 8, sol: '000110', grid: ['......Xw......','..............','..M0..C1......','..............','......C1..M0..','..............','..M0..p0..M0..','..............','......E0......'] },
    /* 33 */ { par: 1, sol: '1', grid: ['............','............','..##Xw..M0..','..##........','..O1....O2..','............','............','..E0........'] },
    /* 34 */ { par: 4, sol: '101', grid: ['Xb........Xr','..........O2','............','....O1......','............','M0..P1..M1..','............','....E0..Xg..'] },
    /* 35 */ { par: 3, sol: '000', grid: ['............','........Xc..','E1Fy..O1....','......Xy....','M1..Fc..M1..','............','..O2..M1....','E0..........'] },
    /* 36 */ { par: 4, sol: '010', grid: ['....Xy........','..............','......Xb..O2..','..............','....C1..M0....','..............','..O1p0..M0....','..............','....E0........'] },
    /* 37 */ { par: 4, sol: '100', grid: ['..............','..............','XrM0..Xb..O4..','..........Xg..','..O2..O1......','..............','..O3..P1..M0..','..............','......E0......'] },
    /* 38 */ { par: 5, sol: '1011', grid: ['..............','..............','..........O2..','Xb....M0......','..........Xg..','..M0..P2Fr..M0','..............','......O1....Xr','..E0..........'] },
    /* 39 */ { par: 5, sol: '10000', grid: ['..............','Xr..M0M1..O2..','....Fr........','......Xb......','....C1..M0....','..............','O1..p0..M0....','..............','....E0........'] },
    /* 40 */ { par: 6, sol: '2000', grid: ['..........E2..','..............','......Xy......','Xg........P0Xb','..M0..C1......','..............','Fgp0..M1..Xr..','..............','..E0..........'] },
    /* 41 */ { par: 6, sol: '00100', grid: ['....Xy........','..............','M0..C1....M0..','..............','O2....O1......','..............','..Fr..P2..M0..','..............','......E0......'] },
    /* 42 */ { par: 7, sol: '0010', grid: ['....Xw........','..............','....C1....O2..','..............','....C1..M0....','..............','O1..p0..M0....','..............','....E0........'] },
    /* 43 */ { par: 6, sol: '1111', grid: ['..............','..............','Xb..M0........','..............','E1..P2..O1....','..............','....M0..Fg..Xg','........O2..M0','............Xr'] },
    /* 44 */ { par: 8, sol: '00010', grid: ['..Xm..........','..............','..O2......O1..','..............','......M0..C1..','..............','..M1..P2..M1..','..............','..E0..Xg......'] },
    /* 45 */ { par: 9, sol: '01110100', grid: ['....Xw........','....C1..O2....','E1....Fc..M0..','..............','....C1..M0....','Xc........M1..','..O1P0..M1....','..............','E1..M1........'] }
  ];
/*</PRISM_LEVELS>*/

  /* ============================================================
     presentation
     ============================================================ */
  var CRGB = [
    [255, 255, 255],
    [255, 74, 102],   /* 1 R */
    [64, 240, 150],   /* 2 G */
    [255, 214, 64],   /* 3 Y */
    [96, 150, 255],   /* 4 B */
    [236, 96, 240],   /* 5 M */
    [86, 236, 255],   /* 6 C */
    [255, 255, 255]   /* 7 W */
  ];
  function rgba(m, a) { var c = CRGB[m]; return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  var CSTR = ['', '', '', '', '', '', '', ''];   /* per-pass beam colour cache */

  var E = Engine('cv');
  var ctx = E.ctx, cv = E.canvas;
  var el = function (id) { return document.getElementById(id); };
  var MAXLV = 0;

  /* ---------------- persistence ---------------- */
  var unlocked = Store.get('unlocked', 1);
  var stars    = Store.get('stars', {});
  var hints    = Store.get('hints', 3);
  /* Hints bought with Playbox tokens are handed over on load. */
  (function () {
    var bought = PB.takeBoost('prism_hints');
    if (bought > 0) { hints += bought; Store.set('hints', hints); }
  })();
  var hintsThisLevel = 0;
  var cleared  = Store.get('cleared', 0);

  /* ---------------- runtime ---------------- */
  var mode = 'menu';                 /* menu | levels | play | clear | nohints */
  var S = null, idx = 0, moves = 0, initRot = [], undos = [];
  var winT = -1, hintI = -1, hintT = 0, adsBooted = false, busy = false;
  var geo = { cs: 24, ox: 0, oy: 0 }, settleT = 0;
  var CHORD = [392, 494, 587, 698, 880, 1047, 1245];

  function chord(n) {
    for (var i = 0; i < n && i < CHORD.length; i++) {
      (function (f, k) { setTimeout(function () { Sound.tone(f, 0.24, 'sine', 0.07); }, k * 52); })(CHORD[i], i);
    }
  }
  function click() { Sound.tone(880, 0.05, 'triangle', 0.07); Sound.tone(1320, 0.04, 'sine', 0.04); }

  /* ---------------- layout ---------------- */
  function layout() {
    if (!S) return;
    var pad = 8;
    var cs = Math.floor(Math.min((E.w - pad * 2) / S.w, (E.h - pad * 2) / S.h));
    cs = Math.max(18, cs);
    geo.cs = cs;
    geo.ox = Math.round((E.w - cs * S.w) / 2);
    geo.oy = Math.round((E.h - cs * S.h) / 2);
  }
  E.onResize = layout;
  function cx(c) { return geo.ox + (c + 0.5) * geo.cs; }
  function cy(r) { return geo.oy + (r + 0.5) * geo.cs; }

  /* ---------------- level lifecycle ---------------- */
  function loadLevel(n) {
    hintsThisLevel = 0;
    idx = n;
    S = parseLevel(LEVELS[n].grid);
    initRot = S.cells.map(function (c) { return c.rot; });
    moves = 0; undos = []; winT = -1; hintI = -1; hintT = 0;
    evaluate(S);
    mode = 'play';
    UI.hide();
    el('hud').classList.add('on');
    document.body.classList.add('playing');
    /* Drop the banner FIRST: it owns --ad-inset, which pads the body and
       shortens the canvas. Measuring before it clears would centre the
       board for a canvas 58px shorter than the one we actually play on. */
    Ads.hideBanner();
    E.resize();                       /* re-measure, then centre */
    /* the inset unwinds over a .18s CSS transition, and a padding change
       fires no window resize event — so settle it once more afterwards. */
    clearTimeout(settleT);
    settleT = setTimeout(function () { if (mode === 'play') E.resize(); }, 240);
    syncHud();
  }

  function syncHud() {
    el('hudLv').textContent = String(idx + 1);
    el('hudMv').textContent = moves + '/' + LEVELS[idx].par;
    var hb = el('hintBtn');
    hb.textContent = '? ' + hints;
    hb.classList.toggle('hot', hints > 0);
  }

  function rotate(cl) {
    if (cl.lock || cl.states < 2) return;
    undos.push(cl.i);
    cl.rot = (cl.rot + 1) % cl.states;
    cl.va = cl.vs; cl.at = 0; cl.dir = 1;
    moves++;
    if (hintI === cl.i) { hintI = -1; hintT = 0; }
    afterMove();
  }

  function afterMove() {
    evaluate(S);
    syncHud();
    var sat = 0;
    for (var k = 0; k < S.crystals.length; k++) if (S.cells[S.crystals[k]].sat) sat++;
    if (S.solved) {
      winT = 0; Sound.great(); Buzz(30);
    } else {
      click(); Buzz(8);
      if (sat) chord(sat);
    }
  }

  function restart() {
    if (winT >= 0) return;                       /* let the cascade finish */
    for (var i = 0; i < S.cells.length; i++) {
      var c = S.cells[i];
      if (c.rot !== initRot[i]) { c.rot = initRot[i]; c.vs = initRot[i]; c.va = initRot[i]; c.at = 1; c.dir = 1; }
    }
    moves = 0; undos = []; winT = -1; hintI = -1;
    evaluate(S); syncHud();
  }

  function undo() {
    if (!undos.length || winT >= 0) { UI.toast('Nothing to undo'); return; }
    var i = undos.pop(), c = S.cells[i];
    c.rot = (c.rot - 1 + c.states) % c.states;
    c.va = c.vs; c.at = 0; c.dir = -1;          /* wind the visual back too */
    moves = Math.max(0, moves - 1);
    evaluate(S); syncHud(); click();
  }

  function useHint() {
    if (winT >= 0) return;
    var sol = LEVELS[idx].sol;
    if (!sol) { UI.toast('No hint here'); return; }
    var opts = [];
    for (var k = 0; k < S.movers.length; k++) {
      if (S.cells[S.movers[k]].rot !== +sol.charAt(k)) opts.push(k);
    }
    if (!opts.length) { UI.toast('Every piece is already right'); return; }
    if (hints <= 0) {
      if (Ads.isRewardedReady()) {
        // Deliberately NO banner here: this modal sits over a live puzzle
        // board, and a banner next to a tappable grid is both a bad idea and
        // an AdMob policy risk. Banners belong on the menu and the results
        // screen only.
        mode = 'nohints';
        UI.show('nohints');
      } else {
        UI.toast('Out of hints — every 5th level solved earns one');
        Sound.bad();
      }
      return;
    }
    hints--; hintsThisLevel++; Store.set('hints', hints);
    var pick = opts[0], best = 9;
    for (var j = 0; j < opts.length; j++) {
      var m = S.cells[S.movers[opts[j]]];
      var need = ((+sol.charAt(opts[j])) - m.rot + m.states) % m.states;
      if (need < best) { best = need; pick = opts[j]; }
    }
    hintI = S.movers[pick]; hintT = 5;
    syncHud(); Sound.ping();
  }

  /* ---------------- completion ---------------- */
  function starsFor(mv, par) { return mv <= par ? 3 : mv <= par + 3 ? 2 : 1; }

  function finishLevel() {
    var par = LEVELS[idx].par;
    var st = starsFor(moves, par);
    var prev = stars[idx] || 0;
    if (st > prev) { stars[idx] = st; Store.set('stars', stars); }
    if (idx + 2 > unlocked) { unlocked = Math.min(LEVELS.length, idx + 2); Store.set('unlocked', unlocked); }
    cleared++; Store.set('cleared', cleared);
    var gift = (cleared % 5 === 0);
    if (gift) { hints++; Store.set('hints', hints); }
    PB.report('level', { level: idx + 1, stars: st, turns: moves, hintsUsed: hintsThisLevel });

    mode = 'clear';
    el('hud').classList.remove('on');
    document.body.classList.remove('playing');
    el('clearTitle').textContent = 'Level ' + (idx + 1) + ' solved';
    el('clearMoves').textContent = moves + (moves === 1 ? ' turn' : ' turns');
    el('clearSub').textContent = gift ? 'Par ' + par + '  ·  +1 free hint'
                                      : (moves <= par ? 'Par ' + par + '  ·  perfect' : 'Par ' + par);
    var row = el('starRow').children;
    for (var i = 0; i < 3; i++) {
      row[i].className = '';
      (function (n) {
        setTimeout(function () { row[n].className = n < st ? 'show on' : 'show'; }, 130 + n * 150);
      })(i);
    }
    el('btnNext').textContent = (idx + 1 >= LEVELS.length) ? 'Menu' : 'Next';
    UI.show('clear');
    Ads.showBanner();
  }

  /* ============================================================
     drawing
     ============================================================ */
  function lockGlyph(x, y, s) {
    ctx.strokeStyle = 'rgba(180,196,224,.55)';
    ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.beginPath();
    ctx.arc(x, y - s * 0.035, s * 0.036, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(180,196,224,.5)';
    U.rr(ctx, x - s * 0.05, y - s * 0.035, s * 0.10, s * 0.075, s * 0.018);
    ctx.fill();
  }

  function drawPiece(cl, t) {
    var s = geo.cs, x = cx(cl.c), y = cy(cl.r);
    var dim = cl.lock && cl.states > 1 ? 0.5 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(cl.vs * Math.PI / 2);
    var h = s * 0.34, m, i, a;
    switch (cl.t) {
      case T_MIRROR:
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(8,12,22,.95)'; ctx.lineWidth = s * 0.22;
        ctx.beginPath(); ctx.moveTo(-h, h); ctx.lineTo(h, -h); ctx.stroke();
        ctx.strokeStyle = 'rgba(150,178,220,' + (0.85 * dim) + ')'; ctx.lineWidth = s * 0.13;
        ctx.beginPath(); ctx.moveTo(-h, h); ctx.lineTo(h, -h); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * dim) + ')'; ctx.lineWidth = s * 0.04;
        ctx.beginPath(); ctx.moveTo(-h * 0.82, h * 0.72); ctx.lineTo(h * 0.86, -h * 0.9); ctx.stroke();
        break;
      case T_EMIT:
        ctx.fillStyle = 'rgba(20,28,48,.98)';
        U.rr(ctx, -s * 0.30, -s * 0.24, s * 0.60, s * 0.54, s * 0.10); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.34)'; ctx.lineWidth = s * 0.025;
        U.rr(ctx, -s * 0.30, -s * 0.24, s * 0.60, s * 0.54, s * 0.10); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.7 + 0.3 * Math.sin(t * 3)) + ')';
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.42); ctx.lineTo(s * 0.17, -s * 0.18); ctx.lineTo(-s * 0.17, -s * 0.18);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        for (i = 0; i < 3; i++) { U.rr(ctx, -s * 0.17 + i * s * 0.12, s * 0.02, s * 0.07, s * 0.16, s * 0.02); ctx.fill(); }
        break;
      case T_SPLIT:
        ctx.beginPath();
        ctx.moveTo(0, -h * 1.06); ctx.lineTo(h * 0.98, h * 0.74); ctx.lineTo(-h * 0.98, h * 0.74);
        ctx.closePath();
        ctx.fillStyle = 'rgba(120,150,215,' + (0.20 * dim) + ')'; ctx.fill();
        ctx.strokeStyle = 'rgba(210,230,255,' + (0.85 * dim) + ')'; ctx.lineWidth = s * 0.045;
        ctx.lineJoin = 'round'; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 * dim) + ')'; ctx.lineWidth = s * 0.022;
        ctx.beginPath(); ctx.moveTo(-h * 0.30, h * 0.20); ctx.lineTo(h * 0.16, -h * 0.52); ctx.stroke();
        var nub = [[0, -h * 1.06, 1], [h * 0.62, h * 0.30, 2], [-h * 0.62, h * 0.30, 4]];
        for (i = 0; i < 3; i++) {
          ctx.fillStyle = rgba(nub[i][2], 0.95 * dim);
          ctx.beginPath(); ctx.arc(nub[i][0], nub[i][1], s * 0.048, 0, 6.2832); ctx.fill();
        }
        break;
      case T_COMB:
        ctx.beginPath();
        for (i = 0; i < 6; i++) {
          a = -Math.PI / 2 + i * Math.PI / 3;
          var pxx = Math.cos(a) * h * 0.92, pyy = Math.sin(a) * h * 0.92;
          if (i) ctx.lineTo(pxx, pyy); else ctx.moveTo(pxx, pyy);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(124,92,255,' + (0.20 * dim) + ')'; ctx.fill();
        ctx.strokeStyle = 'rgba(178,158,255,' + (0.85 * dim) + ')'; ctx.lineWidth = s * 0.042;
        ctx.lineJoin = 'round'; ctx.stroke();
        ctx.fillStyle = 'rgba(232,224,255,' + (0.92 * dim) + ')';
        ctx.beginPath();
        ctx.moveTo(0, -h * 1.05); ctx.lineTo(h * 0.34, -h * 0.52); ctx.lineTo(-h * 0.34, -h * 0.52);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(178,158,255,' + (0.5 * dim) + ')'; ctx.lineWidth = s * 0.032;
        for (i = 1; i < 4; i++) {
          a = -Math.PI / 2 + i * Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * h * 0.80, Math.sin(a) * h * 0.80);
          ctx.lineTo(Math.cos(a) * h * 1.16, Math.sin(a) * h * 1.16);
          ctx.stroke();
        }
        break;
      case T_FILTER:
        ctx.fillStyle = rgba(cl.col, 0.24);
        U.rr(ctx, -s * 0.33, -s * 0.33, s * 0.66, s * 0.66, s * 0.11); ctx.fill();
        ctx.strokeStyle = rgba(cl.col, 0.85); ctx.lineWidth = s * 0.04;
        U.rr(ctx, -s * 0.33, -s * 0.33, s * 0.66, s * 0.66, s * 0.11); ctx.stroke();
        ctx.strokeStyle = rgba(cl.col, 0.34); ctx.lineWidth = s * 0.025;
        for (i = -1; i < 2; i++) {
          ctx.beginPath(); ctx.moveTo(-s * 0.24, i * s * 0.18 + s * 0.06);
          ctx.lineTo(s * 0.24, i * s * 0.18 - s * 0.10); ctx.stroke();
        }
        break;
      case T_CRYS: {
        var bloom = (winT >= 0) ? Math.min(1, winT * 2.2) : 0;
        var g = h * (0.86 + bloom * 0.16);
        ctx.beginPath();
        ctx.moveTo(0, -g); ctx.lineTo(g * 0.76, 0); ctx.lineTo(0, g); ctx.lineTo(-g * 0.76, 0);
        ctx.closePath();
        if (cl.sat) {
          ctx.shadowColor = rgba(cl.col, 0.9);
          ctx.shadowBlur = s * (0.28 + bloom * 0.45);
          ctx.fillStyle = rgba(cl.col, 0.55 + 0.25 * Math.sin(t * 4) + bloom * 0.2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = rgba(cl.col, 1); ctx.lineWidth = s * 0.055;
        } else {
          ctx.fillStyle = rgba(cl.col, 0.09); ctx.fill();
          ctx.strokeStyle = rgba(cl.col, 0.75); ctx.lineWidth = s * 0.045;
        }
        ctx.lineJoin = 'round'; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,' + (cl.sat ? 0.55 : 0.18) + ')';
        ctx.lineWidth = s * 0.02;
        ctx.beginPath(); ctx.moveTo(0, -g * 0.62); ctx.lineTo(-g * 0.34, 0); ctx.lineTo(0, g * 0.62); ctx.stroke();
        break;
      }
      case T_PORT: {
        var pc = (cl.pid <= 2) ? [124, 92, 255] : [255, 200, 87];
        ctx.strokeStyle = 'rgba(' + pc[0] + ',' + pc[1] + ',' + pc[2] + ',.85)';
        ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.arc(0, 0, h * 0.92, 0, 6.2832); ctx.stroke();
        ctx.lineWidth = s * 0.03;
        ctx.beginPath(); ctx.arc(0, 0, h * 0.58, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = 'rgba(' + pc[0] + ',' + pc[1] + ',' + pc[2] + ',.9)';
        for (i = 0; i < 3; i++) {
          a = t * 1.4 + i * 2.094;
          ctx.beginPath(); ctx.arc(Math.cos(a) * h * 0.75, Math.sin(a) * h * 0.75, s * 0.04, 0, 6.2832); ctx.fill();
        }
        break;
      }
      default: break;
    }
    ctx.restore();
    if (cl.lock && cl.states > 1) lockGlyph(x + s * 0.30, y + s * 0.30, s);
  }

  function drawBeams(t) {
    var s = geo.cs, core = Math.max(2.5, s * 0.055), outer = core * 3.2;
    var puls = 0.86 + 0.14 * Math.sin(t * 5);
    if (winT >= 0) puls = 1 + 0.5 * Math.abs(Math.sin(winT * 7));
    ctx.globalCompositeOperation = 'lighter';
    var pass, i, d;
    /* butt caps on the halo: round ones double-blend at every cell
       join and bead the beam. The thin core keeps round caps.      */
    for (pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? core : outer;
      ctx.lineCap = 'butt';   /* butt everywhere: piece art covers the turns */
      var a = (pass ? 0.90 : 0.10) * puls;
      for (var q = 1; q < 8; q++) CSTR[q] = rgba(q, a);   /* no per-stroke strings */
      for (i = 0; i < S.n; i++) {
        var cl = S.cells[i], X = cx(cl.c), Y = cy(cl.r), b = i * 4;
        var port = (cl.t === T_PORT);
        for (d = 0; d < 4; d++) {
          var mi = S.inc[b + d], mo = S.out[b + d];
          var hx = DX[d] * s * 0.5, hy = DY[d] * s * 0.5;
          if (mi && mi === mo && !port) {          /* straight run: one stroke */
            ctx.strokeStyle = CSTR[mi];
            ctx.beginPath(); ctx.moveTo(X - hx, Y - hy); ctx.lineTo(X + hx, Y + hy); ctx.stroke();
            continue;
          }
          if (mi) {
            ctx.strokeStyle = CSTR[mi];
            ctx.beginPath(); ctx.moveTo(X - hx, Y - hy); ctx.lineTo(X, Y); ctx.stroke();
          }
          if (mo) {
            ctx.strokeStyle = CSTR[mo];
            ctx.beginPath();
            if (port) ctx.moveTo(X + hx * 0.62, Y + hy * 0.62); else ctx.moveTo(X, Y);
            ctx.lineTo(X + hx, Y + hy); ctx.stroke();
          }
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRing(X, Y, r, col, a) {
    ctx.strokeStyle = col.replace('$A', a);
    ctx.lineWidth = Math.max(2, geo.cs * 0.05);
    ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.2832); ctx.stroke();
  }

  function drawArrow(X, Y, r, t) {
    ctx.strokeStyle = 'rgba(255,200,87,.95)';
    ctx.lineWidth = Math.max(2, geo.cs * 0.06);
    ctx.lineCap = 'round';
    var a0 = -2.5 + t * 2, a1 = a0 + 2.4;
    ctx.beginPath(); ctx.arc(X, Y, r, a0, a1); ctx.stroke();
    var hx = X + Math.cos(a1) * r, hy = Y + Math.sin(a1) * r;
    var tx = -Math.sin(a1), ty = Math.cos(a1);
    var w = geo.cs * 0.09;
    ctx.fillStyle = 'rgba(255,200,87,.95)';
    ctx.beginPath();
    ctx.moveTo(hx + tx * w * 1.7, hy + ty * w * 1.7);
    ctx.lineTo(hx - tx * w * 0.2 + Math.cos(a1) * w, hy - ty * w * 0.2 + Math.sin(a1) * w);
    ctx.lineTo(hx - tx * w * 0.2 - Math.cos(a1) * w, hy - ty * w * 0.2 - Math.sin(a1) * w);
    ctx.closePath(); ctx.fill();
  }

  E.onUpdate = function (dt, t) {
    if (!S) return;
    var i;
    for (i = 0; i < S.cells.length; i++) {
      var c = S.cells[i];
      if (c.at < 1) {
        c.at = Math.min(1, c.at + dt / 0.14);
        var e = 1 - Math.pow(1 - c.at, 3);
        c.vs = c.va + e * c.dir;
        if (c.at >= 1) c.vs = c.va + c.dir;
      }
    }
    if (hintT > 0) hintT -= dt;
    if (winT >= 0 && mode === 'play') {
      winT += dt;
      if (winT > 1.05) finishLevel();
    }
  };

  E.onRender = function (ctx2, w, h, t) {
    ctx.clearRect(0, 0, w, h);
    if (!S || (mode !== 'play' && mode !== 'nohints')) return;
    var s = geo.cs, i;

    /* board plate */
    ctx.fillStyle = 'rgba(14,20,36,.75)';
    U.rr(ctx, geo.ox - s * 0.12, geo.oy - s * 0.12, s * S.w + s * 0.24, s * S.h + s * 0.24, s * 0.22);
    ctx.fill();

    for (i = 0; i < S.n; i++) {
      var cl = S.cells[i], X = geo.ox + cl.c * s, Y = geo.oy + cl.r * s;
      if (cl.t === T_WALL) {
        ctx.fillStyle = 'rgba(38,48,72,.95)';
        U.rr(ctx, X + s * 0.06, Y + s * 0.06, s * 0.88, s * 0.88, s * 0.12); ctx.fill();
        ctx.strokeStyle = 'rgba(70,86,124,.7)'; ctx.lineWidth = Math.max(1, s * 0.02);
        ctx.beginPath();
        ctx.moveTo(X + s * 0.22, Y + s * 0.72); ctx.lineTo(X + s * 0.72, Y + s * 0.22);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
        ctx.strokeRect(X + 0.5, Y + 0.5, s - 1, s - 1);
      }
    }

    drawBeams(t);

    for (i = 0; i < S.n; i++) if (S.cells[i].t > T_WALL) drawPiece(S.cells[i], t);

    /* first-run nudge + hint */
    if (idx === 0 && moves === 0 && winT < 0 && hintT <= 0) {
      for (i = 0; i < S.movers.length; i++) {
        var mc = S.cells[S.movers[i]];
        var a = 0.30 + 0.28 * Math.sin(t * 3.4);
        drawRing(cx(mc.c), cy(mc.r), s * 0.44 + Math.sin(t * 3.4) * s * 0.03,
                 'rgba(78,225,193,$A)', a.toFixed(3));
      }
    }
    if (hintI >= 0 && hintT > 0) {
      var hc = S.cells[hintI];
      var fade = Math.min(1, hintT);
      drawRing(cx(hc.c), cy(hc.r), s * 0.44, 'rgba(255,200,87,$A)', (0.85 * fade).toFixed(3));
      ctx.save(); ctx.globalAlpha = fade;
      drawArrow(cx(hc.c), cy(hc.r), s * 0.58, t);
      ctx.restore();
    }
  };

  /* ---------------- input ---------------- */
  Input(cv, {
    down: function (x, y) {
      if (mode !== 'play' || winT >= 0) return;
      var c = Math.floor((x - geo.ox) / geo.cs), r = Math.floor((y - geo.oy) / geo.cs);
      if (c < 0 || c >= S.w || r < 0 || r >= S.h) return;
      var cl = S.cells[r * S.w + c];
      if (cl.states > 1 && !cl.lock) rotate(cl);
      else if (cl.lock && cl.states > 1) { UI.toast('That one is fixed in place'); Sound.bad(); }
    }
  });

  /* ---------------- menus ---------------- */
  function totalStars() {
    var n = 0;
    for (var k in stars) n += stars[k];
    return n;
  }
  function refreshMenu() {
    el('chipStars').textContent = totalStars() + ' / ' + (LEVELS.length * 3) + ' stars';
    el('chipMute').textContent = Sound.muted ? 'Sound off' : 'Sound on';
    el('btnPlay').textContent = unlocked > 1 ? 'Continue · ' + Math.min(unlocked, LEVELS.length) : 'Play';
  }
  function buildGrid() {
    var g = el('lvGrid');
    if (g.childElementCount === LEVELS.length) { paintGrid(); return; }
    g.textContent = '';
    for (var i = 0; i < LEVELS.length; i++) {
      var b = document.createElement('button');
      b.className = 'lv';
      var num = document.createElement('span');
      num.textContent = String(i + 1);
      var st = document.createElement('span');
      st.className = 'st';
      for (var k = 0; k < 3; k++) st.appendChild(document.createElement('i'));
      b.appendChild(num); b.appendChild(st);
      b.setAttribute('data-n', i);
      b.addEventListener('click', function () {
        Sound.tap(); loadLevel(+this.getAttribute('data-n'));
      });
      g.appendChild(b);
    }
    paintGrid();
  }
  function paintGrid() {
    var g = el('lvGrid');
    for (var i = 0; i < g.children.length; i++) {
      var b = g.children[i], st = stars[i] || 0;
      if (i + 1 > unlocked) b.setAttribute('disabled', ''); else b.removeAttribute('disabled');
      b.classList.toggle('done', st > 0);
      var dots = b.lastChild.children;
      for (var k = 0; k < 3; k++) dots[k].className = k < st ? 'on' : '';
    }
  }
  function toMenu() {
    mode = 'menu';
    el('hud').classList.remove('on');
    document.body.classList.remove('playing');
    refreshMenu(); UI.show('menu'); Ads.showBanner();
  }

  function bootAds() {
    if (adsBooted) return;
    adsBooted = true;
    Promise.resolve(Ads.init()).then(function () { if (mode !== 'play') Ads.showBanner(); });
  }
  window.addEventListener('pointerdown', bootAds, { once: true });

  el('btnPlay').addEventListener('click', function () {
    Sound.tap(); loadLevel(Math.min(unlocked, LEVELS.length) - 1);
  });
  el('btnLevels').addEventListener('click', function () {
    Sound.tap(); mode = 'levels'; buildGrid(); UI.show('levels'); Ads.showBanner();
  });
  el('btnLvBack').addEventListener('click', function () { Sound.tap(); toMenu(); });
  el('chipMute').addEventListener('click', function () {
    Sound.toggle(); this.textContent = Sound.muted ? 'Sound off' : 'Sound on';
  });
  el('backBtn').addEventListener('click', function () { Sound.tap(); toMenu(); });
  el('undoBtn').addEventListener('click', function () { undo(); });
  el('againBtn').addEventListener('click', function () { Sound.tap(); restart(); });
  el('hintBtn').addEventListener('click', function () { useHint(); });
  el('btnHintClose').addEventListener('click', function () {
    Sound.tap(); mode = 'play'; UI.hide();
  });
  el('btnReward').addEventListener('click', async function () {
    if (busy) return;
    busy = true; this.setAttribute('disabled', '');
    var ok = false;
    try { ok = await Ads.showRewarded(); }
    finally { this.removeAttribute('disabled'); busy = false; }
    if (ok) {
      hints += 3; Store.set('hints', hints); syncHud();
      UI.toast('+3 hints');
      mode = 'play'; UI.hide();
    } else {
      UI.toast('No ad available right now');
    }
  });
  el('btnClearMenu').addEventListener('click', function () { Sound.tap(); toMenu(); });
  el('btnNext').addEventListener('click', async function () {
    if (busy) return;
    Sound.tap();
    busy = true; this.setAttribute('disabled', '');
    try { await Ads.maybeInterstitial(); }
    finally { this.removeAttribute('disabled'); busy = false; }
    if (idx + 1 >= LEVELS.length) { toMenu(); return; }
    loadLevel(idx + 1);
  });

  window.Game = {
    onBackground: function () { E.stop(); }
  };
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) E.start();
  });

  /* ---------------- boot ---------------- */
  MAXLV = LEVELS.length;
  unlocked = Math.max(1, Math.min(unlocked, MAXLV));
  refreshMenu();
  UI.show('menu');
  Ads.showBanner();
  E.start();
})();
