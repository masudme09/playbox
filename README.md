# Playbox — one Android app, five original games, built to grow

Five HTML5 games behind a hub that gives them a reason to be in the same app:
a daily challenge that spans all of them, a streak, and tokens that spend
anywhere. No engine, no assets, no external requests — every pixel is drawn on
canvas and every sound is synthesised at runtime, so the whole thing is about
400 KB and plays with the network off.

| Game | Genre | The idea |
|---|---|---|
| **Echo** | puzzle | A maze you cannot see. Tap to send out a sonar ping; walls light up where it touches them, then fade. Some hazards make no light at all. 60 levels. |
| **Starfall** | arcade | Endless orbital climb. You never steer — you slingshot, and real gravity from every planet bends the flight. Chase gravity assists. |
| **Prism** | puzzle | Split white light into red, green and blue; filter it, recombine it, feed every crystal exactly the colour it asks for. 45 hand-built levels, every par proven minimal. |
| **Vortex** | arcade | Rings collapse inward around a core; be in the gap. Eight escalating zones, and every ring is checked as physically reachable before it spawns. |
| **Daily Lock** | daily puzzle | One deduction lock a day, the same for everyone on earth, with no words in it at all. |

## Pipeline

Three GitHub Actions workflows, documented in
[`.github/RELEASING.md`](.github/RELEASING.md):

| Workflow | Runs when | Does |
|---|---|---|
| **CI** | every push and PR | assembles the app, runs all five suites |
| **Release** | `main` → internal track · tag `v1.2.3` → production (as a draft) | signed `.aab` to Play |
| **Pages** | changes to `legal/` or `demo/` | publishes the privacy policy and the playable build |

`versionCode` comes from the CI run number so Play can never reject a duplicate.
Real ad IDs live in GitHub secrets and are injected into `build/` at build time
— the committed `shared/ad-config.js` keeps Google's test IDs, so nothing
abusable sits in the repo.

## Try it now

Open `demo/playbox.html` in a browser — the whole app, hub and all five games,
bundled into one file. Or open `index.html` to run the repo as it is.

## Working on it locally

```bash
npm ci
npx playwright install --with-deps chromium   # once; the tests drive a browser
npm run privacy                              # after filling in app.config.json
npm run build:android                        # assembles build/ and the Android project
npm test                                     # all five suites
```

On a machine that already has a Chromium and cannot download one, point
`PLAYBOX_CHROMIUM` at the binary and everything works unchanged.

Open `build/android` in Android Studio and press Run. You will see Google's
test ads, which is correct. **PUBLISHING-GUIDE.md** covers the whole path from
here to money in a bank account.

## Adding a game in an update — the whole point of the hub

```bash
node tools/new-game.mjs asteroids "Asteroids"
```

That scaffolds a working game that already satisfies the contract, and prints
the two snippets to paste. Then:

1. build the game in `games/asteroids/`
2. paste its entry into `GAMES` in **`shared/registry.js`**, with
   `since` set to the version you are about to ship
3. paste its emblem into `shared/art.js` so the shelf tile has artwork
4. add a `case` to `Profile.gameStat` in `shared/profile.js`
5. add the release to `CHANGELOG` in `shared/registry.js`
6. bump `versionCode` **and** `versionName` in `app.config.json`
7. `node tools/verify.mjs && ./tools/build-android.sh`

The hub reads everything else from the registry: shelf tile, NEW badge,
what's-new sheet, daily-challenge pool, shop rows. Nothing else needs to know
the game exists. `tools/verify.mjs` fails loudly if any of those steps is
half-done — a game with no emblem, a goal that reads a field the game never
reports, a duplicate shop key, a `since` that isn't a version.

Players' tokens and streaks carry straight over. The new game shows up on the
shelf with a NEW badge and in the what's-new sheet, with no separate download.

## Layout

```
index.html                  the hub (becomes www/index.html)
hub/hub.js                  shelf, daily challenge, shop, stats, settings, game frame
games/<slug>/               one game: index.html + game.js, nothing else
shared/registry.js          >>> the game registry — the extension point <<<
shared/profile.js           tokens, boosts, daily challenge, streak, per-game stats
shared/ads.js               the single AdMob client, owned by the hub
shared/ad-config.js         >>> the only file you edit to go live with ads <<<
shared/pb-child.js          child bridge: points a game's Ads at the host's
shared/engine.js            canvas loop, input, storage, synth audio
shared/art.js               every emblem and store graphic, drawn in code
shared/style.css            the shared dark theme
shared/CONTRACT.md          the rules every game here follows
app.config.json             app id, name, version, AdMob app id
tools/                      build, assets, screenshots, tests (below)
tools/browser.mjs           the one place that knows how to start Chromium
.github/workflows/          CI, Release, Pages
.github/RELEASING.md        secrets, the Play service account, the runbook
store-assets/playbox/       icon, feature graphic, 8 screenshots, launcher icons
store-listings/playbox.md   title, descriptions, content rating, data safety
legal/                      the privacy policy, as a deployable static site
demo/playbox.html           the whole app in one file
```

