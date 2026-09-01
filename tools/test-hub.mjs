import { launch } from './browser.mjs';
import fs from 'node:fs';

const HUB = 'file://' + new URL('../index.html', import.meta.url).pathname;
const SHOTS = '/tmp/playbox-hub-shots';
/* slugs come from the registry so a new game is covered automatically */
const SLUGS = [...fs.readFileSync(new URL('../shared/registry.js', import.meta.url).pathname, 'utf8')
  .matchAll(/slug: '([a-z0-9]+)'/g)].map(m => m[1]);

let fails = 0, checks = 0;
function ok(name, cond, extra='') {
  checks++;
  if (cond) console.log(`  PASS  ${name}${extra?' — '+extra:''}`);
  else { fails++; console.log(`  FAIL  ${name}${extra?' — '+extra:''}`); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a)===JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); }

const errors = [], warnings = [], pageErrors = [];
function attach(page) {
  page.on('console', m => {
    const t = m.type();
    const line = `[${t}] ${m.text()} @ ${m.location()?.url||''}`;
    if (t === 'error') errors.push(line);
    else if (t === 'warning') warnings.push(line);
  });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => { if (!r.url().startsWith('file:')) errors.push('[net] '+r.url()); });
  page.on('request', r => { if (!/^(file|about|data|blob):/.test(r.url())) errors.push('[EXTERNAL REQUEST] '+r.url()); });
}

