/* Renders every store + launcher graphic from tools/art.js.
   node tools/render-assets.mjs                                  */
import { launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(new URL('..', import.meta.url).pathname);
const SLUGS  = ['echo', 'starfall', 'prism', 'vortex', 'dailylock'];
/* Playbox itself: one app, one listing, one launcher icon. The per-game
   artwork below is still generated — it is what the hub's shelf tiles and
   the store screenshots are drawn from. */
const APP = 'playbox';

// Android launcher icon densities (legacy square icons)
const MIPMAP = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// Adaptive icon layers: 108dp canvas, content safe inside the middle 66dp
const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const page = await (await launch()).newPage();
await page.setContent('<!doctype html><meta charset=utf-8><body style="margin:0">');
await page.addScriptTag({ path: path.join(ROOT, 'shared/art.js') });

/* PNG keeps its alpha channel, which Play requires for the icon and forbids
   for the feature graphic. Rather than post-process with an external tool,
   anything that must be alpha-free is written as JPEG, which cannot carry one. */
async function shot(w, h, fn, out) {
  const jpeg = /\.jpe?g$/i.test(out);
  const b64 = await page.evaluate(([w, h, fn, jpeg]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { alpha: !jpeg });
    if (jpeg) { ctx.fillStyle = '#080b14'; ctx.fillRect(0, 0, w, h); }
    // eslint-disable-next-line no-new-func
    new Function('ctx', 'w', 'h', 'ART', fn)(ctx, w, h, window.ART);
    return (jpeg ? c.toDataURL('image/jpeg', 0.95) : c.toDataURL('image/png')).split(',')[1];
  }, [w, h, fn, jpeg]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  return out;
}

/* ---- the app's own identity ---- */
{
  const A = path.join(ROOT, 'store-assets', APP);
  const R = path.join(A, 'android-res');
  await shot(512, 512, `ART.drawIcon(ctx, '${APP}', 512, {scale:0.74})`, `${A}/play-icon-512.png`);
  await shot(1024, 500, `ART.drawCollectionFeature(ctx, w, h)`, `${A}/play-feature-1024x500.jpg`);
  for (const [d, s2] of Object.entries(MIPMAP)) {
    await shot(s2, s2, `ART.drawIcon(ctx, '${APP}', ${s2}, {scale:0.74})`, `${R}/mipmap-${d}/ic_launcher.png`);
    await shot(s2, s2, `ART.drawIcon(ctx, '${APP}', ${s2}, {scale:0.74})`, `${R}/mipmap-${d}/ic_launcher_round.png`);
  }
  for (const [d, s2] of Object.entries(ADAPTIVE)) {
    await shot(s2, s2, `ART.drawIcon(ctx, '${APP}', ${s2}, {transparent:true, scale:0.42})`,
               `${R}/mipmap-${d}/ic_launcher_foreground.png`);
    await shot(s2, s2,
      `const g=ctx.createLinearGradient(0,0,${s2}*0.4,${s2});
       g.addColorStop(0, ART.GAMES['${APP}'].bg[0]); g.addColorStop(1, ART.GAMES['${APP}'].bg[1]);
       ctx.fillStyle=g; ctx.fillRect(0,0,${s2},${s2});`,
      `${R}/mipmap-${d}/ic_launcher_background.png`);
  }
  await shot(2732, 2732, `ART.drawSplash(ctx, '${APP}', 2732)`, `${A}/splash-2732.png`);
  console.log('rendered', APP, '(the app icon + feature graphic)');
}

/* Per-game store artwork is no longer generated: Playbox ships as one
   listing, and the hub draws each game's shelf emblem live from shared/art.js.
   Pass --per-game if you ever split a game back out into its own app. */
if (process.argv.includes('--per-game')) {
  for (const slug of SLUGS) {
    const A = path.join(ROOT, 'store-assets', slug);
    const R = path.join(A, 'android-res');
    await shot(512, 512, `ART.drawIcon(ctx, '${slug}', 512)`, `${A}/play-icon-512.png`);
    await shot(1024, 500, `ART.drawFeature(ctx, '${slug}', w, h)`, `${A}/play-feature-1024x500.jpg`);
    for (const [d, s2] of Object.entries(MIPMAP)) {
      await shot(s2, s2, `ART.drawIcon(ctx, '${slug}', ${s2})`, `${R}/mipmap-${d}/ic_launcher.png`);
      await shot(s2, s2, `ART.drawIcon(ctx, '${slug}', ${s2})`, `${R}/mipmap-${d}/ic_launcher_round.png`);
    }
    await shot(2732, 2732, `ART.drawSplash(ctx, '${slug}', 2732)`, `${A}/splash-2732.png`);
    console.log('rendered', slug, '(per-game, for a separate listing)');
  }
}

await page.context().browser().close();
console.log('\ndone — store-assets/playbox/ has the icon, feature graphic and launcher icons');
