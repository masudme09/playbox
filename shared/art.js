/* ============================================================
   Store + launcher artwork, drawn on canvas. No image files in,
   PNGs out. Run via tools/render-assets.mjs.
   ============================================================ */
(function (g) {
'use strict';

var GAMES = {
  echo:      { name:'ECHO',       sub:'See with sound',              bg:['#04121a','#0a2a33'], key:'#4ee1c1' },
  starfall:  { name:'STARFALL',   sub:'Slingshot the galaxy',        bg:['#0a0a22','#1d1440'], key:'#ffc857' },
  prism:     { name:'PRISM',      sub:'Split the light',             bg:['#0b0716','#221342'], key:'#7c5cff' },
  vortex:    { name:'VORTEX',     sub:"Don't touch the walls",       bg:['#03121c','#062b3d'], key:'#43d9ff' },
  dailylock: { name:'DAILY LOCK', sub:'One lock a day',              bg:['#0d1020','#1b2340'], key:'#4ee1c1' },
  /* the collection itself — the app's own identity */
  playbox:   { name:'PLAYBOX',    sub:'Mind & reflex games',        bg:['#080b14','#141b33'], key:'#4ee1c1' }
};

/* the five games' accents, in shelf order — the collection mark is built from them */
var WEDGE = ['#4ee1c1', '#ffc857', '#7c5cff', '#43d9ff', '#ff6b9d'];
var SLUGS = ['echo', 'starfall', 'prism', 'vortex', 'dailylock'];

function bgFill(ctx, slug, w, h) {
  var c = GAMES[slug].bg;
  var grd = ctx.createLinearGradient(0, 0, w * 0.4, h);
  grd.addColorStop(0, c[0]); grd.addColorStop(1, c[1]);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
}

/* ---------------- per-game emblem, drawn in a unit box ----------------
   All emblems draw inside (-0.5..0.5, -0.5..0.5) so they scale anywhere. */
var EMBLEM = {

  echo: function (ctx) {
    // expanding sonar rings + fragments of lit maze wall
    ctx.lineCap = 'round';
    for (var i = 3; i >= 1; i--) {
      var r = i * 0.135;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(78,225,193,' + (0.95 - i * 0.24) + ')';
      ctx.lineWidth = 0.028 - i * 0.004;
      ctx.stroke();
    }
    // lit wall fragments the ring has just touched
    var segs = [[-0.44,-0.30,-0.10,-0.30],[-0.10,-0.30,-0.10,0.02],
                [ 0.16,-0.42, 0.16,-0.06],[ 0.16,-0.06, 0.44,-0.06],
                [-0.44, 0.20, -0.06,0.20],[ 0.06, 0.16, 0.06, 0.46],
                [ 0.06, 0.46,  0.42,0.46]];
    ctx.lineWidth = 0.036; ctx.lineCap = 'round';
    for (var s = 0; s < segs.length; s++) {
      var a = segs[s];
      var d = Math.hypot((a[0]+a[2])/2, (a[1]+a[3])/2);
      ctx.strokeStyle = 'rgba(190,255,242,' + Math.max(0.16, 0.85 - d * 1.25) + ')';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.stroke();
    }
    // player blip
    var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.14);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.28, 'rgba(180,255,240,.8)');
    gr.addColorStop(1, 'rgba(78,225,193,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 0.032, 0, Math.PI * 2); ctx.fill();
  },

  starfall: function (ctx) {
    // planet with a comet whipping around it
    var pg = ctx.createRadialGradient(-0.10, 0.14, 0.02, -0.06, 0.18, 0.30);
    pg.addColorStop(0, '#8b7bff'); pg.addColorStop(1, '#2b1f6b');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(-0.08, 0.16, 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(140,120,255,.55)'; ctx.lineWidth = 0.014;
    ctx.beginPath(); ctx.arc(-0.08, 0.16, 0.30, 0, Math.PI * 2); ctx.stroke();

    // slingshot trajectory
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.46, 0.46);
    ctx.bezierCurveTo(-0.34, 0.02, 0.10, -0.02, 0.20, -0.24);
    var tg = ctx.createLinearGradient(-0.46, 0.46, 0.24, -0.44);
    tg.addColorStop(0, 'rgba(255,200,87,0)'); tg.addColorStop(0.55, 'rgba(255,200,87,.75)');
    tg.addColorStop(1, '#fff3d0');
    ctx.strokeStyle = tg; ctx.lineWidth = 0.042; ctx.stroke();

    // comet head
    var cg = ctx.createRadialGradient(0.235, -0.30, 0, 0.235, -0.30, 0.13);
    cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.3, '#ffd873');
    cg.addColorStop(1, 'rgba(255,200,87,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0.235, -0.30, 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0.235, -0.30, 0.038, 0, Math.PI * 2); ctx.fill();

    // sparse stars
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    var st = [[-0.38,-0.30,0.012],[0.40,0.30,0.014],[-0.24,-0.44,0.009],[0.44,-0.06,0.010],[0.06,0.44,0.011]];
    for (var i = 0; i < st.length; i++) { ctx.beginPath(); ctx.arc(st[i][0], st[i][1], st[i][2], 0, Math.PI*2); ctx.fill(); }
  },

  prism: function (ctx) {
    // white beam into a triangle, RGB fan out
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.055;
    ctx.beginPath(); ctx.moveTo(-0.50, -0.02); ctx.lineTo(-0.115, -0.02); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 0.13;
    ctx.beginPath(); ctx.moveTo(-0.50, -0.02); ctx.lineTo(-0.115, -0.02); ctx.stroke();

    // fan
    var cols = ['#ff5470', '#4eff9b', '#5aa8ff'];
    var ang  = [-0.30, 0, 0.30];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 3; i++) {
      var x2 = 0.52, y2 = -0.02 + Math.tan(ang[i]) * (x2 - 0.11);
      ctx.strokeStyle = cols[i]; ctx.lineWidth = 0.046;
      ctx.beginPath(); ctx.moveTo(0.10, -0.02); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = 0.30; ctx.lineWidth = 0.115;
      ctx.beginPath(); ctx.moveTo(0.10, -0.02); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // the prism itself
    ctx.beginPath();
    ctx.moveTo(0, -0.40); ctx.lineTo(0.27, 0.24); ctx.lineTo(-0.27, 0.24); ctx.closePath();
    var pg = ctx.createLinearGradient(-0.27, -0.40, 0.27, 0.24);
    pg.addColorStop(0, 'rgba(255,255,255,.20)'); pg.addColorStop(1, 'rgba(124,92,255,.34)');
    ctx.fillStyle = pg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 0.024; ctx.lineJoin = 'round'; ctx.stroke();
  },

  vortex: function (ctx) {
    // core + collapsing arcs with gaps + ship
    var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.22);
    cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.18, '#bfe9ff');
    cg.addColorStop(1, 'rgba(67,217,255,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 0.052, 0, Math.PI * 2); ctx.fill();

    ctx.lineCap = 'round';
    var rings = [
      { r: 0.235, a0: 0.62, a1: 5.70, w: 0.055, c: 'rgba(67,217,255,.95)' },
      { r: 0.345, a0: 2.55, a1: 1.35, w: 0.052, c: 'rgba(67,217,255,.62)' },
      { r: 0.452, a0: 4.20, a1: 3.05, w: 0.048, c: 'rgba(67,217,255,.32)' }
    ];
    for (var i = 0; i < rings.length; i++) {
      var R = rings[i];
      ctx.beginPath(); ctx.arc(0, 0, R.r, R.a0, R.a1);
      ctx.strokeStyle = R.c; ctx.lineWidth = R.w; ctx.stroke();
    }
    // ship sitting in the first gap
    ctx.save(); ctx.translate(0, -0.235); ctx.rotate(0);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -0.055); ctx.lineTo(0.045, 0.042); ctx.lineTo(0, 0.016); ctx.lineTo(-0.045, 0.042); ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  /* PLAYBOX: five wedges around a bright core. One mark that says
     "more than one game" at 48px, and the wedge colours are the games'
     own accents so the icon and the shelf agree. */
  playbox: function (ctx) {
    /* Light thrown out of a core in five directions. Bright at the rim so it
       reads as emission rather than as a pie chart, with real gaps between
       the blades and rounded ends. */
    var R = 0.48, r0 = 0.135, gap = 0.30, rot = -Math.PI / 2 - 0.22;
    var step = Math.PI * 2 / 5;
    for (var i = 0; i < 5; i++) {
      var a0 = rot + i * step + gap / 2;
      var a1 = rot + (i + 1) * step - gap / 2;
      var mid = (a0 + a1) / 2;
      var g = ctx.createLinearGradient(Math.cos(mid) * r0, Math.sin(mid) * r0,
                                       Math.cos(mid) * R,  Math.sin(mid) * R);
      g.addColorStop(0, shade(WEDGE[i], -0.30));
      g.addColorStop(0.55, WEDGE[i]);
      g.addColorStop(1, shade(WEDGE[i], 0.34));

      // blade: an arc at R, tapering to a point near the core
      var w0 = 0.020, w1 = 0.104;                 // half-widths, inner and outer
      ctx.beginPath();
      ctx.moveTo(Math.cos(mid) * (r0 * 0.55), Math.sin(mid) * (r0 * 0.55));
      ctx.lineTo(Math.cos(a0) * R * 0.99, Math.sin(a0) * R * 0.99);
      ctx.arc(0, 0, R, a0, a1);
      ctx.lineTo(Math.cos(mid) * (r0 * 0.55), Math.sin(mid) * (r0 * 0.55));
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      void w0; void w1;
    }
    // core
    var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, r0 * 1.5);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.42, 'rgba(220,240,255,.55)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, r0 * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r0 * 0.40, 0, Math.PI * 2); ctx.fill();
  },

  dailylock: function (ctx) {
    // padlock with three glyph dials
    ctx.strokeStyle = 'rgba(190,206,240,.9)'; ctx.lineWidth = 0.072; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -0.13, 0.205, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.205, -0.13); ctx.lineTo(-0.205, -0.02);
    ctx.moveTo(0.205, -0.13); ctx.lineTo(0.205, -0.02); ctx.stroke();

    var bg2 = ctx.createLinearGradient(0, -0.04, 0, 0.44);
    bg2.addColorStop(0, '#3b4a72'); bg2.addColorStop(1, '#1b2340');
    ctx.fillStyle = bg2;
    rr(ctx, -0.375, -0.04, 0.75, 0.50, 0.085); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 0.014; ctx.stroke();

    // three dials: triangle, square(accent), star
    var dx = [-0.20, 0, 0.20], R = 0.115;
    for (var i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(dx[i], 0.21, R, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1020'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = 0.012; ctx.stroke();
    }
    // glyph 1 triangle
    ctx.fillStyle = '#ffc857';
    ctx.beginPath(); ctx.moveTo(-0.20, 0.145); ctx.lineTo(-0.145, 0.255); ctx.lineTo(-0.255, 0.255); ctx.closePath(); ctx.fill();
    // glyph 2 square
    ctx.fillStyle = '#7c5cff'; rr(ctx, -0.052, 0.158, 0.104, 0.104, 0.02); ctx.fill();
    // glyph 3 star
    star(ctx, 0.20, 0.208, 0.058, 0.026, 5, '#ff5470');
    // solved indicator
    ctx.fillStyle = '#4ee1c1';
    ctx.beginPath(); ctx.arc(0, -0.30, 0.030, 0, Math.PI * 2); ctx.fill();
  }
};

