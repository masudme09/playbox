# Getting these five games onto Google Play and earning

Written for someone who has never shipped an Android app. Follow it top to
bottom for the first game; games two to five take about twenty minutes each
once you have done one.

**Verified against Google's rules as of 29 August 2026.** Two dates matter
right now: from **31 August 2026** every new app and every update must target
**Android 16 (API 36)** — the build script already sets this — and the
**12 testers / 14 days** closed-testing rule applies to every new personal
developer account.

---

## 0. What you have

```
playbox/
  index.html + hub/     the hub: shelf, daily challenge, token shop, stats
  games/                the five games, plain HTML + JS, playable in any browser
  shared/               registry, profile, ad bridge, engine, theme
  tools/                build, assets, screenshots, five test suites
  store-assets/playbox/ icon, feature graphic, 8 screenshots, launcher icons
  store-listings/       ready-to-paste title / short / full descriptions
  legal/                the privacy policy Play requires (ads = mandatory)
  app.config.json       app id, name, version, AdMob app id — edit this first
  demo/playbox.html     the whole app in one file, openable in any browser
  README.md             how the pieces fit, and how to add a sixth game
  PUBLISHING-GUIDE.md   this file
```

Open `demo/playbox.html` in a browser right now if you want to play before
reading further. It is the same code that ships, running in a frame instead of
a WebView; only the ads are simulated.

---

## 1. One app, and what that buys you

Playbox is **one Play listing** containing five games, with new games arriving
as ordinary app updates. That is the right shape here, and it is worth being
clear about why, because the tradeoff is real.

**What you gain**

- **One closed test, not five.** On a new personal developer account every app
  needs 12 testers opted in for 14 continuous days before it can reach
  production. Five apps means five of those. One app means one.
- **One listing to maintain** — one set of graphics, one privacy policy, one
  data safety form, one content rating, one review queue.
- **Retention compounds instead of splitting.** A player who came for Vortex is
  shown a daily challenge that sends them into Echo and Prism. Five separate
  apps cannot do that, and ad revenue follows retention far more than it
  follows the number of listings.
- **Every update lifts the whole catalogue.** A sixth game arrives for everyone
  who already has the app, with their tokens and streak intact, and gives you a
  legitimate reason to post a fresh what's-new entry.

**What you give up**

- **Search surface.** Five listings can rank for five different sets of terms.
  One listing has one title, one short description, one icon. This is the real
  cost, and it is why the recommended app name front-loads searchable words:
  `Playbox: Mind & Reflex Games`.
- **Per-game store pages.** Nobody can link a friend to "Echo on Google Play".

If a single game ever becomes clearly popular on its own, you can split it back
out into its own listing later — the games are self-contained, the per-game
marketing copy is kept in `store-listings/per-game-copy/`, and
`node tools/render-assets.mjs --per-game` still generates per-game store
artwork. Doing it in that order is much better than guessing up front.

---

## 2. Things to set up before you touch code

| What | Cost | How long |
|---|---|---|
| Google account (use a dedicated one, not your personal inbox) | free | minutes |
| Google Play Console developer account | **$25 once, for life** | ID check can take 1–3 days |
| AdMob account | free | minutes, but linking can take a day |
| Android Studio (latest stable) | free | a long download |
| Somewhere to host 5 privacy policy pages | free (GitHub Pages) | 20 minutes |

### 2.1 Play Console account