## How the hub and the games fit together

On device `www/` is this repo's `index.html`, `hub/`, `shared/` and `games/`,
copied verbatim — no path rewriting, so what you run locally is what ships.

Each game runs in a **same-origin iframe**. `shared/pb-child.js` loads after
`shared/ads.js` in every game and points that game's `Ads` at the hub's single
AdMob client, so there is one initialisation, one consent flow and one banner
for the whole app — and the interstitial pacing is now global across all five
games rather than per-app. It also gives the game `PB`:

```js
PB.report('run', { score: 120, assists: 3 });   // drives the daily challenge
PB.takeBoost('echo_pings', 3);                  // spend a purchased boost
PB.peekBoost('vortex_revive');                  // is one available?
```

Opened on its own, the same game finds no host and falls through to a `PB` that
does nothing and the simulated ads `shared/ads.js` already provides — so every
game still runs standalone in a browser, which is what keeps them testable.

## How ads are handled

`shared/ads.js` is the only place any code touches an ad SDK, and it enforces
the rules for you:

- **Nothing is requested before consent has run.** A `showBanner()` during boot
  is queued until `Ads.init()` has completed the UMP flow, and the bridge
  refuses to touch the SDK at all until Google's own `canRequestAds` says yes.
  A consent flow that fails (no network on a first launch) means no ads that
  session, retried on the next foreground — not ads without consent.
- **No banner while you are playing.** Banners appear on the hub and on results
  screens; `Ads.hideBanner()` runs the moment a game opens. The inset comes
  from the SDK's real reported height and is guarded against out-of-order
  show/hide.
- **No interstitial in the first 45 seconds**, at most one every 75 seconds, and
  no more often than every third completed round. There is deliberately **no**
  interstitial at the hub boundary.
- **Every full-screen call resolves.** The AdMob plugin resolves its rewarded
  call only on a genuine reward, so a player who swipes the ad away would
  otherwise leave the promise pending forever. The bridge races the call
  against the dismissal event and against an outright rejection, and waits for
  the ad to be gone before returning.
- **Rewarded video is always optional and always useful** — extra pings, hints,
  a revive, a dial reveal — and tokens from the daily challenge buy the same
  things without an ad. Every game is completable without watching one.

## Tests

```bash
npm test                 # all five, which is what CI runs
npm run verify           # the pre-flight: assets, registry, runtime, build
npm run test:hub         # 125 assertions on the hub, profile and navigation
npm run test:profile     # the daily challenge, streaks, tokens, clock abuse
npm run test:ads         # the ad bridge against a mock of the native plugin
npm run test:listings    # listing copy against Play's character limits
```

CI runs all five on every push, so you rarely have to remember to. `verify.mjs` is the one that catches a
half-added game; `test-profile.mjs` locks in the economy and calendar edge
cases (a clock wound backwards, a run that ends after midnight, a failed
`localStorage` write, a goal removed by an update).

## Regenerating assets

```bash
npm run assets        # icon, adaptive layers, feature graphic, splash
npm run screenshots   # 8 store screenshots, driven through the real hub
npm run demo          # rebuild demo/playbox.html
npm run privacy       # rebuild the privacy policy from app.config.json
npm run notes         # Play release notes from the registry changelog
```

`screenshots.mjs` serves `build/www` over http so the iframes are same-origin
exactly as under Capacitor — run `./tools/build-android.sh` first.

## Two things to know before release

`shared/ad-config.js` ships with `useTestAds: true` and `debug: true`, and
`app.config.json` ships with Google's test AdMob app id. For a **local** build
those must change before you upload, or you will publish a game that serves
test ads and earns nothing. For a **pipeline** build you never touch them —
put the real IDs in GitHub secrets and the build injects them, all three or
none. `verify.mjs` warns while test IDs are in place and fails if they are
inconsistent, because real ad units under the test app id serve nothing at
all.

`hub/hub.js` exposes a small read-only `window.__hub`, and `vortex`/`dailylock`
expose `__vortex` and `DailyLock`, which the test and screenshot scripts drive.
They have no effect on play; delete the blocks at the bottom of those files if
you would rather ship no test surface.
