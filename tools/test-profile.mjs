/* ============================================================
   Locks in the profile fixes. Every case here is a bug that was
   found in review and is easy to reintroduce.
     node tools/test-profile.mjs
   Runs registry.js + profile.js in a page with a faked clock.
   ============================================================ */
import { launch } from './browser.mjs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const browser = await launch();
/* an http origin, so localStorage behaves as it does on device */
const http = await import('node:http');
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><meta charset=utf-8><body>'); });
await new Promise(r => srv.listen(8119, r));

const page = await browser.newPage();
const perrs = [];
page.on('pageerror', e => perrs.push(e.message));
await page.goto('http://localhost:8119/');
await page.addScriptTag({ path: path.join(ROOT, 'shared/registry.js') });
await page.addScriptTag({ path: path.join(ROOT, 'shared/profile.js') });

let fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log('  \x1b[32mok  \x1b[0m ' + name); }
  catch (e) { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + ' — ' + e.message); }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

/* run a scenario in the page: fresh storage, a fixed "today", a body of work */
const run = (day, body) => page.evaluate(([day, body]) => {
  localStorage.clear();
  const P = window.Profile;
  P._reset();
  /* fake the clock by handing refresh() an explicit date */
  const dateFor = d => new Date(Date.UTC(2026, 0, 1) + (d - 1) * 86400000 + 12 * 3600000);
  window.__dateFor = dateFor;
  P.refresh(dateFor(day));
  // eslint-disable-next-line no-new-func
  return new Function('P', 'dateFor', 'Registry', body)(P, dateFor, window.Registry);
}, [day, body]);

/* satisfy every goal in today's challenge */
const COMPLETE = `
  var d = P.state.daily, out = [];
  d.goals.forEach(function (slot) {
    var g = Registry.goal(slot.id);
    for (var i = 0; i < g.need; i++) {
      out.push(P.report(payloadFor(slot.game, slot.id)));
    }
  });
  return out;
`;
/* a payload generous enough to satisfy any goal of that game */
const PAYLOADS = `
  function payloadFor(game, id) {
    var base = { game: game };
    if (game === 'echo')      return Object.assign(base, { type: 'level', level: 3, pingsLeft: 5, time: 10 });
    if (game === 'starfall')  return Object.assign(base, { type: 'run', score: 900, assists: 5, continued: false });
    if (game === 'prism')     return Object.assign(base, { type: 'level', level: 3, stars: 3, turns: 4, hintsUsed: 0 });
    if (game === 'vortex')    return Object.assign(base, { type: 'run', score: 40, zone: 2, continued: false });
    if (game === 'dailylock') return Object.assign(base, { type: 'practice', won: true, tries: 3 });
    return base;
  }
`;

console.log('\nshared/profile.js — the cases review found\n');

await t('a fresh profile pays the first-run tokens exactly once', async () => {
  const r = await run(300, `
    var a = P.tokens; P.refresh(dateFor(300)); P.refresh(dateFor(300));
    return { a: a, b: P.tokens };
  `);
  eq(r, { a: P_FIRST(), b: P_FIRST() }, 'first-run tokens');
});
function P_FIRST() { return 10; }

await t('the daily challenge is 3 goals from 3 different games, same for every device', async () => {
  const r = await run(300, `
    var mine = P.state.daily.goals.map(function (g) { return g.id; });
    var again = Registry ? null : null;
    localStorage.clear(); P._reset(); P.refresh(dateFor(300));
    var theirs = P.state.daily.goals.map(function (g) { return g.id; });
    var games = P.state.daily.goals.map(function (g) { return g.game; });
    return { mine: mine, theirs: theirs, distinct: new Set(games).size, n: mine.length };
  `);
  eq(r.n, 3, 'goal count');
  eq(r.distinct, 3, 'distinct games');
  eq(r.mine, r.theirs, 'deterministic from the date');
});

await t('completing all three pays the bonus once, not twice', async () => {
  const r = await run(300, PAYLOADS + `
    var res = (function () { ${COMPLETE} })();
    var afterAll = P.tokens;
    var extra = P.report(payloadFor(P.state.daily.goals[0].game, null));
    return { tokens: afterAll, afterExtra: P.tokens, bonusPaid: P.state.daily.bonusPaid,
             streak: P.state.streak };
  `);
  eq(r.bonusPaid, true, 'bonusPaid');
  eq(r.streak, 1, 'streak starts at 1');
  eq(r.afterExtra, r.tokens, 'no second bonus');
  if (r.tokens !== 10 + 3 * 3 + 5) throw new Error('expected 10 + 9 + 5 = 24, got ' + r.tokens);
});

await t('a consecutive day advances the streak; a missed day resets it', async () => {
  const r = await run(300, PAYLOADS + `
    (function () { ${COMPLETE} })();
    var s1 = P.state.streak;
    P.refresh(dateFor(301));
    (function () { ${COMPLETE} })();
    var s2 = P.state.streak;
    P.refresh(dateFor(305));                 // four days later
    var s3 = P.state.streak;
    (function () { ${COMPLETE} })();
    var s4 = P.state.streak;
    return { s1: s1, s2: s2, s3: s3, s4: s4, max: P.state.maxStreak };
  `);
  eq([r.s1, r.s2, r.s3, r.s4], [1, 2, 0, 1], 'streak progression');
  eq(r.max, 2, 'maxStreak remembers the best run');
});

