/* ============================================================
   PLAYBOX HUB — the shell around the five games.
   ------------------------------------------------------------
   Everything on screen is derived from shared/registry.js and
   shared/profile.js. Adding a game means adding a registry
   entry; nothing in this file needs to know it happened.

   Owns exactly three things the games cannot own themselves:
     * the single ad client (shared out through PB_HOST.Ads)
     * the cross-game profile: tokens, boosts, daily, streak
     * navigation, including the Android back button
   ============================================================ */
(function (global) {
  'use strict';

  var R = global.Registry, P = global.Profile;
  var CUR = (R.changelog[0] && R.changelog[0].version) || '1.0.0';
  var DPR = Math.min(global.devicePixelRatio || 1, 3);

  function $(id) { return document.getElementById(id); }

  /* localStorage can throw (private mode, quota, disabled). Every read and
     write in the hub goes through these two, including the reads into other
     games' namespaces. Profile and Store guard their own. */
  function lsGet(k, dflt) {
    try { var v = localStorage.getItem(k); return v === null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------
     toasts — queued, and rendered in the HUB document so they appear
     over a running game's iframe
     ------------------------------------------------------------------ */
  var tEl = $('toast'), tQ = [], tBusy = false, tT1 = null, tT2 = null;
  function toast(msg, ms) {
    tQ.push({ m: msg, ms: ms || 1800 });
    if (tQ.length > 4) tQ.splice(0, tQ.length - 4);
    if (!tBusy) tNext();
  }
  function tNext() {
    if (!tQ.length) { tBusy = false; return; }
    tBusy = true;
    var it = tQ.shift();
    tEl.textContent = it.m;
    tEl.classList.add('on');
    tT1 = setTimeout(function () {
      tEl.classList.remove('on');
      tT2 = setTimeout(tNext, 220);
    }, it.ms);
  }
  function tClear() {
    clearTimeout(tT1); clearTimeout(tT2);
    tQ.length = 0; tBusy = false;
    tEl.classList.remove('on');
  }

  /* ------------------------------------------------------------------
     sound — never touched before a real gesture, or Chrome logs an
     AudioContext warning we would have to own
     ------------------------------------------------------------------ */
  var gestured = false;
  function sfx(name) {
    if (!gestured) return;
    try { if (global.Sound && Sound[name]) Sound[name](); } catch (e) {}
  }

  /* ------------------------------------------------------------------
     emblems — ART.drawIcon once per (slug,size), cached forever.
     No RAF anywhere in the hub.
     ------------------------------------------------------------------ */
  /* Draw each emblem once into an offscreen canvas, then blit that into a
     fresh element per call. A canvas element can only live in one parent, so
     handing out the cached node itself would let a rebuild steal a tile's
     emblem into a stats row — and cloneNode does NOT copy a canvas bitmap,
     so a clone would simply be blank. */
  var emCache = {};
  function emblem(slug, size) {
    var key = slug + '@' + size;
    var px = Math.round(size * DPR);
    var src = emCache[key];
    if (!src) {
      src = document.createElement('canvas');
      src.width = px; src.height = px;
      var sctx = src.getContext('2d');
      if (sctx) {
        sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        try { global.ART.drawIcon(sctx, slug, size); } catch (e) {}
      }
      emCache[key] = src;
    }
    var c = document.createElement('canvas');
    c.className = 'em';
    c.width = px; c.height = px;
    c.style.width = size + 'px';
    c.style.height = size + 'px';
    var ctx = c.getContext('2d');
    if (ctx) { try { ctx.drawImage(src, 0, 0); } catch (e) {} }
    return c;
  }

  function tint(hex, a) {
    var h = String(hex || '#4ee1c1').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return 'rgba(255,255,255,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var TICK_SVG = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.6l5.2 5.2L20 6.8"/></svg>';
  var COIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M12 7.6l3 4.4-3 4.4-3-4.4z" fill="currentColor" stroke="none"/></svg>';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ==================================================================
     navigation
     ================================================================== */
  var VIEWS  = { shelf: 'v-shelf', shop: 'v-shop', stats: 'v-stats', settings: 'v-settings', whatsnew: 'v-new' };
  var TITLES = { shop: 'Shop', stats: 'Your stats', settings: 'Settings', whatsnew: "What's new" };
  var view = 'shelf', newReturn = 'shelf';

  function go(name) {
    if (!VIEWS[name]) name = 'shelf';
    view = name;
    for (var k in VIEWS) {
      var v = $(VIEWS[k]);
      if (v) v.classList.toggle('on', k === name);
    }
    document.body.setAttribute('data-view', name === 'whatsnew' ? 'new' : name);
    $('crumb').textContent = TITLES[name] || 'Playbox';
    sync();
    $('scroll').scrollTop = 0;
    if (name === 'shelf') startClock(); else stopClock();
  }

  /* ==================================================================
     the daily challenge card
     ================================================================== */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function hms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 3600) + ':' + pad2(Math.floor(s % 3600 / 60)) + ':' + pad2(s % 60);
  }

  function syncDaily() {
    var d = P.refresh();
    var slots = (d && d.goals) || [];
    var host = $('goals');
    host.textContent = '';
    var done = 0;

    slots.forEach(function (slot) {
      var goal = R.goal(slot.id);
      var game = R.by(slot.game) || {};
      if (slot.done) done++;

      var b = el('button', 'goal' + (slot.done ? ' ok' : ''));
      b.type = 'button';
      b.style.setProperty('--c', game.accent || 'var(--accent)');
      b.setAttribute('data-slug', slot.game);
      b.setAttribute('aria-label', (goal ? goal.text : slot.id) + ' — open ' + (game.name || slot.game));

      var t = el('div', 'gt');
      t.appendChild(el('span', 'gg', game.name || slot.game));
      t.appendChild(el('span', 'gx', goal ? goal.text : slot.id));
      b.appendChild(t);

      if (slot.done) {
        b.insertAdjacentHTML('beforeend', TICK_SVG);
      } else {
        b.appendChild(el('div', 'gp', slot.progress + '/' + (goal ? goal.need : 1)));
      }
      host.appendChild(b);
    });

    var all = slots.length > 0 && done === slots.length;
    var payAll = slots.length * P.TOKENS_PER_GOAL + P.TOKENS_ALL_THREE;

    $('daily').classList.toggle('done', all);
    $('dCount').textContent = done + ' / ' + slots.length;
    $('dTitle').textContent = all ? 'Challenge complete' : 'Three goals, three games';
    $('dPay').innerHTML = all
      ? 'Paid out <b>' + payAll + ' tokens</b> today'
      : '+' + P.TOKENS_PER_GOAL + ' a goal, <b>+' + P.TOKENS_ALL_THREE + ' for all three</b>';

    var st = P.state.streak;
    $('dCheer').textContent = st > 0
      ? (st === 1 ? 'Streak started. Come back tomorrow to keep it.'
                  : st + '-day streak. Come back tomorrow to keep it.')
      : 'A fresh challenge lands at midnight UTC.';

    tickClock();
  }

  var clockT = null;
  function startClock() {
    if (clockT || frameOpen() || document.hidden || view !== 'shelf') return;
    tickClock();
    clockT = setInterval(tickClock, 1000);
  }
  function stopClock() { if (clockT) { clearInterval(clockT); clockT = null; } }
  function tickClock() {
    var d = P.state.daily;
    if (d && d.day !== P.dayNumber()) { sync(); return; }   // midnight rolled over
    $('dCd').textContent = 'New in ' + hms(P.msUntilNextDay());
  }

  /* ==================================================================
     the shelf
     ================================================================== */
  var tiles = [], badgeBase = CUR;

  function buildTiles() {
    var host = $('tiles');
    host.textContent = '';
    tiles = R.games.map(function (g) {
      var b = el('button', 'tile');
      b.type = 'button';
      b.setAttribute('data-slug', g.slug);
      b.style.setProperty('--c', g.accent);
      b.style.setProperty('--tint', tint(g.accent, 0.14));
      b.appendChild(emblem(g.slug, 54));

      var info = el('div', 'info');
      var row = el('div', 'trow');
      row.appendChild(el('span', 'tname', g.name));
      var badge = el('span', 'badge', 'NEW');
      badge.hidden = true;
      row.appendChild(badge);
      info.appendChild(row);
      info.appendChild(el('div', 'ttag', g.tagline));

      var meta = el('div', 'tmeta');
      meta.appendChild(el('span', 'tkind', g.kind + ' · ' + g.detail));
      var stat = el('span', 'tstat');
      var sb = el('b', null, '0'), sl = el('span', null, '');
      stat.appendChild(sb); stat.appendChild(document.createTextNode(' ')); stat.appendChild(sl);
      meta.appendChild(stat);
      info.appendChild(meta);

      b.appendChild(info);
      host.appendChild(b);
      return { slug: g.slug, badge: badge, num: sb, lab: sl };
    });
  }

  function syncTiles() {
    var fresh = {};
    try {
      R.newerThan(badgeBase).forEach(function (g) { fresh[g.slug] = true; });
    } catch (e) {}
    tiles.forEach(function (t) {
      var s = P.gameStat(t.slug) || { primary: 0, label: '' };
      t.num.textContent = (s.of !== undefined && s.of !== null)
        ? s.primary + ' / ' + s.of
        : String(s.primary);
      t.lab.textContent = s.label || '';
      t.badge.hidden = !fresh[t.slug];
    });
  }

  /* ==================================================================
     shop
     ================================================================== */
  var shopRefs = [];

  function buildShop() {
    var host = $('shopList');
    host.textContent = '';
    shopRefs = [];

    var rows = R.shopRows(), byGame = {}, order = [];
    rows.forEach(function (r) {
      if (!byGame[r.game]) { byGame[r.game] = []; order.push(r.game); }
      byGame[r.game].push(r);
    });

    order.forEach(function (slug) {
      var g = R.by(slug) || {};
      var grp = el('div', 'group');
      var head = el('div', 'ghead');
      head.style.setProperty('--c', g.accent || 'var(--accent)');
      head.appendChild(el('i', 'dot'));
      var n = el('div', 'n', g.name || slug);
      n.style.color = g.accent || '';
      head.appendChild(n);
      grp.appendChild(head);

      var list = el('div', 'tiles');
      byGame[slug].forEach(function (r) {
        var row = el('div', 'srow');
        var info = el('div', 'info');
        info.appendChild(el('div', 'lab', r.label));
        info.appendChild(el('div', 'note', r.note));
        var own = el('div', 'own', '');
        info.appendChild(own);
        row.appendChild(info);

        var buy = el('button', 'buy');
        buy.type = 'button';
        buy.setAttribute('data-key', r.key);
        buy.innerHTML = '<b>' + COIN_SVG + r.cost + '</b><span>Buy</span>';
        row.appendChild(buy);

        list.appendChild(row);
        shopRefs.push({ row: r, buy: buy, own: own });
      });
      grp.appendChild(list);
      host.appendChild(grp);
    });
  }

  function syncShop() {
    $('shopTok').textContent = P.tokens;
    shopRefs.forEach(function (s) {
      var have = P.peekBoost(s.row.key);
      s.own.textContent = have > 0 ? have + ' in stock' : '';
      s.buy.disabled = P.tokens < s.row.cost;
    });
  }

  /* ==================================================================
     stats
     ================================================================== */
  var statRefs = [];

  function buildStats() {
    var host = $('statList');
    host.textContent = '';
    statRefs = R.games.map(function (g) {
      var row = el('div', 'grow');
      row.style.setProperty('--c', g.accent);
      row.appendChild(emblem(g.slug, 34));
      row.appendChild(el('div', 'n', g.name));
      var v = el('div', 'v');
      var b = el('b', null, '0'), s = el('span', null, '');
      v.appendChild(b); v.appendChild(s);
      row.appendChild(v);
      host.appendChild(row);
      return { slug: g.slug, num: b, lab: s };
    });
  }

  function syncStats() {
    var S = P.state;
    $('sTok').textContent = S.tokens;
    $('sStreak').textContent = S.streak;
    $('sBest').textContent = S.maxStreak;
    var total = 0;
    for (var k in S.plays) total += S.plays[k] || 0;
    $('sPlays').textContent = total;

    statRefs.forEach(function (r) {
      var s = P.gameStat(r.slug) || { primary: 0, label: '' };
      r.num.textContent = (s.of !== undefined && s.of !== null)
        ? s.primary + ' / ' + s.of
        : String(s.primary);
      r.lab.textContent = s.label || '';
    });
  }

  /* ==================================================================
     settings
     ================================================================== */
  /* Every game reads its own `<slug>:muted` through Store, so one hub
     switch has to write one key per registry slug. */
  function setMuted(m) {
    try { if (global.Sound && Sound.muted !== m) Sound.toggle(); } catch (e) {}
    lsSet('playbox:muted', m);
    R.games.forEach(function (g) { lsSet(g.slug + ':muted', m); });
    syncSettings();
  }
  function isMuted() {
    try { if (global.Sound) return !!Sound.muted; } catch (e) {}
    return !!lsGet('playbox:muted', false);
  }
  function setReduce(v) { lsSet('vortex:reduce', v); syncSettings(); }

  function syncSettings() {
    $('optSound').setAttribute('aria-checked', String(!isMuted()));
    $('optMotion').setAttribute('aria-checked', String(!!lsGet('vortex:reduce', false)));
    $('vers').textContent = 'Playbox ' + CUR + ' · ' + R.games.length + ' games · plays offline';
    $('optNewNote').textContent = "What changed in version " + CUR + '.';
  }

  /* ==================================================================
     what's new
     ================================================================== */
  function fillWhatsNew(from) {
    var c = R.changelog[0] || { version: CUR, notes: [] };
    $('wnVer').textContent = 'Playbox ' + c.version;
    var host = $('wnNotes');
    host.textContent = '';
    (c.notes || []).forEach(function (line) {
      var d = el('div', 'note-i');
      d.appendChild(el('i'));
      d.appendChild(document.createTextNode(line));
      host.appendChild(d);
    });

    var added = [];
    try { if (from) added = R.newerThan(from); } catch (e) {}
    var box = $('wnAdded');
    box.textContent = '';
    if (added.length) {
      box.hidden = false;
      box.appendChild(document.createTextNode(added.length === 1 ? 'New game: ' : 'New games: '));
      added.forEach(function (g, i) {
        if (i) box.appendChild(document.createTextNode(', '));
        box.appendChild(el('b', null, g.name));
      });
    } else {
      box.hidden = true;
    }
  }

  /* ==================================================================
     the game frame
     ================================================================== */
  var openSlug = null, pushedState = false;
  function frameOpen() { return !!openSlug; }

  /* Swapping the iframe with `src=` adds an entry to the joint session
     history, which would make our own pushState entry unreachable and leave
     hardware back undoing an iframe navigation instead of leaving the game.
     location.replace() swaps the document without touching history. The URL
     is resolved against the HUB, not against the document currently in the
     frame, or the second game would load from games/<first>/games/<second>/. */
  function frameLoad(url) {
    var f = $('gf');

    /* Single-file preview builds (tools/make-demo.mjs) have no files to point
       at — they hand us the game's whole document instead. srcdoc inherits
       the parent's origin, so the child still reaches PB_HOST and shares
       localStorage exactly as it does on device. */
    if (typeof global.PB_INLINE === 'function') {
      f.srcdoc = (url === 'about:blank') ? '' : (global.PB_INLINE(url) || '');
      return;
    }

    var full = url;
    try { full = new URL(url, location.href).href; } catch (e) {}
    try {
      var w = f.contentWindow;
      if (w && w.location && typeof w.location.replace === 'function') {
        w.location.replace(full);
        return;
      }
    } catch (e) {}
    f.src = full;                 // cross-origin fallback; never hit in the app
  }

  function openGame(slug) {
    var g = R.by(slug);
    if (!g || openSlug) return;

    Ads.hideBanner();            // no banner under a live play area
    P.noteLaunch(slug);
    openSlug = slug;

    var fn = $('fName');
    fn.style.setProperty('--c', g.accent);
    fn.querySelector('span').textContent = g.name;

    stopClock();
    tClear();
    $('frame').classList.add('on');
    frameLoad('games/' + slug + '/index.html');

    try { history.pushState({ pb: 'game', slug: slug }, ''); pushedState = true; }
    catch (e) { pushedState = false; }
  }

  /* about:blank tears the game's document down, which is what actually
     stops its requestAnimationFrame loop and its AudioContext. */
  function closeGame() {
    if (!openSlug) return;
    openSlug = null;
    var f = $('gf');
    try { if (f.contentWindow && f.contentWindow.stop) f.contentWindow.stop(); } catch (e) {}
    frameLoad('about:blank');
    $('frame').classList.remove('on');
    tClear();
    Ads.showBanner();
    go('shelf');                  // re-render: new progress and tokens show at once
  }

  function back() {
    if (openSlug) {
      if (pushedState) { pushedState = false; history.back(); }   // popstate closes it
      else closeGame();
      return;
    }
    if (view === 'whatsnew') { go(newReturn); return; }
    if (view !== 'shelf') { go('shelf'); return; }
  }

  global.addEventListener('popstate', function () {
    pushedState = false;
    if (openSlug) { closeGame(); return; }
    if (view !== 'shelf') go('shelf');
  });

  /* Android hardware back: leave the game, not the app. */
  try {
    var cap = global.Capacitor;
    var App = cap && cap.Plugins && cap.Plugins.App;
    if (App && App.addListener) {
      App.addListener('backButton', function () {
        /* Through back(), not closeGame(), so the pushState entry openGame()
           added is actually popped — otherwise it leaks and the next back
           press is swallowed. */
        if (openSlug || view !== 'shelf') { back(); return; }
        if (App.exitApp) App.exitApp();
      });
    }
  } catch (e) {}

  /* ==================================================================
     the host object the games talk to (shared/pb-child.js)
     ================================================================== */
  global.PB_HOST = {
    Ads: global.Ads,

    report: function (ev) {
      /* Only the game currently on screen may bank progress. pb-child stamps
         ev.game itself, but a stale frame mid-teardown, or a bug in one game,
         must not be able to complete another game's goal. */
      if (!ev || !ev.game || (openSlug && ev.game !== openSlug)) return null;
      var d0 = P.state.daily;
      var paidBefore = !!(d0 && d0.bonusPaid);
      var res = P.report(ev);
      var d1 = P.state.daily;
      var paidNow = !!(d1 && d1.bonusPaid);

      if (res) {
        var n = (res.completed || []).length;
        for (var i = 0; i < n; i++) {
          toast('Goal complete · +' + P.TOKENS_PER_GOAL + ' tokens', 1900);
        }
        if (paidNow && !paidBefore) {
          var st = res.streak || P.state.streak;
          toast('Daily challenge done · +' + P.TOKENS_ALL_THREE + ' tokens · ' +
                st + (st === 1 ? '-day streak started' : '-day streak'), 2800);
          sfx('great');
        } else if (n) {
          sfx('good');
        }
      }
      /* closeGame() re-syncs, so there is nothing to gain from rebuilding the
         shelf, shop and stats DOM underneath a running game — and it costs a
         frame at exactly the moment the player is watching an animation. */
      if (!frameOpen()) sync();
      return res;
    },

    takeBoost: function (key, max) { return P.takeBoost(key, max); },
    peekBoost: function (key) { return P.peekBoost(key); },
    exit: function () { back(); }
  };

  /* ==================================================================
     sync everything that can change
     ================================================================== */
  function sync() {
    P.refresh();
    $('tokN').textContent = P.tokens;
    var st = P.state.streak;
    $('stkPill').hidden = !(st > 0);
    $('stkN').textContent = st;
    syncDaily();
    syncTiles();
    syncShop();
    syncStats();
    syncSettings();
  }

  /* ==================================================================
     wiring
     ================================================================== */
  $('goals').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.goal') : null;
    if (!b) return;
    sfx('tap');
    openGame(b.getAttribute('data-slug'));
  });
  $('tiles').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.tile') : null;
    if (!b) return;
    sfx('tap');
    openGame(b.getAttribute('data-slug'));
  });
  $('shopList').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.buy') : null;
    if (!b || b.disabled) return;
    var key = b.getAttribute('data-key');
    for (var i = 0; i < shopRefs.length; i++) {
      if (shopRefs[i].row.key !== key) continue;
      var row = shopRefs[i].row;
      if (P.buy(row)) {
        sfx('good');
        toast(row.label + ' · ' + row.cost + ' tokens spent');
      } else {
        toast('Not enough tokens yet');
      }
      break;
    }
    sync();
  });

  $('navShop').addEventListener('click', function () { sfx('tap'); go('shop'); });
  $('navStats').addEventListener('click', function () { sfx('tap'); go('stats'); });
  $('navSet').addEventListener('click', function () { sfx('tap'); go('settings'); });
  $('back').addEventListener('click', function () { sfx('tap'); back(); });
  $('fBack').addEventListener('click', function () { back(); });

  $('optSound').addEventListener('click', function () {
    var next = !isMuted();          // next muted state = the inverse of "on"
    setMuted(next);
    if (!next) { gestured = true; sfx('tap'); }
    toast(next ? 'Sound off' : 'Sound on', 1100);
  });
  $('optMotion').addEventListener('click', function () {
    var next = !lsGet('vortex:reduce', false);
    setReduce(next);
    sfx('tap');
    toast(next ? 'Reduced motion in Vortex' : 'Full motion in Vortex', 1300);
  });
  $('optNew').addEventListener('click', function () {
    sfx('tap');
    fillWhatsNew(null);
    newReturn = 'settings';
    go('whatsnew');
  });
  $('wnOk').addEventListener('click', function () { sfx('tap'); go(newReturn); });

  if (Ads.isNative()) {
    $('optPrivacy').hidden = false;
    $('optPrivacy').addEventListener('click', function () {
      sfx('tap');
      try { Ads.showPrivacyOptions(); } catch (e) {}
    });
  }

  /* ==================================================================
     background / foreground
     ================================================================== */
  global.Game = {
    onBackground: function () {
      stopClock();
      tClear();
    }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stopClock(); return; }
    if (!frameOpen()) { sync(); if (view === 'shelf') startClock(); }
  });

  /* ==================================================================
     boot
     ================================================================== */
  P.read();
  P.refresh();

  /* what's-new gating, before anything renders a NEW badge */
  var seen = P.state.seenVersion;
  var showNew = false;
  if (seen === null || seen === undefined) {
    P.state.seenVersion = CUR;      // fresh install: nothing to catch up on
    P.save();
  } else if (R.cmpVersion(seen, CUR) < 0) {
    badgeBase = seen;               // games added since `seen` get a NEW badge
    showNew = true;
    P.state.seenVersion = CUR;
    P.save();
  }

  buildTiles();
  buildShop();
  buildStats();
  $('shelfHint').textContent = R.games.length + ' games';
  fillWhatsNew(showNew ? badgeBase : null);

  /* The bridge queues this until the consent flow has answered, and
     refuses to touch the ad SDK before then — so a boot-time call is
     both safe and the only way the banner is up on the first screen. */
  try { Ads.showBanner(); } catch (e) {}

  function firstGesture() {
    gestured = true;
    document.removeEventListener('pointerdown', firstGesture, true);
    document.removeEventListener('keydown', firstGesture, true);
    try { Ads.init(); } catch (e) {}
  }
  document.addEventListener('pointerdown', firstGesture, true);
  document.addEventListener('keydown', firstGesture, true);

  newReturn = 'shelf';
  go(showNew ? 'whatsnew' : 'shelf');

  /* QA hooks — pure reads plus the two navigation entry points */
  global.__hub = {
    go: go, open: openGame, close: closeGame, sync: sync,
    view: function () { return view; },
    openSlug: function () { return openSlug; }
  };

})(window);