/* darken/lighten a #rrggbb by a fraction */
function shade(hex, amt) {
  var n = parseInt(hex.slice(1), 16);
  var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  function f(v) { return Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt)))); }
  return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function star(ctx, cx, cy, R, r, n, col) {
  ctx.beginPath();
  for (var i = 0; i < n * 2; i++) {
    var a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}

/* ---------------- public renderers ---------------- */

/* square launcher / store icon */
function drawIcon(ctx, slug, size, opts) {
  opts = opts || {};
  ctx.clearRect(0, 0, size, size);
  if (!opts.transparent) {
    bgFill(ctx, slug, size, size);
    // subtle vignette so the emblem pops on any wallpaper
    var v = ctx.createRadialGradient(size/2, size*0.42, size*0.1, size/2, size/2, size*0.72);
    v.addColorStop(0, 'rgba(255,255,255,.05)'); v.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, size, size);
  }
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size * (opts.scale || 0.80), size * (opts.scale || 0.80));
  ctx.lineJoin = 'round';
  EMBLEM[slug](ctx);
  ctx.restore();
}

/* 1024x500 Play feature graphic */
function drawFeature(ctx, slug, w, h) {
  var G = GAMES[slug];
  bgFill(ctx, slug, w, h);

  // faint radial wash behind the emblem
  var v = ctx.createRadialGradient(w * 0.215, h * 0.5, 10, w * 0.24, h * 0.5, h * 0.95);
  v.addColorStop(0, 'rgba(255,255,255,.09)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);

  // emblem, left third
  ctx.save();
  ctx.translate(w * 0.215, h * 0.5);
  ctx.scale(h * 0.82, h * 0.82);
  ctx.lineJoin = 'round';
  EMBLEM[slug](ctx);
  ctx.restore();

  // wordmark, right — auto-shrunk so long names never clip
  var x = w * 0.44, maxW = w - x - w * 0.05;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  function fit(text, startPx, weight, tracking) {
    var px = startPx;
    for (var i = 0; i < 40; i++) {
      ctx.font = weight + ' ' + Math.round(px) + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
      ctx.letterSpacing = Math.round(px * tracking) + 'px';
      // letterSpacing is not counted by measureText in every engine — add it back
      var wdt = ctx.measureText(text).width + Math.round(px * tracking) * (text.length - 1);
      if (wdt <= maxW) return px;
      px *= 0.94;
    }
    return px;
  }

  var titlePx = fit(G.name, h * 0.175, '800', 0.10);
  var tg = ctx.createLinearGradient(x, h * 0.30, x, h * 0.52);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, G.key);
  ctx.fillStyle = tg;
  ctx.font = '800 ' + Math.round(titlePx) + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  ctx.letterSpacing = Math.round(titlePx * 0.10) + 'px';
  ctx.fillText(G.name, x, h * 0.50);

  var subPx = fit(G.sub.toUpperCase(), h * 0.068, '500', 0.09);
  ctx.font = '500 ' + Math.round(subPx) + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  ctx.letterSpacing = Math.round(subPx * 0.09) + 'px';
  ctx.fillStyle = 'rgba(232,237,247,.72)';
  ctx.fillText(G.sub.toUpperCase(), x, h * 0.635);

  // thin accent rule
  ctx.fillStyle = G.key;
  ctx.fillRect(x, h * 0.705, h * 0.24, Math.max(2, h * 0.010));
  ctx.letterSpacing = '0px';
}