Sign up at [play.google.com/console](https://play.google.com/console). Pay
the $25. Then choose your account type carefully, because **you cannot change
it later**:

- **Personal account** — fastest. Requires a government ID and a personal
  address. Subject to the 12-testers-for-14-days rule before your first app
  can go to production.
- **Organisation account** — requires a registered business and a **D-U-N-S
  number** (free from Dun & Bradstreet, takes up to 30 days). Not subject to
  the closed-testing requirement, and the developer name shown on the store
  is your company rather than your own legal name.

Whichever you choose, Google will verify your identity and, for personal
accounts, publish your name and address on your store listings. If that
matters to you, the organisation route is worth the wait.

### 2.2 AdMob account

Sign up at [admob.google.com](https://admob.google.com) with the same Google
account. You will register each app and create ad units in section 5.

> **Do not create the AdMob app entries until you have decided your final
> package names** (`com.yourstudio.vortex` and so on). AdMob ties an app to a
> package name and it is annoying to unpick.

### 2.3 Host the privacy policy

Play will not publish an app that shows ads without a **publicly reachable
privacy policy URL**. The `legal/` folder is a ready-made static site.

1. Create a public GitHub repo, e.g. `yourstudio-legal`.
2. Push the contents of `legal/`.
3. Repo → Settings → Pages → deploy from `main`, root.
4. Your URL becomes
   `https://<you>.github.io/yourstudio-legal/playbox-privacy.html`.

Fill in your details in `app.config.json` first and re-run
`node tools/make-privacy.mjs`, so your name and support email are baked in and
the policy describes what the app actually does — including that the daily
challenge is generated from the device's date rather than fetched, which is why
the app needs no account and sends nothing about you anywhere.

---

## 3. Set your identity in the project

Open `app.config.json`:

```json
{
  "appId":       "com.yourstudio.playbox",
  "appName":     "Playbox",
  "storeName":   "Playbox: Mind & Reflex Games",
  "versionName": "1.0.0",
  "versionCode": 1,
  "admobAppId":  "ca-app-pub-XXXXXXXXXXXXXXXX~NNNNNNNNNN",
  "publisher": {
    "developerName": "Your Studio",
    "supportEmail":  "you@example.com",
    "privacyUrl":    "https://yourname.github.io/yourstudio-legal/playbox-privacy.html"
  }
}
```

**`appId` is permanent.** Once Playbox is live under
`com.yourstudio.playbox`, that string can never change — a different app id is
a different app, with a different listing and no reviews. Use a domain you
control, or at least one you would not be embarrassed by in three years.

`admobAppId` lives here rather than in the Android project because
`tools/build-android.sh` rewrites `strings.xml` on every run. Set it here and
it survives every rebuild.

Then regenerate the privacy policy so your name and email are baked in:

```bash
node tools/make-privacy.mjs
```

---

## 4. Build the Android project

> **Doing this on GitHub instead?** The repo ships three Actions workflows that
> run the tests, build the signed bundle and upload it to Play. Read
> [`.github/RELEASING.md`](.github/RELEASING.md) — it covers the secrets, the
> Play service account, and the one manual step (the very first upload of a new
> app cannot go through the API). The rest of this guide still applies: the
> pipeline automates the building, not the Play Console paperwork in sections 7
> and 8, which you have to do once either way.


```bash
cd playbox
./tools/build-android.sh
```

This produces `build/` — a complete Capacitor project with the Android platform
already added and configured:

- `www/` assembled by copying `index.html`, `hub/`, `shared/` and `games/`
  verbatim, so what you tested locally is exactly what ships
- portrait lock, the app name and icon (legacy + adaptive + monochrome)
- `minSdk 23`, `compileSdk 36`, `targetSdk 36` — what Play requires
- your AdMob application id wired into the manifest
- an on-brand splash, so there is no white flash on cold start
- release signing that reads `keystore.properties` when you add one

Open `build/android` in Android Studio, let Gradle sync (the first sync
downloads a lot), plug in a phone with USB debugging on, and press Run.

**You should see ads immediately** — Google's test ads, marked "Test Ad". That
is correct and expected. They earn nothing and are safe to tap.

Before every upload, run the suite:

```bash
node tools/verify.mjs && node tools/test-hub.mjs && \
node tools/test-profile.mjs && node tools/test-ads.mjs
```

`verify.mjs` checks the store assets against Play's published specs, that the
registry and the repo agree about which games exist, that every daily-challenge
goal reads a field its game actually reports, that the Android project is
configured correctly, and that the whole bundle runs clean over http with no
external requests.

---

## 5. Wire in your real ads

Do this only once the game runs correctly with test ads.

### 5.1 Create the AdMob app and ad units

In AdMob → Apps → Add app → Android → *yes, it is on Google Play* (or "not
yet" if you have not uploaded it) → enter the app name.

Note the **App ID**: `ca-app-pub-XXXXXXXXXXXXXXXX~NNNNNNNNNN` (with a `~`).

Then create three ad units for that app:

| Unit | Format | Where it shows in these games |
|---|---|---|
| Banner | Banner | menu and results screens only |
| Interstitial | Interstitial | between rounds, self-paced |
| Rewarded | Rewarded | optional bonus (hints, revive, extra pings) |

Each gives you an **Ad unit ID**: `ca-app-pub-XXXX/NNNNNNNNNN` (with a `/`).

### 5.2 Paste them in — two files, in the repo

Edit these in the **repo**, never in `build/`, which is regenerated on every run.

**File 1** — `shared/ad-config.js`:

```js
window.AD_CONFIG = {
  useTestAds: false,          // <— the switch that starts earning
  debug: false,               // <— quiet the console for release
  adUnits: {
    banner:       'ca-app-pub-XXXX/1111111111',
    interstitial: 'ca-app-pub-XXXX/2222222222',
    rewarded:     'ca-app-pub-XXXX/3333333333'
  },
  testDeviceIds: ['YOUR_PHONE_ID'],   // see the warning below
  consentDebugGeography: 0
};
```

**File 2** — `app.config.json`:

```json
"admobAppId": "ca-app-pub-XXXX~YYYY"
```

Then rebuild:

```bash
./tools/build-android.sh
```

`node tools/verify.mjs` will fail if these two disagree — real ad units under
Google's test app id serve nothing at all, and that mismatch is exactly the
sort of thing that gets an AdMob account looked at.

> **Keep your own phone out of your ad stats.** Run the app once with the real
> IDs and watch logcat for a line like
> `Use RequestConfiguration.Builder().setTestDeviceIds(Arrays.asList("33BE2250B43518CCDA7DE426D04EE231"))`.
> Put that string into `testDeviceIds`. Your device then always gets test ads.
>
> **Never tap your own live ads, and never ask anyone to.** Google's invalid
> traffic detection is very good and the penalty is a permanent AdMob ban with
> forfeited earnings. This is the single most common way small developers lose
> everything they built.

### 5.3 Consent (this is not optional)

The ad bridge already calls Google's UMP consent flow on startup. You still
have to configure the message: **AdMob → Privacy & messaging → European
regulations**, create the GDPR message, list Google as a vendor, and publish
it. Do the same for the US state regulations message. An ad-funded app that
ships without this is both a Play policy problem and a legal one in the EU.

To check yours looks right, set `consentDebugGeography: 1` temporarily — that
forces the EEA form to appear wherever you are. Set it back to `0` afterwards.

---

## 6. Sign and build the release bundle

### 6.1 Make an upload key — once

```bash
keytool -genkey -v -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Store `upload-keystore.jks` and both passwords somewhere you will still have
them in five years — a password manager, plus one offline copy. **If you lose
this file you cannot update your own apps.** (Play App Signing, which is on by
default for new apps, gives you a recovery path — take it.)

### 6.2 Build

In Android Studio: **Build → Generate Signed App Bundle / APK → Android App
Bundle**, choose your keystore, select the `release` variant, build.

The output lands at `build/android/app/release/app-release.aab`.
That `.aab` is what you upload. (`.apk` is only for sideloading to test.)

Bump `versionCode` in `app.config.json` for **every single upload** — Play
rejects a bundle whose version code it has seen before. Bump `versionName` too
whenever the change is worth telling players about, and add a matching
`CHANGELOG` entry in `shared/registry.js`: that is what drives the in-app
what's-new sheet and the NEW badges.

---

## 7. Create the listing in Play Console

Play Console → **Create app**. Then work through the left sidebar; Play shows
you a checklist and will not let you publish until it is green.

### 7.1 Store listing

Everything you need is in `store-listings/playbox.md`:

| Field | Limit | Where it comes from |
|---|---|---|
| App name | 30 | the listing file |
| Short description | 80 | the listing file |
| Full description | 4000 | the listing file |
| App icon | 512×512 PNG **with** alpha, ≤1 MB | `store-assets/playbox/play-icon-512.png` |
| Feature graphic | 1024×500, **no** alpha | `store-assets/playbox/play-feature-1024x500.jpg` |
| Phone screenshots | 2 min, 4–8 recommended, 1080×1920 | `store-assets/playbox/screenshots/` (8) |

The graphics are already the right sizes and colour formats. The feature
graphic and the screenshots are JPEG on purpose: Play requires them to carry no
alpha channel, and a canvas or a screenshot is always RGBA, so re-exporting
them through an image editor is the easiest way to get rejected.

Lead with the hub and the daily challenge. It is the one screenshot no
competing puzzle collection has, and it explains the app in a glance.

> Play also forbids fake badges, "#1", review-star graphics or price claims in
> your icon and feature graphic. The supplied artwork has none of that.

### 7.2 The forms nobody warns you about

**App content → Privacy policy.** Paste the hosted URL for that game.

**App content → Ads.** *Yes, my app contains ads.*

**App content → Content rating.** Fill in the questionnaire. For all five
games the honest answers are "no" to violence, sexuality, profanity, drugs,
gambling and user interaction, which lands you at **Everyone / PEGI 3**. The
per-game answers are written out at the bottom of each listing file.

**App content → Target audience.** These games are designed for 13+. If you
select an under-13 audience you enter the Families programme, which brings
much stricter ad rules and would require reconfiguring AdMob. Do not do it by
accident.

**App content → Data safety.** This is the one people get wrong. The truthful
declaration for these games, given AdMob is present:

- *Does your app collect or share any of the required user data types?* **Yes**
- Data types: **Device or other IDs** — collected **and** shared
- Purpose: **Advertising or marketing**, and **Analytics** if you later add any
- Is it processed ephemerally? **No**
- Is collection required or optional? **Required**
- Is data encrypted in transit? **Yes**
- Can users request deletion? Point at the advertising-ID reset in Android
  settings, which is what your privacy policy already describes.
- App activity, personal info, location, photos, files, contacts: **No** — the
  games genuinely collect none of it, and the saved progress never leaves the
  device.

Google cross-checks this against what your app actually does. An inaccurate
data safety form is a common cause of suspension, and it is entirely avoidable.

**App content → Government apps, financial features, health:** No to all.

---

## 8. The testing ladder

You cannot go straight to production on a new personal account.

**Internal testing** — up to 100 testers by email, available immediately, no
review delay. Use this to check the release build actually works: install from
the Play link, confirm real ads appear, confirm nothing crashes on a real
device with a real network.

**Closed testing** — this is the gate. For a new personal developer account:

- **at least 12 testers opted in**
- **continuously for 14 days**
- testers who opt in and drop out early do not count

Practically: create an email list of 12 real people, send them the opt-in
link, and make sure they actually install and stay in for the full two weeks.
Google looks for genuine engagement, so ask them to play a few times and send
you feedback. Tester-swap communities exist and are widely used, but a group of
strangers who install and never open the app is exactly the pattern Google
looks for when it rejects a production application.

This is the paperwork that shipping one app instead of five actually saves you:
one fortnight, one tester list, one production application.

**Apply for production** — Dashboard → *Apply for production*. You answer
three sections: what you tested, what the app is, and how you know it is
ready. Answer concretely — what feedback you received and what you changed
because of it. Google responds within about seven days.

**Production** — first review typically a few days, occasionally longer.
Updates are usually faster once you have a clean history.

---

## 9. Getting paid

Ad revenue is paid by Google through AdMob, not through Play.

1. AdMob → Payments → set up your **payment profile** (name, address).
2. Submit **tax information** (a W-8BEN for non-US individuals). Skip this and
   your payments are held indefinitely.
3. **Verify your address** — Google posts a PIN when you reach $10 in earnings.
4. Add a bank account and verify the micro-deposit.
5. You are paid once your balance passes **$100** (€70 / £60), around the 21st
   of the following month.

Play's own $25 fee and AdMob earnings are entirely separate systems. You do not
need a merchant account unless you add in-app purchases.

### What to actually expect

Be realistic so you can judge your own results honestly. For casual games with
no marketing budget, typical numbers look like:

- **eCPM** (revenue per 1000 ad impressions): roughly $1–$4 for banners and
  $4–$15 for interstitials and rewarded video, heavily dependent on country —
  US, UK, Germany, Japan pay many times what most of the world does.
- **Organic installs for a brand-new listing with no promotion**: single digits
  to low tens per day. This is the hard part, not the code.
- So an app with 1,000 daily active players might make on the order of $2–$10
  a day. Five games in one app do not multiply that on their own — but sessions
  per player do, and that is what the daily challenge is for.

The lever that matters most is not the ad configuration, it is retention and
discovery. Two numbers to watch, both of which you control:

- **Daily-challenge completion rate.** A player who finishes all three goals
  has opened three different games in one session. That is three times the
  natural ad breaks of a single-game session, without showing a single extra
  ad.
- **Streak length.** A seven-day streak is a player who has come back seven
  times. Nothing in an ad dashboard is worth as much as that.

If you only promote one thing about this app, promote the daily challenge — it
is the reason to install it over any of the hundreds of single-game clones, and
daily-habit apps are where ad revenue compounds.

---

## 10. After launch, and adding games

**Every update, by hand:** bump `versionCode` (and usually `versionName`) in
`app.config.json`, re-run `./tools/build-android.sh`, rebuild the signed
bundle, upload as a new release.

**Every update, through the pipeline:** bump `versionName`, add the matching
`CHANGELOG` entry in `shared/registry.js`, merge to `main` — that puts a build
on the internal track — then `git tag v1.1.0 && git push origin v1.1.0` to send
it to production as a draft. `versionCode` is handled for you. Details in
[`.github/RELEASING.md`](.github/RELEASING.md).

Either way, roll out to 20% first if you are nervous; Play lets you halt a
staged rollout.

**Adding a game** is the cadence this app is built for:

```bash
node tools/new-game.mjs asteroids "Asteroids"
```

then build it, add its entry to `GAMES` in `shared/registry.js` with `since`
set to the version you are shipping, add its emblem to `shared/art.js`, add a
`Profile.gameStat` case, add a `CHANGELOG` entry, bump the version, and run
`node tools/verify.mjs`. Full checklist in README.md. The hub picks the game up
from the registry — shelf tile, NEW badge, what's-new entry, daily-challenge
goals, shop rows — and existing players keep their tokens and streaks.

A steady drip of one game every few weeks is worth far more than five games at
once: each update is a reason for Play to re-surface you, a reason to email your
testers, and a fresh what's-new entry on the listing.

**Watch:** Play Console → Android vitals (crash rate, ANR rate — a bad ANR rate
gets you demoted in search), and AdMob → eCPM and fill rate per unit. In the app
itself, the numbers that matter are the daily-challenge completion rate and the
streak length; those are what ad revenue actually tracks.

**Reviews:** reply to them. It is visible, it takes two minutes, and it
measurably helps conversion.

**Store listing experiments:** Play lets you A/B test your icon, screenshots
and short description against live traffic. Once you have installs this is the
cheapest improvement available to you, and with one listing you only have to run
it once.

---

## 11. When something gets rejected

The usual causes, in rough order of frequency:

| Rejection | Fix |
|---|---|
| Privacy policy URL missing, dead, or does not mention ads | host it properly; the supplied pages cover ads |
| Data safety form contradicts what the app does | declare Device IDs collected + shared for advertising |
| Ads interfering with gameplay or navigation | already handled — no banner during play, no ad in the first 45s |
| Target API level too low | already set to 36 |
| Broken functionality on the reviewer's device | test on a real phone, not only the emulator |
| Misleading store listing | do not claim features the game does not have |
| Interstitial on app open, or ads on exit | the ad bridge deliberately never does either |

If you are rejected, the email names the specific policy. Fix exactly that,
bump the version code, and resubmit. A rejection is not a strike against your
account; repeated identical rejections are.

---

## 12. A sensible order to do all this in

1. Open `demo/playbox.html` and play the five games. Decide you like them.
2. Register the Play Console account and pay the $25 — the ID check runs in the
   background while you do everything else.
3. Fill in `app.config.json`, run `node tools/make-privacy.mjs`, push `legal/`
   to GitHub Pages.
4. `./tools/build-android.sh`, then run it on your own phone with test ads.
5. Create the AdMob app and three ad units, put the IDs in
   `shared/ad-config.js` and `app.config.json`, configure the consent message,
   rebuild, and confirm real ads appear.
6. Create the Play listing, paste the copy from `store-listings/playbox.md`,
   upload the eight screenshots, and complete **every** form under App content
   — the Data safety answers are written out in that same file.
7. Run all five test suites, build the signed `.aab`, upload to internal
   testing, and install it from the Play link yourself.
8. Promote to closed testing, get your 12 testers in, wait 14 days.
9. Apply for production. While you wait, build game number six.
10. Publish. Then spend your time on retention and the store listing, not on
    the ad settings.
