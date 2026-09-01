/* ============================================================
   Child bridge — loaded by every game, AFTER shared/ads.js.
   ------------------------------------------------------------
   Inside Playbox a game runs in a same-origin iframe, so it can
   reach the host directly. This file points the game's `Ads` at
   the host's single AdMob client (one init, one consent flow,
   one banner) and gives it `PB` for the profile.

   Opened on its own — from a browser, or from tools/screenshots
   — the same game finds no host and falls through to the local
   simulated Ads that shared/ads.js already set up, with a PB
   that quietly does nothing. Every game therefore still runs
   standalone, which is what keeps them testable.
   ============================================================ */
(function (global) {
  'use strict';

  var host = null;
  try {
    if (global.parent && global.parent !== global && global.parent.PB_HOST) host = global.parent.PB_HOST;
  } catch (e) { host = null; }          // cross-origin: not hosted

  if (host) {
    /* One ad client for the whole app, owned by the hub. */
    if (host.Ads) global.Ads = host.Ads;

    global.PB = {
      hosted: true,
      report: function (type, data) {
        var ev = { game: global.GAME_ID, type: type };
        if (data) for (var k in data) ev[k] = data[k];
        try { return host.report(ev); } catch (e) { return null; }
      },
      takeBoost: function (key, max) {
        try { return host.takeBoost(key, max) || 0; } catch (e) { return 0; }
      },
      peekBoost: function (key) {
        try { return host.peekBoost(key) || 0; } catch (e) { return 0; }
      },
      exit: function () { try { host.exit(); } catch (e) {} }
    };
  } else {
    global.PB = {
      hosted: false,
      report: function () { return null; },
      takeBoost: function () { return 0; },
      peekBoost: function () { return 0; },
      exit: function () {}
    };
  }
})(window);
