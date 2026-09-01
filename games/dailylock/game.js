/* ============================================================
   DAILY LOCK — one lock a day, crack it in six.
   Deterministic daily deduction puzzle. All logic in this file.
   ============================================================ */
(function () {
'use strict';

var TAU = Math.PI * 2;
var N = 5, MAXT = 6, NG = 7;
var EPOCH = Date.UTC(2026, 0, 1);          // Day 1 = 2026-01-01

/* ---------------- glyphs ---------------- */
var GLYPHS = [
  { n: 'Circle',   c: '#4ee1c1' },
  { n: 'Triangle', c: '#ffc857' },
  { n: 'Square',   c: '#7c5cff' },
  { n: 'Diamond',  c: '#ff6b6b' },
  { n: 'Hexagon',  c: '#5ab0ff' },
  { n: 'Star',     c: '#ff8ad0' },
  { n: 'Crescent', c: '#9fe870' }
];

/* ---------------- tumbler rules ---------------- */
var RULES = [
  { id: 'ALLDIFF',  name: 'All different',          hint: 'No glyph repeats.',
    bad: 'That repeats a glyph — this lock is ALL DIFFERENT.' },
  { id: 'ADJ',      name: 'No two alike adjacent',  hint: 'Neighbouring dials never match.',
    bad: 'Two neighbours match — not on this lock.' },
  { id: 'MIRROR',   name: 'Mirrored',               hint: 'Dial 1 = dial 5, dial 2 = dial 4.',
    bad: 'Not mirrored — dial 1 must equal dial 5, dial 2 must equal dial 4.' },
  { id: 'ONETWICE', name: 'One repeats twice',      hint: 'Exactly one glyph appears twice; the rest once.',
    bad: 'Needs exactly one glyph twice and three others once.' },
  { id: 'ASC',      name: 'Ascending',              hint: 'Never goes backwards, in keyboard order.',
    bad: 'That goes backwards — glyphs must not decrease left to right.' }
];
var RULEBY = {};
RULES.forEach(function (r) { RULEBY[r.id] = r; });

/* ---------------- pure puzzle logic ---------------- */
function hash32(s) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rngForDate(ds) {
  var seed = hash32('dailylock|' + ds) >>> 0;
  if (!seed) seed = 0x9e3779b9;
  var r = U.seeded(seed);
  for (var i = 0; i < 8; i++) r();          // warm up the xorshift
  return r;
}
function ruleForRng(r) { return RULES[Math.floor(r() * RULES.length) % RULES.length].id; }

function validate(rid, a) {
  var i, j;
  if (rid === 'ALLDIFF') {
    for (i = 0; i < a.length; i++) for (j = i + 1; j < a.length; j++) if (a[i] === a[j]) return false;
    return true;
  }
  if (rid === 'ADJ') {
    for (i = 1; i < a.length; i++) if (a[i] === a[i - 1]) return false;
    return true;
  }
  if (rid === 'MIRROR') return a[0] === a[4] && a[1] === a[3];
  if (rid === 'ASC') {
    for (i = 1; i < a.length; i++) if (a[i] < a[i - 1]) return false;
    return true;
  }
  if (rid === 'ONETWICE') {
    var c = {}, twos = 0, ones = 0, k, keys;
    for (i = 0; i < a.length; i++) c[a[i]] = (c[a[i]] || 0) + 1;
    keys = Object.keys(c);
    for (k = 0; k < keys.length; k++) {
      var v = c[keys[k]];
      if (v === 2) twos++; else if (v === 1) ones++; else return false;
    }
    return twos === 1 && ones === 3;
  }
  return true;
}

function genSecret(rng, rid) {
  var a = [], i, j, t, g, pool;
  if (rid === 'ALLDIFF' || rid === 'ONETWICE') {
    pool = []; for (i = 0; i < NG; i++) pool.push(i);
    for (i = pool.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    if (rid === 'ALLDIFF') a = pool.slice(0, 5);
    else {
      a = pool.slice(0, 4);
      a.push(a[Math.floor(rng() * 4)]);
      for (i = a.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    }
  } else if (rid === 'ADJ') {
    a.push(Math.floor(rng() * NG));
    for (i = 1; i < N; i++) { do { g = Math.floor(rng() * NG); } while (g === a[i - 1]); a.push(g); }
  } else if (rid === 'MIRROR') {
    var b0 = Math.floor(rng() * NG), b1 = Math.floor(rng() * NG), b2 = Math.floor(rng() * NG);
    a = [b0, b1, b2, b1, b0];
  } else { /* ASC */
    for (i = 0; i < N; i++) a.push(Math.floor(rng() * NG));
    a.sort(function (x, y) { return x - y; });
  }
  return a;
}

/* Mastermind marking: 2 = right glyph right place, 1 = right glyph wrong
   place, 0 = absent. Exact matches are claimed first, then the remainder
   is matched by multiset — the standard duplicate-safe algorithm. */
function scoreGuess(secret, guess) {
  var n = secret.length, marks = new Array(n), pool = {}, i, s;
  for (i = 0; i < n; i++) {
    if (guess[i] === secret[i]) marks[i] = 2;
    else { marks[i] = 0; s = secret[i]; pool[s] = (pool[s] || 0) + 1; }
  }
  for (i = 0; i < n; i++) {
    if (marks[i] !== 0) continue;
    var g = guess[i];
    if (pool[g] > 0) { marks[i] = 1; pool[g]--; }
  }
  return marks;
}

function utcToday() { return new Date().toISOString().slice(0, 10); }
function dayNumber(ds) {
  var p = ds.split('-');
  return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - EPOCH) / 86400000) + 1;
}

/* expose for the node test harness */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreGuess: scoreGuess, validate: validate, genSecret: genSecret,
                     hash32: hash32, RULES: RULES, dayNumber: dayNumber,
                     rngForDate: rngForDate, ruleForRng: ruleForRng };
}