await t('winding the clock BACK cannot re-open a finished day or farm tokens', async () => {
  const r = await run(300, PAYLOADS + `
    (function () { ${COMPLETE} })();
    var t1 = P.tokens, s1 = P.state.streak;
    P.refresh(dateFor(299));                 // clock moved back a day
    var day = P.state.daily.day;
    var paid = P.state.daily.bonusPaid;
    (function () { ${COMPLETE} })();
    return { t1: t1, t2: P.tokens, s1: s1, s2: P.state.streak, day: day, paid: paid };
  `);
  eq(r.day, 300, 'the day did not go backwards');
  eq(r.paid, true, 'still the same completed challenge');
  eq(r.t2, r.t1, 'no tokens farmed');
  eq(r.s2, r.s1, 'no streak inflation');
});

await t('a run finishing after UTC midnight is graded against the day it started', async () => {
  const r = await run(300, PAYLOADS + `
    var slot = P.state.daily.goals[0];
    var g = Registry.goal(slot.id);
    for (var i = 0; i < g.need; i++) P.report(payloadFor(slot.game, slot.id));
    var doneBefore = P.state.daily.goals[0].done;
    /* the clock is now tomorrow, but no refresh has run: report must not
       silently swap the challenge out from under the finished run */
    var slot2 = P.state.daily.goals[1];
    var g2 = Registry.goal(slot2.id);
    for (var j = 0; j < g2.need; j++) P.report(payloadFor(slot2.game, slot2.id));
    return { day: P.state.daily.day, doneBefore: doneBefore,
             done: P.state.daily.goals.slice(0, 2).map(function (s) { return s.done; }) };
  `);
  eq(r.day, 300, 'still on the day the player was shown');
  eq(r.done, [true, true], 'both goals kept their progress');
});

await t('a goal or game removed by an update regenerates the day instead of dead-ending', async () => {
  const r = await run(300, `
    var before = P.state.daily.goals.map(function (g) { return g.id; });
    var gone = before[0], goneGame = P.state.daily.goals[0].game;
    /* an update that renames or drops a goal removes it from the registry, so
       the regenerated day must not be able to pick it again either */
    var entry = Registry.by(goneGame);
    var kept = entry.goals;
    entry.goals = kept.filter(function (g) { return g.id !== gone; });
    P.refresh(dateFor(300));
    var after = P.state.daily.goals.map(function (g) { return g.id; });
    entry.goals = kept;
    return { before: before, after: after, stillGone: after.indexOf(gone),
             n: after.length, distinct: new Set(P.state.daily.goals.map(function (g) { return g.game; })).size };
  `);
  eq(r.stillGone, -1, 'the dead goal is gone');
  eq(r.n, 3, 'still three goals');
  eq(r.distinct, 3, 'still three different games');
  if (JSON.stringify(r.before) === JSON.stringify(r.after)) throw new Error('the day was not regenerated');
});

await t('a boost survives a failing localStorage, and is spent exactly once', async () => {
  const r = await run(300, `
    P.state.tokens = 20; P.save();
    var row = Registry.shopRows()[0];
    var bought = P.buy(row);
    var after = P.tokens;
    /* now make every write fail, the way a full or private-mode store does */
    var real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function () { throw new Error('quota'); };
    var t1 = P.takeBoost(row.key, 99);
    var t2 = P.takeBoost(row.key, 99);
    var tokensNow = P.tokens, streakNow = P.state.streak;
    localStorage.setItem = real;
    return { bought: bought, after: after, grant: row.grant, t1: t1, t2: t2,
             tokensNow: tokensNow, cost: row.cost };
  `);
  eq(r.bought, true, 'purchase succeeded');
  eq(r.after, 20 - r.cost, 'tokens deducted once');
  eq(r.t1, r.grant, 'the whole boost is handed over');
  eq(r.t2, 0, 'and cannot be claimed twice');
  eq(r.tokensNow, 20 - r.cost, 'a failed save does not roll tokens back');
});

await t('a corrupt stored profile does not wipe the player', async () => {
  const r = await page.evaluate(() => {
    const P = window.Profile;
    localStorage.clear(); P._reset();
    P.state.tokens = 42; P.state.streak = 7; P.save();
    localStorage.setItem('playbox:profile', '{not json');
    P.read();
    return { tokens: P.tokens, streak: P.state.streak };
  });
  eq(r, { tokens: 42, streak: 7 }, 'in-memory profile survived');
});

await t('buy() refuses when the player cannot afford it', async () => {
  const r = await run(300, `
    P.state.tokens = 1; P.save();
    var row = Registry.shopRows()[0];
    return { ok: P.buy(row), tokens: P.tokens, boost: P.peekBoost(row.key) };
  `);
  eq(r.ok, false, 'refused');
  eq(r.tokens, 1, 'no tokens taken');
  eq(r.boost, 0, 'no boost granted');
});

await t('every game has a stat row and every shop key a real grant', async () => {
  const r = await page.evaluate(() => {
    const R = window.Registry, P = window.Profile;
    return {
      stats: R.games.map(g => P.gameStat(g.slug)).filter(s => !s || typeof s.primary !== 'number').length,
      rows: R.shopRows().filter(r => !(r.cost > 0) || !(r.grant > 0) || !r.key).length,
      goals: R.allGoals().filter(g => typeof g.count !== 'function' || !(g.need > 0)).length
    };
  });
  eq(r, { stats: 0, rows: 0, goals: 0 }, 'registry integrity');
});

await t('no page errors throughout', () => { if (perrs.length) throw new Error(perrs[0]); });

await browser.close();
srv.close();
console.log(fail ? `\n\x1b[31m${fail} FAILED\x1b[0m\n` : '\n\x1b[32mprofile logic is correct\x1b[0m\n');
process.exit(fail ? 1 : 0);
