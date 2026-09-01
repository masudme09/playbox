/* ============================================================
   Rewrites build/www/shared/ad-config.js from the environment.
   ------------------------------------------------------------
   Why: ad unit IDs are not secrets (they ship inside the APK)
   but they are abusable, and a public repo should not advertise
   them. So the repo keeps Google's test IDs and CI injects the
   real ones at build time from GitHub secrets. Nothing to
   remember to change before a release, and nothing to
   accidentally commit.

   Reads, all optional:
     PLAYBOX_USE_TEST_ADS   'true' | 'false'
     PLAYBOX_AD_BANNER      ca-app-pub-XXXX/NNNN
     PLAYBOX_AD_INTERSTITIAL
     PLAYBOX_AD_REWARDED
     PLAYBOX_AD_TEST_DEVICES  comma-separated device IDs
   With none set, the file is left exactly as committed.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error(`inject-ads: no such file: ${target}`);
  process.exit(1);
}

const E = process.env;
const UNIT = /^ca-app-pub-\d{16}\/\d{10}$/;
const units = {
  banner: E.PLAYBOX_AD_BANNER, interstitial: E.PLAYBOX_AD_INTERSTITIAL, rewarded: E.PLAYBOX_AD_REWARDED
};
const given = Object.entries(units).filter(([, v]) => v);
const wantsLive = String(E.PLAYBOX_USE_TEST_ADS || '').toLowerCase() === 'false';

if (!given.length && !wantsLive && !E.PLAYBOX_AD_TEST_DEVICES) {
  console.log('   ad-config: left as committed (test ads)');
  process.exit(0);
}

/* A partial set of live units is worse than none — the missing slot would
   silently keep serving test ads and earn nothing. */
if (wantsLive && given.length !== 3) {
  console.error(`inject-ads: PLAYBOX_USE_TEST_ADS=false but only ${given.length}/3 ad unit IDs were provided.`);
  console.error('Set PLAYBOX_AD_BANNER, PLAYBOX_AD_INTERSTITIAL and PLAYBOX_AD_REWARDED, or leave test ads on.');
  process.exit(1);
}
for (const [k, v] of given) {
  if (!UNIT.test(v)) {
    console.error(`inject-ads: ${k} does not look like an ad unit ID: ${v}`);
    console.error('Expected ca-app-pub-<16 digits>/<10 digits>. Note the slash — a ~ is the APP id, not a unit.');
    process.exit(1);
  }
}

let s = fs.readFileSync(target, 'utf8');
const before = s;

/* Every pattern is anchored to the start of a line so it cannot match the
   commented-out examples and the prose in the file's own header — which is
   exactly the bug this used to have: the comment "set useTestAds: false" was
   rewritten instead of the setting, and the build kept serving test ads. */
for (const [k, v] of given) {
  const re = new RegExp(`^(\\s*${k}:\\s*)'[^']*'`, 'm');
  if (!re.test(s)) { console.error(`inject-ads: could not find the ${k} slot in ad-config.js`); process.exit(1); }
  s = s.replace(re, `$1'${v}'`);
}
if (E.PLAYBOX_USE_TEST_ADS) {
  const re = /^(\s*useTestAds:\s*)(true|false)/m;
  if (!re.test(s)) { console.error('inject-ads: could not find the useTestAds setting'); process.exit(1); }
  s = s.replace(re, `$1${wantsLive ? 'false' : 'true'}`);
  /* release builds should not chatter into logcat */
  if (wantsLive) s = s.replace(/^(\s*debug:\s*)true/m, '$1false');
}
if (E.PLAYBOX_AD_TEST_DEVICES) {
  const ids = E.PLAYBOX_AD_TEST_DEVICES.split(',').map(x => x.trim()).filter(Boolean);
  s = s.replace(/^(\s*testDeviceIds:\s*)\[[^\]]*\]/m, `$1[${ids.map(i => `'${i}'`).join(', ')}]`);
}

/* Prove the file we just wrote actually says what we think it says. A silent
   miss here means shipping test ads to production and earning nothing. */
{
  const live = /^\s*useTestAds:\s*false/m.test(s);
  if (wantsLive && !live) { console.error('inject-ads: useTestAds is still true after rewriting — refusing'); process.exit(1); }
  for (const [k, v] of given) {
    if (!new RegExp(`^\\s*${k}:\\s*'${v.replace(/[/]/g, '\\/')}'`, 'm').test(s)) {
      console.error(`inject-ads: ${k} did not take — refusing`); process.exit(1);
    }
  }
  if (wantsLive && /ca-app-pub-3940256099942544/.test(s.replace(/^\s*\/\/.*$/gm, ''))) {
    console.error('inject-ads: a Google TEST id survived in a live build — refusing'); process.exit(1);
  }
}

if (s === before) { console.log('   ad-config: nothing changed'); process.exit(0); }
fs.writeFileSync(target, s);

const shown = given.map(([k, v]) => `${k}=…${v.slice(-6)}`).join(' ');
console.log(`   ad-config: ${wantsLive ? 'LIVE ads' : 'test ads'}${shown ? ' · ' + shown : ''}`);
console.log(`              (${path.relative(process.cwd(), target)} — the committed file is untouched)`);