/* ============================================================
   From here on: browser only.
   ============================================================ */
if (typeof document === 'undefined') return;

/* ---------------- persistence ---------------- */
function loadStats() {
  var d = Store.get('stats', null);
  if (!d || !d.dist || d.dist.length !== MAXT) {
    d = { played: 0, solved: 0, dist: [0, 0, 0, 0, 0, 0], streak: 0, maxStreak: 0, lastWin: -99, lastPlay: -99 };
  }
  return d;
}
function saveStats(d) { Store.set('stats', d); }
function shownStreak(st, today) {
  if (st.lastWin === today || st.lastWin === today - 1) return st.streak;
  return 0;
}

/* ---------------- game state ---------------- */
var S = {
  mode: 'daily', day: 1, dateStr: '', ruleId: 'ALLDIFF', secret: [],
  guesses: [], cur: [null, null, null, null, null],
  done: false, won: false, revealed: [], live: false
};
var dials = [];
for (var di = 0; di < N; di++) dials.push({ show: null, prev: null, p: 1 });
var anim = { shake: 0, win: 0, winning: false, lose: 0, flash: 0, sparks: [] };
for (var si = 0; si < 26; si++) anim.sparks.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, c: '#fff' });

/* ---------------- DOM ---------------- */
var $ = function (id) { return document.getElementById(id); };
var elKeys = $('keys'), elSubmit = $('btnSubmit'), elClear = $('btnClear'),
    elReveal = $('btnReveal'), elChip = $('ruleChip'), elTries = $('hudTries'),
    elPad = $('pad');