/* 1024x500 feature graphic for the collection: the five game emblems in a
   row above the wordmark, so the store page shows what is actually inside. */
function drawCollectionFeature(ctx, w, h) {
  bgFill(ctx, 'playbox', w, h);
  var v = ctx.createRadialGradient(w * 0.5, h * 0.30, 10, w * 0.5, h * 0.5, w * 0.62);
  v.addColorStop(0, 'rgba(255,255,255,.10)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);

  // wordmark
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  var titlePx = Math.round(h * 0.20);
  ctx.font = '800 ' + titlePx + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  ctx.letterSpacing = Math.round(titlePx * 0.13) + 'px';
  var tg = ctx.createLinearGradient(0, h * 0.34, 0, h * 0.58);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, GAMES.playbox.key);
  ctx.fillStyle = tg;
  ctx.fillText('PLAYBOX', w / 2, h * 0.585);

  var subPx = Math.round(h * 0.062);
  ctx.font = '500 ' + subPx + 'px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  ctx.letterSpacing = Math.round(subPx * 0.16) + 'px';
  ctx.fillStyle = 'rgba(232,237,247,.70)';
  ctx.fillText('FIVE GAMES · ONE APP · PLAYS OFFLINE', w / 2, h * 0.705);
  ctx.letterSpacing = '0px';

  // the five emblems, evenly spaced above the wordmark
  var size = h * 0.30, gap = size * 0.34;
  var total = SLUGS.length * size + (SLUGS.length - 1) * gap;
  var x0 = w / 2 - total / 2 + size / 2;
  for (var i = 0; i < SLUGS.length; i++) {
    ctx.save();
    ctx.translate(x0 + i * (size + gap), h * 0.245);
    ctx.scale(size, size);
    ctx.lineJoin = 'round';
    EMBLEM[SLUGS[i]](ctx);
    ctx.restore();
  }
}

/* Capacitor splash: centred emblem on the brand gradient */
function drawSplash(ctx, slug, size) {
  bgFill(ctx, slug, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size * 0.30, size * 0.30);
  ctx.lineJoin = 'round';
  EMBLEM[slug](ctx);
  ctx.restore();
}

g.ART = { GAMES: GAMES, SLUGS: SLUGS, drawIcon: drawIcon, drawFeature: drawFeature,
          drawCollectionFeature: drawCollectionFeature, drawSplash: drawSplash };
})(window);
