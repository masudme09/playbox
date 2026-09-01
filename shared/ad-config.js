/* ============================================================
   THE ONLY FILE YOU EDIT TO GO LIVE WITH ADS.
   ------------------------------------------------------------
   The IDs below are Google's official *test* IDs. They serve
   real-looking ads that earn nothing and can never get your
   account flagged. Swap them for your own AdMob unit IDs and
   set useTestAds:false when you are ready to earn.

   NEVER click your own live ads. It is the fastest way to get
   an AdMob account permanently disabled.
   ============================================================ */
window.AD_CONFIG = {
  useTestAds: true,          // <-- flip to false when your real IDs are in
  debug: true,               // console logging; set false for release

  adUnits: {
    // ---- Google test units (safe, leave these while developing) ----
    banner:       'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded:     'ca-app-pub-3940256099942544/5224354917'

    // ---- your real units go here, e.g. ----
    // banner:       'ca-app-pub-0000000000000000/1111111111',
    // interstitial: 'ca-app-pub-0000000000000000/2222222222',
    // rewarded:     'ca-app-pub-0000000000000000/3333333333'
  },

  // Add your own phone's AdMob device ID here so your test traffic
  // is never counted as real inventory. You'll find the ID printed
  // in logcat the first time the app requests an ad.
  testDeviceIds: [],

  // 0 = off, 1 = force "in EEA" consent form, 2 = force "not in EEA".
  // Use 1 once to check your consent dialog looks right, then reset to 0.
  consentDebugGeography: 0
};