/* ---------------- canvas glyph drawing ---------------- */
function poly(ctx, x, y, r, n, rot) {
  for (var i = 0; i < n; i++) {
    var a = rot + i * TAU / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function starPath(ctx, x, y, R, r, n) {
  for (var i = 0; i < n * 2; i++) {
    var rad = (i % 2) ? r : R, a = -Math.PI / 2 + i * Math.PI / n;
    var px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function drawGlyph(ctx, gi, x, y, r, alpha, glow) {
  var g = GLYPHS[gi];
  ctx.save();
  ctx.globalAlpha = (alpha == null) ? 1 : alpha;
  ctx.fillStyle = g.c;
  if (glow) { ctx.shadowColor = g.c; ctx.shadowBlur = glow; }
  if (gi === 6) {                                   // crescent: outer arc + bite arc
    ctx.translate(x, y); ctx.rotate(-0.30);
    ctx.beginPath();
    ctx.arc(0, 0, r, 1.2907, TAU - 1.2907, false);
    ctx.arc(r * 0.55, 0, r, -1.8509, 1.8509, true);
    ctx.closePath();
    ctx.fill();
  } else if (gi === 2) {
    U.rr(ctx, x - r * 0.82, y - r * 0.82, r * 1.64, r * 1.64, r * 0.24); ctx.fill();
  } else {
    ctx.beginPath();
    if (gi === 0) ctx.arc(x, y, r, 0, TAU);
    else if (gi === 1) poly(ctx, x, y + r * 0.14, r * 1.14, 3, -Math.PI / 2);
    else if (gi === 3) poly(ctx, x, y, r * 1.10, 4, -Math.PI / 2);
    else if (gi === 4) poly(ctx, x, y, r * 1.02, 6, -Math.PI / 2);
    else if (gi === 5) starPath(ctx, x, y, r * 1.12, r * 0.47, 5);
    ctx.fill();
  }
  ctx.restore();
}
/* mark = 2 solid ring | 1 hollow ring | 0 dim */
function drawMark(ctx, mark, x, y, r) {
  ctx.save();
  if (mark === 2) {
    ctx.strokeStyle = '#4ee1c1'; ctx.lineWidth = Math.max(3, r * 0.22);
    ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, TAU); ctx.stroke();
  } else if (mark === 1) {
    ctx.strokeStyle = '#ffc857'; ctx.lineWidth = Math.max(1.3, r * 0.08);
    ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, TAU); ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}
function markAlpha(m) { return m === 2 ? 1 : m === 1 ? 0.95 : 0.24; }

/* small standalone canvases (keyboard, legend, combo) */
function paintTile(cv, draw) {
  var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  var w = cv.clientWidth || +cv.getAttribute('width') || 34;
  var h = cv.clientHeight || +cv.getAttribute('height') || 34;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  var c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  draw(c, w, h);
}

/* ---------------- layout ---------------- */
var LY = {};
function layout(w, h) {
  LY.w = w; LY.h = h;
  LY.lockH = U.clamp(h * 0.52, 230, 340);
  LY.lockTop = h - LY.lockH;
  LY.bodyW = Math.min(w - 22, 350);
  LY.bodyH = Math.min(LY.lockH * 0.70, 190);
  LY.bodyX = (w - LY.bodyW) / 2;
  LY.bodyY = LY.lockTop + LY.lockH - LY.bodyH - 10;
  LY.sr = LY.bodyW * 0.22;
  LY.dialR = Math.min((LY.bodyW - 26) / (N * 2.26), LY.bodyH * 0.30);
  /* a zero-size frame (being shown, or mid-rotation) would make this negative,
     and the dial-face radial gradient then throws */
  if (!(LY.dialR > 0.5)) LY.dialR = 0.5;
  LY.step = LY.dialR * 2.26;
  LY.dialY = LY.bodyY + LY.bodyH * 0.42;
  LY.shackleTop = LY.bodyY + 4 - LY.sr * 1.30;
  LY.histTopArea = Math.max(60, LY.shackleTop - 12);
  LY.rowH = U.clamp(LY.histTopArea / MAXT, 22, 44);
  LY.histY = Math.max(4, (LY.histTopArea - LY.rowH * MAXT) / 2);
  LY.cellW = Math.min(54, (w - 32) / N);
}
function dialX(i) { return LY.bodyX + LY.bodyW / 2 + (i - (N - 1) / 2) * LY.step; }

/* ---------------- history rows ---------------- */
function drawHistory(ctx) {
  var i, k, y, x0 = LY.w / 2 - (LY.cellW * N) / 2, r = Math.min(LY.cellW, LY.rowH) * 0.36;
  var fade = 1 - anim.win * 0.85;
  ctx.save();
  ctx.globalAlpha = fade;
  for (i = 0; i < MAXT; i++) {
    y = LY.histY + LY.rowH * i + LY.rowH / 2;
    if (i < S.guesses.length) {
      var g = S.guesses[i], m = scoreGuess(S.secret, g);
      for (k = 0; k < N; k++) {
        var cx = x0 + LY.cellW * (k + 0.5);
        drawMark(ctx, m[k], cx, y, r);
        drawGlyph(ctx, g[k], cx, y, r * 0.56, markAlpha(m[k]), m[k] === 2 ? 8 : 0);
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.lineWidth = 1;
      for (k = 0; k < N; k++) {
        var ex = x0 + LY.cellW * (k + 0.5);
        ctx.beginPath(); ctx.arc(ex, y, r * 0.92, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.beginPath(); ctx.arc(ex, y, 1.7, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/* ---------------- the lock ---------------- */
function metal(ctx, x0, y0, x1, y1) {
  var g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#3a4560');
  g.addColorStop(0.28, '#232c44');
  g.addColorStop(0.5, '#161d31');
  g.addColorStop(0.72, '#242e48');
  g.addColorStop(1, '#111726');
  return g;
}
function drawShackle(ctx, t) {
  var lift = anim.win * 46;
  var tilt = anim.win * 0.20;
  var cx = LY.bodyX + LY.bodyW / 2, top = LY.bodyY + 4, sr = LY.sr;
  var lw = Math.max(11, sr * 0.30);
  ctx.save();
  ctx.translate(cx - sr, top);
  ctx.rotate(-tilt);
  ctx.translate(-(cx - sr), -top + -lift);
  ctx.lineCap = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = metal(ctx, cx - sr, top - sr * 1.6, cx + sr, top);
  ctx.beginPath();
  ctx.moveTo(cx - sr, top);
  ctx.lineTo(cx - sr, top - sr * 0.30);
  ctx.arc(cx, top - sr * 0.30, sr, Math.PI, 0);
  ctx.lineTo(cx + sr, top);
  ctx.stroke();
  ctx.lineWidth = Math.max(2, lw * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.beginPath();
  ctx.moveTo(cx - sr + lw * 0.28, top);
  ctx.lineTo(cx - sr + lw * 0.28, top - sr * 0.30);
  ctx.arc(cx, top - sr * 0.30, sr - lw * 0.28, Math.PI, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
}
function drawBody(ctx) {
  var x = LY.bodyX, y = LY.bodyY, w = LY.bodyW, h = LY.bodyH, i;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
  U.rr(ctx, x, y, w, h, 22);
  ctx.fillStyle = metal(ctx, x, y, x + w * 0.2, y + h);
  ctx.fill();
  ctx.restore();

  /* brushed streaks */
  ctx.save();
  U.rr(ctx, x, y, w, h, 22); ctx.clip();
  ctx.globalAlpha = 0.05; ctx.strokeStyle = '#cfe0ff'; ctx.lineWidth = 1;
  for (i = 0; i < 26; i++) {
    var yy = y + (i + 0.5) * (h / 26);
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  var gl = ctx.createLinearGradient(x, y, x, y + h * 0.5);
  gl.addColorStop(0, 'rgba(255,255,255,.13)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(x, y, w, h * 0.5);
  ctx.restore();

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  U.rr(ctx, x + 0.6, y + 0.6, w - 1.2, h - 1.2, 22); ctx.stroke();

  /* recessed dial channel */
  var chY = LY.dialY - LY.dialR - 9, chH = LY.dialR * 2 + 18;
  U.rr(ctx, x + 9, chY, w - 18, chH, 14);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
}
function drawDial(ctx, i, t) {
  var x = dialX(i), y = LY.dialY, R = LY.dialR, d = dials[i];
  ctx.save();
  /* ring */
  var rg = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
  rg.addColorStop(0, '#4a5573'); rg.addColorStop(0.45, '#1c2438');
  rg.addColorStop(0.6, '#39435f'); rg.addColorStop(1, '#141a2b');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  /* knurling */
  ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
  for (var k = 0; k < 24; k++) {
    var a = k * TAU / 24 + (d.p < 1 ? (1 - d.p) * 0.5 : 0);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * R * 0.86, y + Math.sin(a) * R * 0.86);
    ctx.lineTo(x + Math.cos(a) * R * 0.99, y + Math.sin(a) * R * 0.99);
    ctx.stroke();
  }
  /* face */
  var fr = R * 0.78;
  var fg = ctx.createRadialGradient(x - fr * 0.3, y - fr * 0.4, fr * 0.1, x, y, fr);
  fg.addColorStop(0, '#141b2c'); fg.addColorStop(1, '#070b14');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.arc(x, y, fr, 0, TAU); ctx.fill();

  /* drum-roll clipped glyph area */
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, fr - 1, 0, TAU); ctx.clip();
  var p = d.p, gr = R * 0.46;
  if (d.prev !== null && p < 1) {
    var sq = 1 - 0.30 * Math.sin(p * Math.PI);
    ctx.save(); ctx.translate(x, y - p * fr * 2.1); ctx.scale(1, sq);
    drawGlyph(ctx, d.prev, 0, 0, gr, 0.85, 0); ctx.restore();
  }
  if (d.show !== null) {
    var sq2 = 1 - 0.30 * Math.sin(p * Math.PI);
    var glow = 10 + (anim.winning ? 16 * anim.win : 0);
    ctx.save(); ctx.translate(x, y + (1 - p) * fr * 2.1); ctx.scale(1, sq2);
    drawGlyph(ctx, d.show, 0, 0, gr, 1, glow); ctx.restore();
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - gr * 0.5, y); ctx.lineTo(x + gr * 0.5, y);
    ctx.stroke();
  }
  ctx.restore();

  /* rim highlight, brighter on the win */
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = anim.winning
    ? 'rgba(78,225,193,' + (0.25 + 0.7 * anim.win).toFixed(3) + ')'
    : 'rgba(255,255,255,.13)';
  if (anim.winning) { ctx.shadowColor = '#4ee1c1'; ctx.shadowBlur = 18 * anim.win; }
  ctx.beginPath(); ctx.arc(x, y, fr + 2, 0, TAU); ctx.stroke();
  ctx.restore();

  /* revealed-position badge */
  if (S.revealed.indexOf(i) >= 0) {
    var by = LY.dialY + LY.dialR + Math.min(16, LY.bodyH * 0.09), br = Math.min(11, LY.dialR * 0.38);
    ctx.save();
    ctx.strokeStyle = '#ffc857'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, by, br + 3, 0, TAU); ctx.stroke();
    drawGlyph(ctx, S.secret[i], x, by, br * 0.8, 1, 6);
    ctx.restore();
  }
}
function drawPlate(ctx) {
  var cx = LY.bodyX + LY.bodyW / 2, y = LY.bodyY + LY.bodyH - 13;
  ctx.save();
  ctx.font = '700 10px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.30)';
  var label = S.done
    ? (S.won ? 'OPEN' : 'LOCKED')
    : (S.mode === 'daily' ? 'LOCK #' + S.day : 'PRACTICE');
  ctx.letterSpacing = '2px';
  ctx.fillText(label, cx, y);
  ctx.restore();
}
function drawSparks(ctx, dt) {
  var i, s;
  for (i = 0; i < anim.sparks.length; i++) {
    s = anim.sparks[i];
    if (s.life <= 0) continue;
    s.life -= dt;
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 340 * dt;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 1.6));
    ctx.fillStyle = s.c;
    ctx.beginPath(); ctx.arc(s.x, s.y, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
function burst() {
  var cx = LY.bodyX + LY.bodyW / 2, cy = LY.bodyY - LY.sr * 0.6;
  for (var i = 0; i < anim.sparks.length; i++) {
    var s = anim.sparks[i], a = U.rand(-Math.PI, 0), v = U.rand(90, 260);
    s.x = cx + U.rand(-LY.sr, LY.sr); s.y = cy;
    s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v - 60;
    s.life = U.rand(0.6, 1.15);
    s.c = U.pick(['#4ee1c1', '#ffc857', '#7c5cff', '#ffffff']);
  }
}

/* ---------------- engine ---------------- */
var eng = Engine('cv');
eng.onResize = function (w, h) { layout(w, h); };
eng.onUpdate = function (dt) {
  var i;
  for (i = 0; i < N; i++) if (dials[i].p < 1) dials[i].p = Math.min(1, dials[i].p + dt * 4.6);
  if (anim.shake > 0) anim.shake = Math.max(0, anim.shake - dt * 3.4);
  if (anim.flash > 0) anim.flash = Math.max(0, anim.flash - dt * 1.6);
  if (anim.winning && anim.win < 1) anim.win = Math.min(1, anim.win + dt * 0.85);
  if (anim.lose > 0) anim.lose = Math.max(0, anim.lose - dt * 0.8);
};
eng.onRender = function (ctx, w, h, t) {
  if (!LY.w) layout(w, h);
  ctx.clearRect(0, 0, w, h);

  /* backdrop */
  var bg = ctx.createRadialGradient(w / 2, h * 0.9, 10, w / 2, h * 0.75, h * 0.8);
  bg.addColorStop(0, '#101a2c'); bg.addColorStop(1, '#080b14');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  if (anim.flash > 0) {
    ctx.save(); ctx.globalAlpha = anim.flash * 0.18;
    ctx.fillStyle = '#4ee1c1'; ctx.fillRect(0, 0, w, h); ctx.restore();
  }

  drawHistory(ctx);

  var sh = anim.shake > 0 ? Math.sin(anim.shake * 46) * anim.shake * 11 : 0;
  ctx.save();
  ctx.translate(sh, 0);
  drawShackle(ctx, t);
  drawBody(ctx);
  for (var i = 0; i < N; i++) drawDial(ctx, i, t);
  drawPlate(ctx);
  ctx.restore();

  drawSparks(ctx, Math.min(0.05, 1 / 60));

  if (anim.winning && anim.win > 0.35) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (anim.win - 0.35) / 0.35);
    ctx.font = '800 22px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'center'; ctx.fillStyle = '#4ee1c1';
    ctx.shadowColor = '#4ee1c1'; ctx.shadowBlur = 18;
    ctx.letterSpacing = '5px';
    ctx.fillText('OPEN', w / 2, Math.max(26, LY.bodyY - LY.sr * 1.5 - 44));
    ctx.restore();
  }
};

/* canvas taps: tap a filled dial to clear it */
Input(eng.canvas, {
  down: function (x, y) {
    if (!S.live || S.done) return;
    for (var i = 0; i < N; i++) {
      if (U.dist(x, y, dialX(i), LY.dialY) <= LY.dialR * 1.25) {
        if (S.cur[i] !== null) { setDial(i, null); Sound.tone(300, 0.05, 'square', 0.07); Buzz(8); }
        return;
      }
    }
  }
});

/* ---------------- input plumbing ---------------- */
function setDial(i, g) {
  var d = dials[i];
  if (S.cur[i] !== g) { d.prev = S.cur[i]; d.show = g; d.p = 0; }
  S.cur[i] = g;
  refreshPad();
  saveDaily();
}
function pressGlyph(g) {
  if (!S.live || S.done) return;
  for (var i = 0; i < N; i++) {
    if (S.cur[i] === null) {
      setDial(i, g);
      Sound.tone(430 + i * 40, 0.05, 'square', 0.08);
      Buzz(9);
      return;
    }
  }
  UI.toast('All five dials are set — hit submit.');
}
function clearAll() {
  if (!S.live || S.done) return;
  for (var i = 0; i < N; i++) if (S.cur[i] !== null) setDial(i, null);
  Sound.tone(240, 0.07, 'square', 0.07);
}
function refreshPad() {
  var full = S.cur.indexOf(null) < 0;
  elSubmit.disabled = !full || S.done || !S.live;
  elTries.textContent = (S.done ? S.guesses.length : Math.min(S.guesses.length + 1, MAXT)) + '/' + MAXT;
  var freeReveal = PB.peekBoost('dailylock_reveal') > 0;
  elReveal.textContent = freeReveal ? 'Reveal one dial (1 token boost)' : 'Watch ad \u2192 reveal one dial';
  /* One rewarded offer per lock, in practice as well as the daily. Four
     rewarded views per puzzle on unlimited practice puzzles is exactly the
     impression pattern AdMob flags as invalid traffic, and the contract asks
     for one offer per game. */
  var canReveal = !S.done && S.live && (freeReveal || Ads.isRewardedReady()) &&
      S.revealed.length === 0 &&
      (S.mode === 'practice' || S.guesses.length >= 3);
  elReveal.style.display = canReveal ? 'block' : 'none';
  /* dim keys proven absent */
  var absent = {};
  for (var k = 0; k < S.guesses.length; k++) {
    var m = scoreGuess(S.secret, S.guesses[k]);
    for (var j = 0; j < N; j++) if (m[j] === 0 && S.guesses[k].indexOf(S.guesses[k][j]) === j) {
      var g = S.guesses[k][j], any = false;
      for (var q = 0; q < N; q++) if (S.guesses[k][q] === g && m[q] !== 0) any = true;
      if (!any) absent[g] = 1;
    }
  }
  var btns = elKeys.children;
  for (var b = 0; b < btns.length; b++) btns[b].classList.toggle('gone', !!absent[b]);
}

/* ---------------- submit ---------------- */
function submit() {
  if (!S.live || S.done) return;
  if (S.cur.indexOf(null) >= 0) return;
  var guess = S.cur.slice();
  if (!validate(S.ruleId, guess)) {
    anim.shake = 1;
    Sound.bad(); Buzz(40);
    UI.toast(RULEBY[S.ruleId].bad, 2200);
    elPad.classList.remove('shk');
    void elPad.offsetWidth;
    elPad.classList.add('shk');
    return;
  }
  S.guesses.push(guess);
  S.cur = [null, null, null, null, null];
  for (var i = 0; i < N; i++) { dials[i].prev = guess[i]; dials[i].show = null; dials[i].p = 0; }
  Sound.tone(92, 0.20, 'square', 0.17, 58);
  Sound.noise(0.09, 0.07);
  Buzz(26);
  saveDaily();
  refreshPad();

  var m = scoreGuess(S.secret, guess), solved = true;
  for (var k = 0; k < N; k++) if (m[k] !== 2) solved = false;

  if (solved) { win(); }
  else if (S.guesses.length >= MAXT) { lose(); }
  else { anim.flash = 0.5; }
}

function win() {
  S.done = true; S.won = true;
  for (var i = 0; i < N; i++) { dials[i].prev = null; dials[i].show = S.secret[i]; dials[i].p = 0; }
  anim.winning = true; anim.win = 0;
  PB.report(S.mode === 'daily' ? 'daily' : 'practice',
            { won: true, tries: S.guesses.length });
  refreshPad();
  saveDaily();
  finishStats(true);
  setTimeout(function () { burst(); Sound.great(); Buzz(60); }, 520);
  Sound.tone(300, 0.4, 'sine', 0.10, 900);
  setTimeout(function () { showResults(); }, 2000);
}
function lose() {
  S.done = true; S.won = false;
  for (var i = 0; i < N; i++) { dials[i].prev = null; dials[i].show = S.secret[i]; dials[i].p = 0; }
  anim.lose = 1;
  PB.report(S.mode === 'daily' ? 'daily' : 'practice',
            { won: false, tries: S.guesses.length });
  refreshPad();
  saveDaily();
  finishStats(false);
  Sound.bad();
  setTimeout(function () { showResults(); }, 1500);
}
function finishStats(won) {
  if (S.mode !== 'daily') return;
  var st = loadStats();
  if (st.lastPlay === S.day) return;             // never double count
  st.played++;
  st.lastPlay = S.day;
  if (won) {
    st.solved++;
    st.dist[S.guesses.length - 1]++;
    st.streak = (st.lastWin === S.day - 1) ? st.streak + 1 : 1;
    st.lastWin = S.day;
    if (st.streak > st.maxStreak) st.maxStreak = st.streak;
  } else {
    st.streak = 0;
  }
  saveStats(st);
}

/* ---------------- persistence of the live daily ---------------- */
function saveDaily() {
  if (S.mode !== 'daily') return;
  Store.set('daily', {
    day: S.day, guesses: S.guesses, cur: S.cur,
    done: S.done, won: S.won, revealed: S.revealed
  });
}
function loadDaily(day) {
  var d = Store.get('daily', null);
  if (!d || d.day !== day) return null;
  return d;
}

/* ---------------- puzzle setup ---------------- */
function buildDaily() {
  var ds = utcToday(), r = rngForDate(ds);
  S.mode = 'daily'; S.dateStr = ds; S.day = dayNumber(ds);
  S.ruleId = ruleForRng(r);
  S.secret = genSecret(r, S.ruleId);
  var sv = loadDaily(S.day);
  S.guesses = sv ? sv.guesses : [];
  S.cur = sv && sv.cur ? sv.cur.slice() : [null, null, null, null, null];
  S.done = sv ? !!sv.done : false;
  S.won = sv ? !!sv.won : false;
  S.revealed = sv && sv.revealed ? sv.revealed : [];
  syncDials();
}
function buildPractice() {
  S.mode = 'practice';
  var r = U.seeded((Math.random() * 4294967295) >>> 0);
  for (var i = 0; i < 6; i++) r();
  S.ruleId = ruleForRng(r);
  S.secret = genSecret(r, S.ruleId);
  S.guesses = []; S.cur = [null, null, null, null, null];
  S.done = false; S.won = false; S.revealed = [];
  syncDials();
}
function syncDials() {
  for (var i = 0; i < N; i++) {
    dials[i].prev = null;
    dials[i].show = S.done ? S.secret[i] : S.cur[i];
    dials[i].p = 1;
  }
  anim.winning = S.done && S.won; anim.win = anim.winning ? 1 : 0;
}

/* ---------------- screens ---------------- */
var cdTimer = null;
function stopCd() { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } }

function showScreen(id) {
  document.body.classList.remove('playing');
  S.live = false;
  eng.stop();
  UI.show(id);
  Ads.showBanner();
  if (id !== 'over') stopCd();
}
function showMenu() {
  stopCd();
  showScreen('menu');
  var st = loadStats(), today = dayNumber(utcToday());
  $('mNum').textContent = 'Lock #' + today + ' · ' + utcToday();
  $('mStreak').textContent = shownStreak(st, today);
  var d = loadDaily(today);
  $('btnDaily').textContent = (d && d.done) ? "See today's result" : "Play today's lock";
}

function openPuzzle(mode) {
  stopCd();
  if (mode === 'daily') buildDaily(); else buildPractice();
  if (S.mode === 'daily' && S.done) { showResults(); return; }
  Ads.hideBanner();
  UI.hide();
  document.body.classList.add('playing');
  S.live = true;
  elChip.innerHTML = '<span>' + RULEBY[S.ruleId].name + '</span><small>' + RULEBY[S.ruleId].hint + '</small>';
  refreshPad();
  eng.resize();
  eng.start();
  if (S.mode === 'daily' && !Store.get('coached', false)) startCoach();
}

/* ---------------- results ---------------- */
function bars(host, st, hi) {
  host.innerHTML = '';
  var max = 1, i;
  for (i = 0; i < MAXT; i++) max = Math.max(max, st.dist[i]);
  for (i = 0; i < MAXT; i++) {
    var row = document.createElement('div'); row.className = 'hrow';
    var lab = document.createElement('i'); lab.textContent = (i + 1);
    var bar = document.createElement('div');
    bar.className = 'hbar' + (hi === i + 1 ? ' me' : '');
    bar.style.width = (9 + 91 * st.dist[i] / max) + '%';
    bar.textContent = st.dist[i];
    row.appendChild(lab); row.appendChild(bar); host.appendChild(row);
  }
}
function statCells(host, st, today) {
  var pct = st.played ? Math.round(st.solved / st.played * 100) : 0;
  var cells = [[st.played, 'Played'], [pct + '%', 'Win %'],
               [shownStreak(st, today), 'Streak'], [st.maxStreak, 'Max']];
  host.innerHTML = '';
  cells.forEach(function (c) {
    var d = document.createElement('div');
    var b = document.createElement('b'); b.textContent = c[0];
    var s = document.createElement('span'); s.textContent = c[1];
    d.appendChild(b); d.appendChild(s); host.appendChild(d);
  });
}
function showResults() {
  var st = loadStats(), today = dayNumber(utcToday());
  showScreen('over');
  var daily = S.mode === 'daily';
  $('oTitle').textContent = S.won ? ('Cracked in ' + S.guesses.length) : 'Locked out';
  $('oSub').textContent = S.won
    ? (daily ? 'Lock #' + S.day + ' · ' + RULEBY[S.ruleId].name : 'Practice lock · ' + RULEBY[S.ruleId].name)
    : 'The combination was:';

  var combo = $('oCombo');
  combo.innerHTML = '';
  if (!S.won) {
    S.secret.forEach(function (g) {
      var cv = document.createElement('canvas');
      cv.width = 40; cv.height = 40; combo.appendChild(cv);
      paintTile(cv, function (c, w, h) { drawGlyph(c, g, w / 2, h / 2, w * 0.34, 1, 8); });
    });
  }
  $('oGrid').textContent = markGrid();
  statCells($('oStats'), st, today);
  bars($('oHist'), st, (daily && S.won) ? S.guesses.length : 0);

  $('btnShare').style.display = daily ? '' : 'none';
  var cd = $('oCd');
  if (daily) {
    cd.style.display = '';
    tickCd();
    stopCd();
    cdTimer = setInterval(tickCd, 1000);
  } else { cd.style.display = 'none'; }
}
function tickCd() {
  var now = new Date();
  var next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  var s = Math.max(0, Math.floor((next - now.getTime()) / 1000));
  var hh = String(Math.floor(s / 3600)).padStart(2, '0');
  var mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  var ss = String(s % 60).padStart(2, '0');
  $('oCd').innerHTML = 'Next lock in <b>' + hh + ':' + mm + ':' + ss + '</b>';
}

/* ---------------- share ---------------- */
function markGrid() {
  var out = [];
  for (var i = 0; i < S.guesses.length; i++) {
    var m = scoreGuess(S.secret, S.guesses[i]), row = '';
    for (var k = 0; k < N; k++) row += (m[k] === 2 ? '\u25cf' : m[k] === 1 ? '\u25cb' : '\u00b7');
    out.push(row);
  }
  return out.join('\n');
}
function shareText() {
  var head = 'Daily Lock #' + S.day + ' ' + (S.won ? S.guesses.length : 'X') + '/' + MAXT;
  var lines = [head, RULEBY[S.ruleId].name.toUpperCase(), markGrid()];
  return lines.join('\n');
}
function legacyCopy(txt) {
  try {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, txt.length);
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}
function doShare() {
  var txt = shareText();
  var done = function (ok) {
    if (ok) { UI.toast('Result copied — go brag.'); Sound.ping(); }
    else UI.toast('Copy failed. Long-press to select instead.');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function () { done(true); },
      function () { done(legacyCopy(txt)); });
  } else {
    done(legacyCopy(txt));
  }
}

/* ---------------- rewarded reveal ---------------- */
function doReveal() {
  if (elReveal.disabled) return;
  elReveal.disabled = true;            // a fast double-tap must not spend twice
  /* Nothing to reveal? Say so before spending anything. */
  var open = 0, j;
  for (j = 0; j < N; j++) if (S.revealed.indexOf(j) < 0) open++;
  if (!open) { elReveal.disabled = false; refreshPad(); return; }

  /* A token boost reveals a dial with no ad. */
  if (PB.takeBoost('dailylock_reveal', 1) > 0) { elReveal.disabled = false; grantReveal(); return; }
  if (!Ads.isRewardedReady()) {
    elReveal.disabled = false;
    UI.toast('No ad available right now.'); refreshPad(); return;
  }
  Ads.showRewarded().then(function (earned) {
    elReveal.disabled = false;
    if (!earned) { UI.toast('Reward not earned.'); refreshPad(); return; }
    grantReveal();
  }, function () {
    elReveal.disabled = false;
    UI.toast('No ad available right now.'); refreshPad();
  });
}
function grantReveal() {
  (function () {
    var choices = [], i;
    for (i = 0; i < N; i++) if (S.revealed.indexOf(i) < 0) choices.push(i);
    if (!choices.length) { refreshPad(); return; }
    var p = choices[Math.floor(Math.random() * choices.length)];
    S.revealed.push(p);
    if (S.cur[p] === null) setDial(p, S.secret[p]);
    Sound.good(); Buzz(30);
    UI.toast('Dial ' + (p + 1) + ' revealed.');
    saveDaily(); refreshPad();
  })();
}

/* ---------------- coach marks ---------------- */
var COACH = [
  ['Fill the dials', 'Tap a glyph below to drop it on the next open dial. Tap a dial to clear it. Five dials, then submit.'],
  ['Read the marks', 'Solid ring = right glyph in the right spot. Hollow ring = right glyph, wrong spot. Dim = not in the lock at all. Shapes, not colours.'],
  ['Use the tumbler', 'Every lock states one structural rule up front. The secret obeys it, and guesses that break it are handed back free — no attempt lost.']
];
var coachI = 0;
function startCoach() { coachI = 0; paintCoach(); $('coach').classList.add('on'); }
function paintCoach() {
  $('cTitle').textContent = COACH[coachI][0];
  $('cBody').textContent = COACH[coachI][1];
  var dots = $('cDots').children;
  for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === coachI);
  $('cNext').textContent = coachI === COACH.length - 1 ? 'Got it' : 'Next';
}
function endCoach() { $('coach').classList.remove('on'); Store.set('coached', true); }

/* ---------------- build the keyboard + static art ---------------- */
(function buildKeys() {
  for (var i = 0; i < NG; i++) {
    (function (g) {
      var b = document.createElement('button');
      b.className = 'key';
      b.setAttribute('aria-label', GLYPHS[g].n);
      var cv = document.createElement('canvas');
      cv.width = 34; cv.height = 34;
      b.appendChild(cv);
      b.addEventListener('click', function () { pressGlyph(g); });
      elKeys.appendChild(b);
      paintTile(cv, function (c, w, h) { drawGlyph(c, g, w / 2, h / 2, w * 0.36, 1, 7); });
    })(i);
  }
})();

(function buildFlame() {
  var cv = $('flameCv');
  paintTile(cv, function (c, w, h) {
    var x = w / 2, y = h / 2;
    c.fillStyle = '#ffc857'; c.shadowColor = '#ffc857'; c.shadowBlur = 10;
    c.beginPath();
    c.moveTo(x, y - h * 0.40);
    c.bezierCurveTo(x + w * 0.34, y - h * 0.06, x + w * 0.26, y + h * 0.40, x, y + h * 0.40);
    c.bezierCurveTo(x - w * 0.26, y + h * 0.40, x - w * 0.34, y - h * 0.06, x, y - h * 0.40);
    c.fill();
    c.shadowBlur = 0; c.fillStyle = '#ff6b6b';
    c.beginPath();
    c.moveTo(x, y - h * 0.06);
    c.bezierCurveTo(x + w * 0.16, y + h * 0.12, x + w * 0.12, y + h * 0.36, x, y + h * 0.36);
    c.bezierCurveTo(x - w * 0.12, y + h * 0.36, x - w * 0.16, y + h * 0.12, x, y - h * 0.06);
    c.fill();
  });
})();

(function buildLegend() {
  var host = $('howLegend');
  var rows = [[2, 'Solid ring — right glyph, right dial.'],
              [1, 'Hollow ring — right glyph, wrong dial.'],
              [0, 'Dim, no ring — not in this lock.']];
  rows.forEach(function (r, idx) {
    var d = document.createElement('div'); d.className = 'lg';
    var cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
    var sp = document.createElement('span'); sp.textContent = r[1];
    d.appendChild(cv); d.appendChild(sp); host.appendChild(d);
    paintTile(cv, function (c, w, h) {
      drawMark(c, r[0], w / 2, h / 2, w * 0.42);
      drawGlyph(c, idx === 0 ? 0 : idx === 1 ? 5 : 3, w / 2, h / 2, w * 0.22, markAlpha(r[0]), 0);
    });
  });
})();

/* ---------------- wiring ---------------- */
var adsBooted = false;
function bootAds() {
  if (adsBooted) return;
  adsBooted = true;
  Promise.resolve(Ads.init()).then(function () { refreshPad(); }, function () {});
}
document.addEventListener('pointerdown', bootAds, { once: true, passive: true });
document.addEventListener('click', bootAds, { once: true });

$('btnDaily').addEventListener('click', function () { openPuzzle('daily'); });
$('btnPractice').addEventListener('click', function () { openPuzzle('practice'); });
$('btnPractice2').addEventListener('click', function () { openPuzzle('practice'); });
$('btnStats').addEventListener('click', function () {
  var st = loadStats(), today = dayNumber(utcToday());
  showScreen('stats');
  statCells($('sStats'), st, today);
  bars($('sHist'), st, 0);
});
$('btnHow').addEventListener('click', function () { showScreen('howto'); });
$('btnMenu2').addEventListener('click', showMenu);
$('btnMenu3').addEventListener('click', showMenu);
$('btnMenu4').addEventListener('click', showMenu);
$('btnBack').addEventListener('click', function () { saveDaily(); showMenu(); });
$('btnSubmit').addEventListener('click', submit);
$('btnClear').addEventListener('click', clearAll);
$('btnReveal').addEventListener('click', doReveal);
$('btnShare').addEventListener('click', doShare);
$('cNext').addEventListener('click', function () {
  if (coachI < COACH.length - 1) { coachI++; paintCoach(); } else endCoach();
});
$('cSkip').addEventListener('click', endCoach);
$('btnMute').addEventListener('click', function () {
  var m = Sound.toggle();
  $('btnMute').textContent = m ? '🔇' : '🔊';
  UI.toast(m ? 'Sound off' : 'Sound on', 900);
});
$('btnMute').textContent = Sound.muted ? '🔇' : '🔊';

/* practice completions feed the interstitial pacer */
var origShow = showResults;
showResults = function () {
  if (S.mode === 'practice') {
    Promise.resolve(Ads.maybeInterstitial()).then(function () { origShow(); }, function () { origShow(); });
  } else origShow();
};

window.Game = {
  onBackground: function () { saveDaily(); stopCd(); }
};

/* Coming back from the app switcher must restart the "next lock in HH:MM:SS"
   countdown, otherwise it is frozen at whatever time you left. */
document.addEventListener('visibilitychange', function () {
  if (document.hidden) return;
  var cdEl = $('oCd');          // `cd` in showResults() is function-scoped
  if (S.done && cdEl && cdEl.style.display !== 'none' && !cdTimer) {
    tickCd();
    cdTimer = setInterval(tickCd, 1000);
  }
});

/* debug/test hook — no console noise */
window.DailyLock = {
  score: scoreGuess, validate: validate, gen: genSecret,
  ruleForRng: ruleForRng, rngForDate: rngForDate, dayNumber: dayNumber,
  state: S, RULES: RULES, LY: LY, dialX: dialX
};

showMenu();
})();
