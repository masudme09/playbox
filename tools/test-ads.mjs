/* ============================================================
   Tests shared/ads.js against a mock of the real Capacitor AdMob
   plugin — including the two behaviours that only bite on a device:
     * showRewardVideoAd() never resolves unless a reward is earned
     * showInterstitial() resolves the instant show() is called
   node tools/test-ads.mjs
   ============================================================ */
import { launch } from './browser.mjs';
import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const browser = await launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.setContent(`<!doctype html><meta charset=utf-8>
<html><head><style>:root{--ad-inset:0px}</style></head><body></body></html>`);

/* ---- a faithful-enough mock of @capacitor-community/admob ---- */
const MOCK = () => {
  const listeners = {};
  const emit = (n, p) => (listeners[n] || []).slice().forEach(f => f(p));
  window.__log = [];
  const L = m => window.__log.push(m);
  window.__mock = {
    consentShown: false, bannerVisible: false,
    // set by a test to control behaviour
    rewardEarns: true, rewardTimeoutMs: 60,
    rewardRejects: false,        // plugin's "ad was not prepared" branch: rejects, no event
    initRejects: false, consentRejects: false,
    Plugins: {}
  };
  const AdMob = {
    addListener(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return { remove() { listeners[name] = listeners[name].filter(f => f !== fn); } };
    },
    async initialize() { L('initialize');
      if (window.__mock.initRejects) throw new Error('initialize failed'); },
    async requestConsentInfo() { L('requestConsentInfo');
      if (window.__mock.consentRejects) throw new Error('no network for UMP');
      return { isConsentFormAvailable: true, status: 'REQUIRED', canRequestAds: false }; },
    async showConsentForm() { L('showConsentForm'); window.__mock.consentShown = true;
      return { status: 'OBTAINED', canRequestAds: true }; },
    async showBanner() {
      L('showBanner <-- AD REQUEST');
      await new Promise(r => setTimeout(r, 120));         // native round-trip
      window.__mock.bannerVisible = true;
      setTimeout(() => emit('bannerAdSizeChanged', { width: 360, height: 72 }), 10);
    },
    async hideBanner() { L('hideBanner'); window.__mock.bannerVisible = false; },
    async prepareInterstitial() { L('prepareInterstitial <-- AD REQUEST'); },
    async showInterstitial() {
      L('showInterstitial');
      // The real plugin resolves immediately, then dismisses later.
      setTimeout(() => { L('interstitial actually closed'); emit('interstitialAdDismissed', {}); }, 250);
    },
    async prepareRewardVideoAd() { L('prepareRewardVideoAd <-- AD REQUEST'); },
    showRewardVideoAd() {
      L('showRewardVideoAd');
      if (window.__mock.rewardRejects) {
        // AdRewardExecutor rejects outright when the prepared ad is gone, and
        // attaches no FullScreenContentCallback — so NO dismissal event follows.
        return Promise.reject(new Error('No Reward Video Ad can be shown'));
      }
      return new Promise(resolve => {
        setTimeout(() => {
          if (window.__mock.rewardEarns) {
            emit('onRewardedVideoAdReward', { type: 'coin', amount: 1 });
            emit('onRewardedVideoAdDismissed', {});
            resolve({ type: 'coin', amount: 1 });
          } else {
            // user swiped it away: the real plugin NEVER resolves here
            emit('onRewardedVideoAdDismissed', {});
          }
        }, window.__mock.rewardTimeoutMs);
      });
    }
  };
  window.Capacitor = { isNativePlatform: () => true, Plugins: { AdMob } };
  window.AD_CONFIG = { useTestAds: true, debug: false,
    adUnits: { banner: 'b', interstitial: 'i', rewarded: 'r' } };
};
await page.evaluate(MOCK);

await page.addScriptTag({ path: path.join(ROOT, 'shared/ads.js') });

const inset = () => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--ad-inset').trim());
const log = () => page.evaluate(() => window.__log.slice());

let fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  \x1b[32mok  \x1b[0m ' + name); }
  catch (e) { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + ' — ' + e.message); }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

console.log('\nshared/ads.js against a mock native AdMob\n');

await t('a banner requested before init() does not fire an ad request', async () => {
  await page.evaluate(() => { window.Ads.showBanner(); });
  await page.waitForTimeout(60);
  const l = await log();
  if (l.some(x => /AD REQUEST/.test(x)) && l.indexOf('showConsentForm') === -1)
    throw new Error('banner was requested before the consent form ran');
});

await t('init() runs consent BEFORE any banner reaches the SDK', async () => {
  await page.evaluate(() => window.Ads.init());
  await page.waitForTimeout(400);
  const l = await log();
  const c = l.indexOf('showConsentForm'), b = l.findIndex(x => x.startsWith('showBanner'));
  if (c === -1) throw new Error('consent form never shown');
  if (b === -1) throw new Error('queued banner was never flushed after init');
  if (b < c) throw new Error('banner fired before consent');
});

await t('the reserved inset uses the SDK-reported height, not a guess', async () => {
  await page.waitForTimeout(200);
  eq(await inset(), '72px', 'inset');
});

await t('hideBanner during an in-flight showBanner leaves the inset at 0', async () => {
  await page.evaluate(async () => {
    await window.Ads.hideBanner();
    window.Ads.showBanner();            // deliberately not awaited
    await new Promise(r => setTimeout(r, 20));
    await window.Ads.hideBanner();      // beats the show to the finish line
  });
  await page.waitForTimeout(400);
  eq(await inset(), '0px', 'inset after an out-of-order show/hide');
});

await t('maybeInterstitial does not resolve until the ad is off screen', async () => {
  await page.evaluate(() => { window.__log.length = 0; });
  const order = await page.evaluate(async () => {
    // force the pacing gate open
    for (let i = 0; i < 3; i++) await window.Ads.maybeInterstitial();
    await new Promise(r => setTimeout(r, 10));
    const shown = await window.Ads.maybeInterstitial(true);
    window.__log.push('caller resumed');
    return { shown, log: window.__log.slice() };
  });
  if (!order.shown) throw new Error('interstitial did not show when forced');
  const closed = order.log.indexOf('interstitial actually closed');
  const resumed = order.log.indexOf('caller resumed');
  if (closed === -1) throw new Error('ad never closed');
  if (resumed < closed) throw new Error('caller resumed while the ad was still on screen');
});

await t('showRewarded resolves true when the reward is earned', async () => {
  const r = await page.evaluate(async () => {
    window.__mock.rewardEarns = true;
    return await window.Ads.showRewarded();
  });
  eq(r, true, 'earned');
});

await t('showRewarded RESOLVES FALSE when the user dismisses without earning', async () => {
  const r = await page.evaluate(async () => {
    window.__mock.rewardEarns = false;
    const out = await Promise.race([
      window.Ads.showRewarded(),
      new Promise(res => setTimeout(() => res('HUNG'), 3000))
    ]);
    return out;
  });
  if (r === 'HUNG') throw new Error('promise never settled — this is the device soft-lock');
  eq(r, false, 'not earned');
});

await t('a dismissed rewarded ad still re-arms the next one', async () => {
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => window.Ads.isRewardedReady()), true, 'rewardReady');
});

await t('showRewarded resolves when the plugin REJECTS with no dismissal event', async () => {
  const r = await page.evaluate(async () => {
    window.__mock.rewardRejects = true;
    const out = await Promise.race([
      window.Ads.showRewarded(),
      new Promise(res => setTimeout(() => res('HUNG'), 3000))
    ]);
    window.__mock.rewardRejects = false;
    return out;
  });
  if (r === 'HUNG') throw new Error('promise never settled — six-minute freeze on device');
  eq(r, false, 'not earned');
});

await t('a non-forced interstitial respects the pacing gate', async () => {
  const r = await page.evaluate(async () => await window.Ads.maybeInterstitial());
  eq(r, false, 'should be paced out this soon after the last one');
});

/* ---- the two consent-bypass paths, each in a clean page ---- */
async function bootWith(mutate) {
  const p2 = await (await browser.newContext()).newPage();
  const seen = [];
  p2.on('pageerror', e => seen.push(e.message));
  await p2.setContent('<!doctype html><meta charset=utf-8><html><head><style>:root{--ad-inset:0px}</style></head><body></body></html>');
  await p2.evaluate(MOCK);
  await p2.evaluate(mutate);
  await p2.addScriptTag({ path: path.join(ROOT, 'shared/ads.js') });
  await p2.evaluate(() => window.Ads.showBanner());     // a game's boot-time call
  await p2.evaluate(() => window.Ads.init());           // the first-gesture call
  await p2.waitForTimeout(500);
  const l = await p2.evaluate(() => window.__log.slice());
  await p2.context().close();
  return { log: l, errs: seen };
}

await t('AdMob.initialize() failing still forces consent before any ad request', async () => {
  const { log: l } = await bootWith(() => { window.__mock.initRejects = true; });
  const firstAd = l.findIndex(x => /AD REQUEST/.test(x));
  const consent = l.indexOf('showConsentForm');
  // Serving is fine here — consent still ran. Serving *without* it is not.
  if (firstAd !== -1 && (consent === -1 || consent > firstAd))
    throw new Error('an ad was requested before consent: ' + l.join(' | '));
});

await t('consent failing (offline first launch) must NOT let ad requests through', async () => {
  const { log: l } = await bootWith(() => { window.__mock.consentRejects = true; });
  const leak = l.filter(x => /AD REQUEST/.test(x));
  if (leak.length) throw new Error('ads requested with no consent: ' + leak.join(', '));
});

await t('consent succeeding DOES let ad requests through', async () => {
  const { log: l } = await bootWith(() => {});
  if (!l.some(x => /AD REQUEST/.test(x))) throw new Error('no ads served even after consent was obtained');
  if (l.indexOf('showConsentForm') === -1) throw new Error('consent form never shown');
});

await t('hideBanner() before init cancels the queued banner', async () => {
  const p3 = await (await browser.newContext()).newPage();
  await p3.setContent('<!doctype html><meta charset=utf-8><html><head><style>:root{--ad-inset:0px}</style></head><body></body></html>');
  await p3.evaluate(MOCK);
  await p3.addScriptTag({ path: path.join(ROOT, 'shared/ads.js') });
  await p3.evaluate(async () => { window.Ads.showBanner(); await window.Ads.hideBanner(); await window.Ads.init(); });
  await p3.waitForTimeout(500);
  const l = await p3.evaluate(() => window.__log.slice());
  await p3.context().close();
  if (l.some(x => x.startsWith('showBanner'))) throw new Error('cancelled banner was shown anyway');
});

await t('no page errors throughout', () => { if (errs.length) throw new Error(errs[0]); });

await browser.close();
console.log(fail ? `\n\x1b[31m${fail} FAILED\x1b[0m\n` : '\n\x1b[32mad bridge behaves correctly on a simulated device\x1b[0m\n');
process.exit(fail ? 1 : 0);
