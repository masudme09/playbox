/* ============================================================
   Playbox mini-engine — canvas, loop, input, storage, audio.
   No dependencies, no assets. Shared by all five games.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- persistent storage ---------------- */
  var NS = (global.GAME_ID || 'game') + ':';
  var Store = {
    get: function (k, dflt) {
      try {
        var v = localStorage.getItem(NS + k);
        return v === null ? dflt : JSON.parse(v);
      } catch (e) { return dflt; }
    },
    set: function (k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {}
    },
    bump: function (k, v) {                    // keep a high score
      if (v > Store.get(k, 0)) { Store.set(k, v); return true; }
      return false;
    }
  };

  /* ---------------- synthesised audio (no files) ---------------- */
  var actx = null, muted = Store.get('muted', false);
  function ac() {
    if (!actx) {
      var C = global.AudioContext || global.webkitAudioContext;
      if (C) actx = new C();
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  var Sound = {
    get muted() { return muted; },
    toggle: function () { muted = !muted; Store.set('muted', muted); return muted; },
    /* tone(freq, seconds, waveform, gain, freqSlideTo) */
    tone: function (f, dur, type, gain, to) {
      if (muted) return;
      var c = ac(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, c.currentTime);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), c.currentTime + dur);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(gain || 0.16, c.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur + 0.02);
    },
    noise: function (dur, gain) {
      if (muted) return;
      var c = ac(); if (!c) return;
      var n = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = c.createBufferSource(), g = c.createGain();
      s.buffer = buf; g.gain.value = gain || 0.1;
      s.connect(g); g.connect(c.destination); s.start();
    },
    tap:   function () { Sound.tone(660, 0.07, 'triangle', 0.10); },
    good:  function () { Sound.tone(523, 0.10, 'sine', 0.14); setTimeout(function(){Sound.tone(784,0.16,'sine',0.13);}, 90); },
    great: function () { [523,659,784,1046].forEach(function(f,i){ setTimeout(function(){Sound.tone(f,0.16,'sine',0.13);}, i*80); }); },
    bad:   function () { Sound.tone(180, 0.30, 'sawtooth', 0.13, 60); },
    ping:  function () { Sound.tone(1200, 0.5, 'sine', 0.09, 400); }
  };

  /* ---------------- haptics ---------------- */
  function buzz(ms) { if (!muted && navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} } }

  /* ---------------- canvas + loop ---------------- */
  function Engine(canvasId) {
    var cv = document.getElementById(canvasId);
    var ctx = cv.getContext('2d');
    var self = {
      canvas: cv, ctx: ctx,
      w: 0, h: 0, dpr: 1,
      running: false, t: 0,
      onResize: null, onUpdate: null, onRender: null
    };

    function resize() {
      var r = cv.getBoundingClientRect();
      var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
      self.w = Math.max(1, Math.round(r.width));
      self.h = Math.max(1, Math.round(r.height));
      self.dpr = dpr;
      cv.width = Math.round(self.w * dpr);
      cv.height = Math.round(self.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (self.onResize) self.onResize(self.w, self.h);
    }
    self.resize = resize;

    var last = 0;
    function frame(ts) {
      if (!self.running) return;
      if (!last) last = ts;
      var dt = Math.min((ts - last) / 1000, 0.05);   // clamp: no tunnelling after a pause
      last = ts; self.t += dt;
      if (self.onUpdate) self.onUpdate(dt, self.t);
      if (self.onRender) self.onRender(ctx, self.w, self.h, self.t);
      requestAnimationFrame(frame);
    }
    self.start = function () { if (self.running) return; self.running = true; last = 0; requestAnimationFrame(frame); };
    self.stop  = function () { self.running = false; };

    var ro = global.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(cv); else global.addEventListener('resize', resize);
    global.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
    setTimeout(resize, 0);
    return self;
  }

  /* ---------------- pointer input ---------------- */
  /* handlers: {down(x,y,e), move(x,y,e), up(x,y,e)} in CSS pixels
     relative to the element. Mouse and touch both funnel through
     pointer events; multi-touch beyond the first finger is ignored. */
  function Input(el, handlers) {
    var id = null;
    function pos(e) {
      var r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    el.addEventListener('pointerdown', function (e) {
      if (id !== null) return;
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (err) {}
      var p = pos(e); if (handlers.down) handlers.down(p.x, p.y, e);
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      var p = pos(e); if (handlers.move) handlers.move(p.x, p.y, e);
      e.preventDefault();
    }, { passive: false });
    function end(e) {
      if (e.pointerId !== id) return;
      var p = pos(e); id = null;
      if (handlers.up) handlers.up(p.x, p.y, e);
      e.preventDefault();
    }
    el.addEventListener('pointerup', end, { passive: false });
    el.addEventListener('pointercancel', end, { passive: false });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------------- tiny helpers ---------------- */
  var U = {
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp:  function (a, b, t) { return a + (b - a) * t; },
    dist:  function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); },
    rand:  function (a, b) { return a + Math.random() * (b - a); },
    ri:    function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick:  function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    /* deterministic PRNG — used for daily puzzles and seeded levels */
    seeded: function (seed) {
      var s = seed >>> 0;
      return function () {
        s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
        return s / 4294967296;
      };
    },
    /* round-rect path that works on every WebView we care about */
    rr: function (ctx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  };

  /* ---------------- screens + toast ---------------- */
  var UI = {
    show: function (id) {
      document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('on'); });
      if (id) { var el = document.getElementById(id); if (el) el.classList.add('on'); }
    },
    hide: function () { document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('on'); }); },
    toast: function (msg, ms) {
      var t = document.getElementById('toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
      t.textContent = msg; t.classList.add('on');
      clearTimeout(UI._tt);
      UI._tt = setTimeout(function () { t.classList.remove('on'); }, ms || 1600);
    }
  };

  /* keep the loop honest when the app is backgrounded */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && global.Game && global.Game.onBackground) global.Game.onBackground();
  });

  global.Store = Store;
  global.Sound = Sound;
  global.Buzz = buzz;
  global.Engine = Engine;
  global.Input = Input;
  global.U = U;
  global.UI = UI;
})(window);
