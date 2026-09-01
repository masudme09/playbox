/* ============================================================
   Playbox ad bridge  —  @capacitor-community/admob wrapper
   ------------------------------------------------------------
   One API for all five games. Runs as a harmless no-op in a
   desktop browser so the games stay testable outside Android.

   Three things this file exists to guarantee, because getting
   any of them wrong is what gets an ad-funded app pulled:

   1. No ad request EVER leaves the device before the consent
      flow has run. showBanner() called during boot is queued,
      not fired.
   2. Every full-screen call resolves — including when the user
      swipes the ad away. The plugin only resolves its rewarded
      call on a genuine reward, so a dismissal would otherwise
      leave a promise dangling forever and freeze the caller.
   3. The caller is not told an ad is finished until it really
      is, so nothing draws underneath a full-screen ad.

   >>> TO GO LIVE: edit shared/ad-config.js only. <<<
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.AD_CONFIG || {};
  var cap = global.Capacitor;
  var native = !!(cap && cap.isNativePlatform && cap.isNativePlatform() &&
                  cap.Plugins && cap.Plugins.AdMob);
  var AdMob = native ? cap.Plugins.AdMob : null;

  /* ---- pacing rules (AdMob policy friendly, player friendly) ---- */
  var MIN_SECONDS_BETWEEN_INTERSTITIALS = 75;
  var ROUNDS_BETWEEN_INTERSTITIALS      = 3;   // an ad on every 3rd round end
  var GRACE_SECONDS_AFTER_LAUNCH        = 45;  // never interrupt the first taste
  var FULLSCREEN_TIMEOUT_MS             = 6 * 60 * 1000;  // last-resort unstick

  var launchedAt  = Date.now();
  var lastFullAt  = 0;
  var eventsSince = 0;
  var interReady  = false;
  var rewardReady = false;
  var bannerWant  = false;   // what the game asked for
  var bannerLive  = false;   // what is actually on screen
  var bannerH     = 58;      // replaced by the real height from the SDK
  var insetToken  = 0;       // guards against out-of-order show/hide
  var started     = false;   // init() finished: the UI must never wait on ads
  var canServe    = !native; // consent actually permits requesting ads
  var starting    = null;    // the in-flight init promise
  var consentTried = false;

  function log() {
    if (CFG.debug) console.log.apply(console, ['[ads]'].concat([].slice.call(arguments)));
  }
  function unit(kind) { return (CFG.adUnits || {})[kind] || ''; }
  function testing()  { return CFG.useTestAds !== false; }

  function setInset(px, token) {
    if (token !== undefined && token !== insetToken) return;   // a newer call won
    document.documentElement.style.setProperty('--ad-inset', px + 'px');
  }

  /* Resolves on the first of `events`, or after `ms`. Always resolves.
     Returns the payload of whichever event fired, or null on timeout. */
  function settle(events, ms) {
    return new Promise(function (resolve) {
      var offs = [], timer = null, done = false;
      function finish(payload) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offs.forEach(function (h) { try { h.remove(); } catch (e) {} });
        resolve(payload);
      }
      events.forEach(function (name) {
        try {
          var h = AdMob.addListener(name, function (info) { finish({ name: name, info: info }); });
          // Capacitor returns either a handle or a promise of one
          if (h && typeof h.then === 'function') h.then(function (hh) { offs.push(hh); });
          else if (h) offs.push(h);
        } catch (e) { log('listener failed', name, e); }
      });
      timer = setTimeout(function () { finish(null); }, ms);
    });
  }

  // ------------------------------------------------------------
  // init — safe to call from every game screen; only runs once
  // ------------------------------------------------------------
  function init() {
    if (starting) return starting;
    starting = (async function () {
      if (!native) { started = true; log('browser mode — ads simulated'); flushBanner(); return; }
      watchBannerSize();                 // before anything can show a banner
      try {
        await AdMob.initialize({
          initializeForTesting: testing(),
          testingDevices: CFG.testDeviceIds || []
        });
      } catch (e) { log('initialize failed', e); }
      await requestConsent();            // sets canServe; never throws
      started = true;                    // the game is free to carry on either way
      openTheTap();
      log(canServe ? 'initialised' : 'initialised, ads withheld until consent');
    })();
    return starting;
  }

  /* GDPR / UMP. Required for EEA + UK traffic, and Play will reject an
     ad-funded app that ships without a consent flow. */
  async function requestConsent() {
    consentTried = true;
    try {
      var info = await AdMob.requestConsentInfo({
        debugGeography: CFG.consentDebugGeography || 0,
        testDeviceIdentifiers: CFG.testDeviceIds || []
      });
      if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') {
        info = (await AdMob.showConsentForm()) || info;
      }
      /* canRequestAds is the SDK's own verdict and the only safe gate. If a
         plugin version does not report it, fall back to the status: anything
         other than an outstanding REQUIRED means we may serve. */
      if (info && typeof info.canRequestAds === 'boolean') canServe = info.canRequestAds;
      else canServe = !!(info && info.status !== 'REQUIRED');
    } catch (e) {
      /* UMP needs the network, and these games are marketed as playable
         offline. A first launch on a plane must NOT quietly become a session
         that serves ads with no consent — we simply serve nothing and try
         again next time the app comes to the foreground. */
      canServe = false;
      log('consent unavailable — no ads this session until it succeeds', e);
    }
  }

  /* Called once consent has answered. Nothing touches the SDK before this. */
  function openTheTap() {
    if (!canServe) return;
    preloadInterstitial();
    preloadRewarded();
    flushBanner();
  }

  /* Retry the consent flow when the app returns to the foreground, so an
     offline first launch heals itself rather than staying ad-free forever. */
  if (native) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || canServe || !consentTried) return;
      requestConsent().then(openTheTap);
    });
  }

  /* Some EU users are entitled to reopen this; wire it to a settings row. */
  async function showPrivacyOptions() {
    if (!native) return false;
    try { await AdMob.showPrivacyOptionsForm(); return true; }
    catch (e) { log('privacy form failed', e); return false; }
  }

  // ------------------------------------------------------------
  // banner
  // ------------------------------------------------------------
  /* The SDK reports the real adaptive-banner height; a hardcoded 58px
     is wrong on tablets and on some aspect ratios. */
  function watchBannerSize() {
    try {
      AdMob.addListener('bannerAdSizeChanged', function (size) {
        if (size && size.height > 0) {
          bannerH = size.height;
          if (bannerLive) setInset(bannerH, insetToken);
        }
      });
    } catch (e) { log('size listener failed', e); }
  }

  function flushBanner() { if (bannerWant) showBanner(); }

  async function showBanner() {
    bannerWant = true;
    if (!started || !canServe) { log('banner queued until consent has run'); init(); return; }
    if (bannerLive) return;
    bannerLive = true;
    var token = ++insetToken;
    if (!native) { setInset(0, token); log('banner (simulated)'); return; }
    try {
      await AdMob.showBanner({
        adId: unit('banner'),
        adSize: 'ADAPTIVE_BANNER',
        position: 'BOTTOM_CENTER',
        margin: 0,
        isTesting: testing()
      });
      setInset(bannerH, token);      // ignored if a hideBanner already superseded us
    } catch (e) { bannerLive = false; setInset(0, token); log('banner failed', e); }
  }

  async function hideBanner() {
    bannerWant = false;                 // also cancels a banner queued pre-consent
    if (!bannerLive) { setInset(0, ++insetToken); return; }
    bannerLive = false;
    var token = ++insetToken;
    setInset(0, token);
    if (!native) return;
    try { await AdMob.hideBanner(); } catch (e) { log('hideBanner failed', e); }
  }

  // ------------------------------------------------------------
  // interstitial
  // ------------------------------------------------------------
  async function preloadInterstitial() {
    if (!native) { interReady = true; return; }
    if (!started || !canServe) return;
    try {
      await AdMob.prepareInterstitial({ adId: unit('interstitial'), isTesting: testing() });
      interReady = true;
    } catch (e) { interReady = false; log('interstitial preload failed', e); }
  }

  /* Call on every natural break (round over, level complete). It decides
     for itself whether an ad is due, and — importantly — does not resolve
     until the ad is off the screen, so the caller can safely draw its next
     screen straight afterwards. Returns true if an ad was shown. */
  async function maybeInterstitial(force) {
    eventsSince++;
    var now = Date.now();
    var okGrace  = (now - launchedAt) / 1000 > GRACE_SECONDS_AFTER_LAUNCH;
    var okTime   = (now - lastFullAt) / 1000 > MIN_SECONDS_BETWEEN_INTERSTITIALS;
    var okEvents = eventsSince >= ROUNDS_BETWEEN_INTERSTITIALS;
    if (!force && !(okGrace && okTime && okEvents)) { log('interstitial skipped'); return false; }
    if (!interReady) { preloadInterstitial(); return false; }

    eventsSince = 0; interReady = false;
    if (!native) {
      lastFullAt = now;
      log('interstitial (simulated)');
      await new Promise(function (r) { setTimeout(r, 300); });
      preloadInterstitial();
      return true;
    }
    var shown = false;
    try {
      var closed = settle(['interstitialAdDismissed', 'interstitialAdFailedToShow'],
                          FULLSCREEN_TIMEOUT_MS);
      await AdMob.showInterstitial();   // resolves as soon as show() is called...
      shown = true;
      lastFullAt = Date.now();          // only a real showing spends the window
      await closed;                     // ...so wait for it to actually be gone
    } catch (e) { log('interstitial show failed', e); }
    preloadInterstitial();
    return shown;
  }

  // ------------------------------------------------------------
  // rewarded
  // ------------------------------------------------------------
  async function preloadRewarded() {
    if (!native) { rewardReady = true; return; }
    if (!started || !canServe) return;
    try {
      await AdMob.prepareRewardVideoAd({ adId: unit('rewarded'), isTesting: testing() });
      rewardReady = true;
    } catch (e) { rewardReady = false; log('rewarded preload failed', e); }
  }

  function isRewardedReady() { return rewardReady; }

  /* Resolves true only when the user genuinely earned the reward, and —
     this is the important part — ALWAYS resolves. The plugin resolves its
     own call only from the reward callback, so a user who swipes the ad
     away would otherwise leave this promise pending forever and freeze
     whatever screen is waiting on it. */
  async function showRewarded() {
    if (!rewardReady) { preloadRewarded(); return false; }
    rewardReady = false;

    if (!native) {
      log('rewarded (simulated) — granting');
      await new Promise(function (r) { setTimeout(r, 450); });
      preloadRewarded();
      return true;
    }

    var earned = false;
    try {
      var rewardSeen = null;
      try {
        rewardSeen = AdMob.addListener('onRewardedVideoAdReward', function (r) {
          if (r && r.amount > 0) earned = true;
        });
      } catch (e) { log('reward listener failed', e); }

      var finished = settle(['onRewardedVideoAdDismissed', 'onRewardedVideoAdFailedToShow'],
                            FULLSCREEN_TIMEOUT_MS);

      // Whichever comes first: the plugin's own resolve (a reward) or the
      // ad closing. Never both required.
      /* Two ways out, and only two. The plugin resolves this call ONLY when a
         reward is earned, so a resolve must still wait for the ad to close.
         A rejection, though, means nothing was ever shown — no dismissal event
         will ever arrive — so that is the one case that must short-circuit,
         otherwise the caller sits on the timeout backstop for six minutes. */
      var viaCall = AdMob.showRewardVideoAd().then(
        function (res) { if (res && res.amount > 0) earned = true; return null; },
        function (e) { log('rewarded show failed', e); return 'rejected'; });

      await Promise.race([
        finished,
        viaCall.then(function (v) { return v === 'rejected' ? v : finished; })
      ]);

      if (rewardSeen) {
        if (typeof rewardSeen.then === 'function') rewardSeen.then(function (h) { try { h.remove(); } catch (e) {} });
        else { try { rewardSeen.remove(); } catch (e) {} }
      }
    } catch (e) { log('rewarded failed', e); }

    preloadRewarded();
    return earned;
  }

  // ------------------------------------------------------------
  global.Ads = {
    init: init,
    showBanner: showBanner,
    hideBanner: hideBanner,
    maybeInterstitial: maybeInterstitial,
    showRewarded: showRewarded,
    isRewardedReady: isRewardedReady,
    showPrivacyOptions: showPrivacyOptions,
    isNative: function () { return native; }
  };
})(window);
