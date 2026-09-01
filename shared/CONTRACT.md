# Game contract — every game in this repo obeys this

## Files
Each game lives in `/root/playbox/games/<slug>/` and consists of exactly two files:
- `index.html` — markup + `<style>` for game-specific bits only
- `game.js` — all game logic

**Never** edit anything in `/root/playbox/shared/`. Read it, use it.

## index.html skeleton (copy this exactly, fill in the marked parts)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no,maximum-scale=1">
<meta name="theme-color" content="#080b14">
<title>GAME NAME</title>
<link rel="stylesheet" href="../../shared/style.css">
<style>/* game-specific CSS only */</style>
</head>
<body>
  <div class="hud" id="hud"> ... </div>
  <canvas id="cv"></canvas>

  <div class="screen on" id="menu"> ... </div>
  <div class="screen" id="over"> ... </div>
  <div class="toast" id="toast"></div>

<script>window.GAME_ID = 'SLUG';</script>
<script src="../../shared/ad-config.js"></script>
<script src="../../shared/ads.js"></script>
<script src="../../shared/engine.js"></script>
<script src="game.js"></script>
</body>
</html>
```

`window.GAME_ID` must be set **before** engine.js loads — it namespaces localStorage.

## Globals the shared layer gives you
- `Engine('cv')` → `{canvas,ctx,w,h,dpr,start(),stop(),resize(),onResize,onUpdate(dt,t),onRender(ctx,w,h,t)}`
- `Input(el,{down(x,y,e),move(x,y,e),up(x,y,e)})` — pointer coords in CSS px relative to `el`
- `Store.get(k,dflt)`, `Store.set(k,v)`, `Store.bump(k,v)` (returns true on new record)
- `Sound.tap() .good() .great() .bad() .ping()`, `Sound.tone(f,dur,type,gain,slideTo)`, `Sound.noise(dur,gain)`, `Sound.toggle()`, `Sound.muted`
- `Buzz(ms)` — haptic
- `U.clamp lerp dist rand ri pick seeded(seed) rr(ctx,x,y,w,h,r)`
- `UI.show(id) UI.hide() UI.toast(msg,ms)`
- `Ads.init() showBanner() hideBanner() maybeInterstitial(force) showRewarded()→Promise<bool> isRewardedReady() showPrivacyOptions() isNative()`

## Ad rules — follow exactly
1. Call `Ads.init()` once. It is idempotent, so calling it from a first-gesture
   handler AND from boot is fine. The bridge queues any banner requested before
   consent has answered, and refuses to touch the ad SDK at all until the SDK's
   own `canRequestAds` says yes — so a `showBanner()` at module load is safe and
   is what four of the five games do.
2. `Ads.showBanner()` on the **menu and game-over screens only**. Call `Ads.hideBanner()` the moment gameplay starts. A banner must never sit under a live play area.
3. On every round end / level complete call `await Ads.maybeInterstitial()` — it
   self-paces, never force it, and it does not resolve until the ad is off the
   screen, so it is safe to draw the next screen immediately afterwards.
   *Deliberate exemption:* Daily Lock does not call it on the daily puzzle —
   one interruption a day on the headline mode is a worse trade than the
   revenue. Its practice mode does. Do not "fix" this.
4. Give the player exactly one rewarded-video offer per game, and it must be genuinely useful and optional: an extra life, extra hints, a second chance. Hide the button when `!Ads.isRewardedReady()`.
5. Never show any ad inside the first 45 s of play; the bridge already enforces this, don't work around it.

## Quality bar
- Portrait, one-thumb play. Every tap target ≥ 48px.
- Runs at 60fps on a mid-range phone: no per-frame allocation in hot loops, no shadowBlur inside a loop over many objects.
- Zero external requests. No images, no fonts, no CDNs. Everything drawn on canvas or synthesised.
- Zero console errors or warnings.
- Persist high score / progress via `Store`.
- First-run: teach by doing. A short, skippable, in-context hint — never a wall of text.
- The game must be playable and fun **without** ever watching an ad.
- Handle `Game.onBackground()` (define `window.Game = {onBackground(){...}}`) to pause.
- Difficulty ramps smoothly; a first run should last 20–60 s, a good run several minutes.

## Style
Dark base `#080b14`, accent `#4ee1c1`, secondary `#7c5cff`, gold `#ffc857`, danger `#ff6b6b`.
Glow via `ctx.shadowBlur` sparingly. Prefer clean geometry over clutter.