const browser = await launch({ args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({
  viewport: { width: 405, height: 720 },
  deviceScaleFactor: 2.6667,
  isMobile: true, hasTouch: true
});
const page = await ctx.newPage();
attach(page);

async function fresh(seed) {
  await page.goto(HUB);
  await page.waitForFunction(() => !!window.__hub);
  if (seed) {
    await page.evaluate(seed);
    await page.reload();
    await page.waitForFunction(() => !!window.__hub);
  }
}

/* ---------------- 1. cold start ---------------- */
console.log('\n1. cold start, empty storage');
await ctx.clearCookies();
await page.goto('about:blank');
await fresh(() => { try { localStorage.clear(); } catch(e){} });
await page.waitForTimeout(400);
ok('shelf view is on', await page.locator('#v-shelf.on').count() === 1);
ok('3 goal rows', await page.locator('#goals .goal').count() === 3, String(await page.locator('#goals .goal').count()));
ok('5 tiles', await page.locator('#tiles .tile').count() === 5);
ok('countdown ticking', /New in \d+:\d\d:\d\d/.test(await page.locator('#dCd').textContent()), await page.locator('#dCd').textContent());
eq('first-run tokens', await page.locator('#tokN').textContent(), '10');
ok('streak pill hidden at streak 0', await page.locator('#stkPill').isHidden());
ok('no NEW badge on fresh install', await page.locator('#tiles .badge:visible').count() === 0);
ok('seenVersion set silently', await page.evaluate(() => Profile.state.seenVersion) === '1.0.0');
ok('whatsnew not shown', await page.locator('#v-new.on').count() === 0);
ok('tap targets >= 48px', await page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('#v-shelf .goal, #v-shelf .tile, .top .icon-btn').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;   // hidden on this view
    if (r.height < 48 || r.width < 36) bad.push(e.className + ' ' + Math.round(r.width)+'x'+Math.round(r.height));
  });
  return bad;
}).then(b => { if (b.length) console.log('     ', b); return b.length === 0; }));
ok('no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth+1));
ok('shelf scrolls', await page.evaluate(() => { const s = document.getElementById('scroll'); return s.scrollHeight > s.clientHeight; }));
await page.screenshot({ path: `${SHOTS}/01-shelf.png` });

/* countdown really updates every second */
const cd1 = await page.locator('#dCd').textContent();
await page.waitForTimeout(1400);
const cd2 = await page.locator('#dCd').textContent();
ok('countdown advanced', cd1 !== cd2, `${cd1} -> ${cd2}`);

/* ---------------- 2. views ---------------- */
console.log('\n2. shop / stats / settings');
await page.click('#navShop');
await page.waitForTimeout(250);
ok('shop on', await page.locator('#v-shop.on').count() === 1);
ok('5 shop rows', await page.locator('#shopList .srow').count() === 5, String(await page.locator('#shopList .srow').count()));
ok('5 shop groups', await page.locator('#shopList .group').count() === 5);
eq('shop balance', await page.locator('#shopTok').textContent(), '10');
const poor = await page.evaluate(() => {
  Profile.state.tokens = 3; Profile.save(); __hub.sync();
  const rows = [...document.querySelectorAll('.buy')].map(b => ({ cost: +b.querySelector('b').textContent, off: b.disabled }));
  Profile.state.tokens = 10; Profile.save(); __hub.sync();
  return rows;
});
ok('buy disabled exactly when tokens < cost', poor.every(r => r.off === (3 < r.cost)) && poor.some(r=>r.off),
   JSON.stringify(poor));
await page.screenshot({ path: `${SHOTS}/02-shop.png` });

await page.click('#back'); await page.waitForTimeout(200);
await page.click('#navStats'); await page.waitForTimeout(250);
ok('stats on', await page.locator('#v-stats.on').count() === 1);
ok('5 game stat rows', await page.locator('#statList .grow').count() === 5);
ok('of rendered as x / y', /\d+ \/ 60/.test(await page.locator('#statList').textContent()), (await page.locator('#statList').textContent()).slice(0,80));
await page.screenshot({ path: `${SHOTS}/03-stats.png` });

await page.click('#back'); await page.waitForTimeout(200);
await page.click('#navSet'); await page.waitForTimeout(250);
ok('settings on', await page.locator('#v-settings.on').count() === 1);
ok('version shown', /1\.0\.0/.test(await page.locator('#vers').textContent()));
ok('privacy row hidden in browser', await page.locator('#optPrivacy').isHidden());
await page.screenshot({ path: `${SHOTS}/04-settings.png` });

/* sound + motion write every game's key */
await page.click('#optSound'); await page.waitForTimeout(150);
const muted = await page.evaluate(() => {
  const out = { hub: JSON.parse(localStorage.getItem('playbox:muted')) };
  Registry.games.forEach(g => out[g.slug] = JSON.parse(localStorage.getItem(g.slug+':muted')));
  return out;
});
ok('sound off writes all slugs', Object.values(muted).every(v => v === true), JSON.stringify(muted));
await page.click('#optSound'); await page.waitForTimeout(150);
const unmuted = await page.evaluate(() => Registry.games.map(g => JSON.parse(localStorage.getItem(g.slug+':muted'))));
ok('sound on writes all slugs', unmuted.every(v => v === false), JSON.stringify(unmuted));
await page.click('#optMotion'); await page.waitForTimeout(150);
ok('reduce motion writes vortex:reduce', await page.evaluate(() => JSON.parse(localStorage.getItem('vortex:reduce'))) === true);
await page.click('#optMotion'); await page.waitForTimeout(150);

/* whats-new reachable from settings */
await page.click('#optNew'); await page.waitForTimeout(250);
ok('whatsnew view from settings', await page.locator('#v-new.on').count() === 1);
ok('3 notes', await page.locator('#wnNotes .note-i').count() === 3);
await page.screenshot({ path: `${SHOTS}/05-whatsnew.png` });
await page.click('#wnOk'); await page.waitForTimeout(200);
ok('returns to settings', await page.locator('#v-settings.on').count() === 1);
await page.click('#back'); await page.waitForTimeout(200);

/* ---------------- 3. the five games ---------------- */
console.log('\n3. launch each game, then back');
for (const slug of SLUGS) {
  await page.click(`#tiles .tile[data-slug="${slug}"]`);
  await page.waitForSelector('#frame.on', { timeout: 5000 });
  const f = await page.waitForFunction(s => {
    const fr = document.getElementById('gf');
    return fr.contentDocument && fr.contentDocument.getElementById('cv') ? true : false;
  }, slug, { timeout: 8000 }).then(()=>true).catch(()=>false);
  ok(`${slug}: frame opened`, f);
  await page.waitForTimeout(1600);
  const info = await page.evaluate(() => {
    const w = document.getElementById('gf').contentWindow;
    const d = document.getElementById('gf').contentDocument;
    const c = d.getElementById('cv');
    const ctx = c.getContext('2d');
    const px = ctx.getImageData(0,0,c.width,c.height).data;
    let lit = 0, n = 0, uniq = new Set();
    for (let i = 0; i < px.length; i += 4*37) {
      n++;
      const v = px[i]+px[i+1]+px[i+2];
      if (v > 24) lit++;
      uniq.add((px[i]>>4)+','+(px[i+1]>>4)+','+(px[i+2]>>4));
    }
    const menu = d.querySelector('.screen.on');
    const mb = menu ? menu.getBoundingClientRect() : null;
    return { w:c.width, h:c.height, litPct: +(100*lit/n).toFixed(1), colours: uniq.size,
             menuCovers: !!(mb && mb.width > w.innerWidth*0.8 && mb.height > w.innerHeight*0.5),
             menuText: menu ? menu.innerText.replace(/\s+/g,' ').trim().length : 0,
             booted: !!(w.Engine && w.U && w.UI), title: d.title,
             hosted: !!(w.PB && w.PB.hosted),
             sharedAds: w.Ads === window.Ads };
  });
  ok(`${slug}: booted inside the frame`, info.booted && info.title.length > 0, info.title);
  ok(`${slug}: canvas sized`, info.w > 0 && info.h > 0, `${info.w}x${info.h}`);
  /* "rendered" = the frame is showing real content: either the canvas has
     pixels on it, or the game's own menu screen is laid out over it. */
  ok(`${slug}: frame rendered content`,
     (info.litPct > 0.5 || info.colours > 3) || (info.menuCovers && info.menuText > 20),
     `canvas lit ${info.litPct}% colours ${info.colours}; menu ${info.menuCovers} ${info.menuText} chars`);
  ok(`${slug}: sees the host`, info.hosted && info.sharedAds, `hosted=${info.hosted} sharedAds=${info.sharedAds}`);
  await page.screenshot({ path: `${SHOTS}/06-game-${slug}.png` });

  await page.click('#fBack');
  await page.waitForTimeout(600);
  ok(`${slug}: back to shelf`, await page.locator('#v-shelf.on').count() === 1 &&
     await page.locator('#frame.on').count() === 0);
  const stopped = await page.evaluate(() => {
    const fr = document.getElementById('gf');
    let href = '?';
    try { href = fr.contentWindow.location.href; } catch (e) { href = 'cross-origin'; }
    return { href,
             torn: !(fr.contentDocument && fr.contentDocument.getElementById('cv')),
             noGame: !(fr.contentWindow && fr.contentWindow.Game),
             noAudio: !(fr.contentWindow && fr.contentWindow.Sound) };
  });
  ok(`${slug}: game document torn down (RAF + audio gone)`,
     stopped.href === 'about:blank' && stopped.torn && stopped.noGame && stopped.noAudio,
     JSON.stringify(stopped));
}
eq('launch count recorded', await page.evaluate(() => {
  let t = 0; for (const k in Profile.state.plays) t += Profile.state.plays[k]; return t; }), 5);

/* ---------------- 4. drive a goal to completion ---------------- */
console.log('\n4. daily goals + all-three bonus');
await fresh(() => {
  const day = Profile.dayNumber();
  localStorage.clear();
  localStorage.setItem('playbox:profile', JSON.stringify({
    tokens: 20, streak: 0, maxStreak: 0, lastCompleteDay: 0,
    daily: { day, bonusPaid: false, goals: [
      { id:'echo-3',       game:'echo',     progress: 2, done: false },
      { id:'star-two',     game:'starfall', progress: 1, done: false },
      { id:'vortex-three', game:'vortex',   progress: 2, done: false }
    ]},
    boosts: {}, plays: {}, seenVersion: '1.0.0', firstRunPaid: true
  }));
});
eq('seeded tokens', await page.locator('#tokN').textContent(), '20');
eq('seeded progress row 1', (await page.locator('#goals .goal').nth(0).locator('.gp').textContent()), '2/3');

let res = await page.evaluate(() => PB_HOST.report({ game:'echo', type:'level', level:3, pingsLeft:0, time:99 }));
eq('echo goal paid 3', res.tokens, 3);
eq('echo goal completed', res.completed.length, 1);
eq('tokens after goal 1', await page.locator('#tokN').textContent(), '23');
ok('row 1 shows done', await page.locator('#goals .goal').nth(0).evaluate(e => e.classList.contains('ok')));
ok('row 1 has a tick', await page.locator('#goals .goal').nth(0).locator('svg.tick').count() === 1);
eq('daily counter', await page.locator('#dCount').textContent(), '1 / 3');
ok('report returns Profile.report value', 'allDone' in res && 'streak' in res);

res = await page.evaluate(() => PB_HOST.report({ game:'starfall', type:'run', score:10, assists:0 }));
eq('starfall goal paid 3', res.tokens, 3);
res = await page.evaluate(() => PB_HOST.report({ game:'vortex', type:'run', score:2, zone:0 }));
eq('third goal + bonus paid 8', res.tokens, 8);
ok('allDone true', res.allDone === true);
eq('tokens after all three', await page.locator('#tokN').textContent(), '34');
ok('card celebrates', await page.locator('#daily.done').count() === 1);
ok('celebration names the streak', /streak/i.test(await page.locator('#dCheer').textContent()), await page.locator('#dCheer').textContent());
ok('streak pill visible', await page.locator('#stkPill').isVisible());
eq('streak = 1', await page.locator('#stkN').textContent(), '1');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/07-daily-complete.png` });

res = await page.evaluate(() => PB_HOST.report({ game:'vortex', type:'run', score:9, zone:0 }));
eq('bonus pays exactly once', res.tokens, 0);
eq('tokens unchanged after extra report', await page.locator('#tokN').textContent(), '34');

/* ---------------- 5. purchase + takeBoost ---------------- */
console.log('\n5. shop purchase and boost hand-off');
await page.click('#navShop'); await page.waitForTimeout(250);
const before = await page.evaluate(() => Profile.tokens);
await page.click('.buy[data-key="echo_pings"]');
await page.waitForTimeout(250);
const after = await page.evaluate(() => ({ tokens: Profile.tokens, boost: Profile.peekBoost('echo_pings') }));
eq('tokens went down by cost', before - after.tokens, 4);
eq('boost went up by grant', after.boost, 3);
eq('shop balance re-rendered', await page.locator('#shopTok').textContent(), String(after.tokens));
ok('stock shown', /3 in stock/.test(await page.locator('#shopList').textContent()));
const took = await page.evaluate(() => ({ got: PB_HOST.takeBoost('echo_pings', 3), left: PB_HOST.peekBoost('echo_pings') }));
eq('takeBoost returns the grant', took.got, 3);
eq('takeBoost leaves zero', took.left, 0);
await page.screenshot({ path: `${SHOTS}/08-shop-after-buy.png` });
await page.click('#back'); await page.waitForTimeout(200);

/* ---------------- 6. streak logic ---------------- */
console.log('\n6. streak continue / reset');
function seedStreak(daysAgo, streak) {
  return `(() => {
    const day = Profile.dayNumber();
    localStorage.clear();
    localStorage.setItem('playbox:profile', JSON.stringify({
      tokens: 0, streak: ${streak}, maxStreak: ${streak}, lastCompleteDay: day - ${daysAgo},
      daily: { day, bonusPaid: false, goals: [
        { id:'echo-3', game:'echo', progress: 2, done: false },
        { id:'star-two', game:'starfall', progress: 1, done: false },
        { id:'vortex-three', game:'vortex', progress: 2, done: false }
      ]},
      boosts: {}, plays: {}, seenVersion: '1.0.0', firstRunPaid: true
    }));
  })()`;
}
async function completeAll() {
  await page.evaluate(() => PB_HOST.report({ game:'echo', type:'level', pingsLeft:0, time:99 }));
  await page.evaluate(() => PB_HOST.report({ game:'starfall', type:'run', score:1, assists:0 }));
  return page.evaluate(() => PB_HOST.report({ game:'vortex', type:'run', score:1, zone:0 }));
}
await page.goto(HUB); await page.waitForFunction(() => !!window.__hub);
await page.evaluate(seedStreak(1, 4)); await page.reload(); await page.waitForFunction(() => !!window.__hub);
let r = await completeAll();
eq('yesterday -> streak increments', r.streak, 5);
eq('streak pill shows 5', await page.locator('#stkN').textContent(), '5');
eq('best streak updated', await page.evaluate(() => Profile.state.maxStreak), 5);

await page.goto(HUB); await page.waitForFunction(() => !!window.__hub);
await page.evaluate(seedStreak(3, 4)); await page.reload(); await page.waitForFunction(() => !!window.__hub);
r = await completeAll();
eq('three days ago -> streak resets to 1', r.streak, 1);
eq('streak pill shows 1', await page.locator('#stkN').textContent(), '1');

/* stale daily rolls over and drops a broken run */
await page.goto(HUB); await page.waitForFunction(() => !!window.__hub);
await page.evaluate(`(() => {
  const day = Profile.dayNumber();
  localStorage.clear();
  localStorage.setItem('playbox:profile', JSON.stringify({
    tokens: 7, streak: 6, maxStreak: 6, lastCompleteDay: day - 3,
    daily: { day: day - 1, bonusPaid: true, goals: [] },
    boosts: {}, plays: {}, seenVersion: '1.0.0', firstRunPaid: true
  }));
})()`);
await page.reload(); await page.waitForFunction(() => !!window.__hub);
eq('stale daily rolled over', await page.evaluate(() => Profile.state.daily.day), await page.evaluate(() => Profile.dayNumber()));
eq('broken run cleared', await page.evaluate(() => Profile.state.streak), 0);
eq('best streak kept', await page.evaluate(() => Profile.state.maxStreak), 6);
ok('mid-streak returning player renders', await page.locator('#goals .goal').count() === 3);

/* ---------------- 7. what's-new on upgrade ---------------- */
console.log('\n7. whats-new gating');
await page.goto(HUB); await page.waitForFunction(() => !!window.__hub);
await page.evaluate(`(() => {
  localStorage.clear();
  localStorage.setItem('playbox:profile', JSON.stringify({
    tokens: 3, streak: 0, maxStreak: 0, lastCompleteDay: 0, daily: null,
    boosts: {}, plays: {}, seenVersion: '0.9.0', firstRunPaid: true
  }));
})()`);
await page.reload(); await page.waitForFunction(() => !!window.__hub);
await page.waitForTimeout(250);
ok('older seenVersion shows the sheet on launch', await page.locator('#v-new.on').count() === 1);
ok('names games added since', await page.locator('#wnAdded').isVisible() &&
   /Echo/.test(await page.locator('#wnAdded').textContent()), await page.locator('#wnAdded').textContent());
eq('seenVersion advanced', await page.evaluate(() => Profile.state.seenVersion), '1.0.0');
await page.screenshot({ path: `${SHOTS}/09-whatsnew-upgrade.png` });
await page.click('#wnOk'); await page.waitForTimeout(250);
ok('continues to the shelf', await page.locator('#v-shelf.on').count() === 1);
ok('NEW badges on games added since 0.9.0', await page.locator('#tiles .badge:visible').count() === 5,
   String(await page.locator('#tiles .badge:visible').count()));
await page.screenshot({ path: `${SHOTS}/10-shelf-new-badges.png` });
await page.reload(); await page.waitForFunction(() => !!window.__hub);
await page.waitForTimeout(200);
ok('sheet shows only once', await page.locator('#v-shelf.on').count() === 1);
ok('badges gone after seeing it', await page.locator('#tiles .badge:visible').count() === 0);

/* ---------------- 8. back button + backgrounding ---------------- */
console.log('\n8. hardware back and backgrounding');
await page.click('#tiles .tile[data-slug="vortex"]');
await page.waitForSelector('#frame.on');
await page.waitForTimeout(900);
await page.goBack();
await page.waitForTimeout(600);
ok('popstate leaves the game, not the app', await page.locator('#v-shelf.on').count() === 1 &&
   await page.evaluate(() => { try { return document.getElementById('gf').contentWindow.location.href; } catch(e){ return 'x'; } }) === 'about:blank');
ok('still on the hub document', page.url() === HUB, page.url());

await page.click('#tiles .tile[data-slug="prism"]');
await page.waitForSelector('#frame.on');
await page.waitForTimeout(700);
const exited = await page.evaluate(() => { PB_HOST.exit(); return true; });
await page.waitForTimeout(600);
ok('PB_HOST.exit closes the frame', await page.locator('#frame.on').count() === 0);

const timers = await page.evaluate(async () => {
  Game.onBackground();
  return { clockStopped: true };
});
ok('onBackground defined and callable', timers.clockStopped);
const beforeHidden = await page.locator('#dCd').textContent();
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(1600);
const afterHidden = await page.locator('#dCd').textContent();
ok('countdown timer stops when backgrounded', beforeHidden === afterHidden, `${beforeHidden} / ${afterHidden}`);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(1400);
ok('countdown resumes on foreground', (await page.locator('#dCd').textContent()) !== afterHidden);

/* ---------------- narrow phone ---------------- */
console.log('\n9. 360px phone');
await page.setViewportSize({ width: 360, height: 640 });
await page.waitForTimeout(400);
ok('no h-overflow at 360', await page.evaluate(() => document.documentElement.scrollWidth <= 361),
   String(await page.evaluate(() => document.documentElement.scrollWidth)));
ok('header fits at 360', await page.evaluate(() => {
  const t = document.getElementById('top');
  return t.scrollWidth <= t.clientWidth + 1;
}));
ok('scrolls to the bottom tile', await page.evaluate(() => {
  const s = document.getElementById('scroll');
  s.scrollTop = s.scrollHeight;
  const last = document.querySelector('#tiles .tile:last-child').getBoundingClientRect();
  return last.bottom <= window.innerHeight + 1 && last.top > 0;
}));
await page.screenshot({ path: `${SHOTS}/11-shelf-360.png` });
await page.setViewportSize({ width: 405, height: 720 });

/* ---------------- goal row launches its game ---------------- */
console.log('\n9b. tapping a goal row opens that game');
await page.goto(HUB); await page.waitForFunction(() => !!window.__hub);
const goalSlug = await page.locator('#goals .goal').nth(1).getAttribute('data-slug');
await page.click('#goals .goal >> nth=1');
await page.waitForSelector('#frame.on', { timeout: 5000 });
await page.waitForTimeout(900);
ok('goal row opened its own game', await page.evaluate(() => {
  try { return document.getElementById('gf').contentWindow.location.href; } catch(e){ return ''; }
}).then(h => h.includes(`games/${goalSlug}/`)), goalSlug);
eq('frame bar names the game', (await page.locator('#fName span').textContent()),
   await page.evaluate(s => Registry.by(s).name, goalSlug));
await page.click('#fBack'); await page.waitForTimeout(500);
ok('goal row round trip returns to the shelf', await page.locator('#v-shelf.on').count() === 1);

/* ---------------- localStorage that throws ---------------- */
console.log('\n9c. hostile localStorage');
const hostile = await ctx.newPage();
attach(hostile);
await hostile.addInitScript(() => {
  const boom = () => { throw new DOMException('denied', 'SecurityError'); };
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }; }
    });
  } catch (e) {}
});
await hostile.goto(HUB);
await hostile.waitForFunction(() => !!window.__hub, null, { timeout: 5000 });
await hostile.waitForTimeout(500);
ok('renders with localStorage denied', await hostile.locator('#v-shelf.on').count() === 1 &&
   await hostile.locator('#tiles .tile').count() === 5 &&
   await hostile.locator('#goals .goal').count() === 3);
ok('shop and settings survive it', await hostile.evaluate(() => {
  __hub.go('shop'); __hub.go('settings'); __hub.go('stats'); __hub.go('shelf');
  return document.querySelectorAll('.srow').length === 5;
}));
ok('a report still returns a result', await hostile.evaluate(() =>
  !!PB_HOST.report({ game: 'vortex', type: 'run', score: 20, zone: 1 })));
await hostile.screenshot({ path: `${SHOTS}/12-no-storage.png` });
await hostile.close();

/* ---------------- console hygiene ---------------- */
console.log('\n10. console + network');
ok('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));
ok('zero console errors', errors.length === 0, errors.slice(0,6).join(' | '));
ok('zero console warnings', warnings.length === 0, warnings.slice(0,6).join(' | '));

await browser.close();
console.log(`\n${checks - fails}/${checks} checks passed, ${fails} failed`);
fs.writeFileSync('/tmp/pbtest/result.txt', `${checks-fails}/${checks} passed, ${fails} failed\n`);
process.exit(fails ? 1 : 0);
