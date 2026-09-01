/* ============================================================
   Cross-game profile: tokens, boosts, the daily challenge and
   the streak. This is the layer that makes one app worth more
   than five — a player who came for one game gets a reason to
   open another, and a reason to come back tomorrow.

   Pure logic, no DOM. Owned by the hub; games reach the parts
   they need through shared/pb-child.js.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY   = 'playbox:profile';
  var EPOCH = Date.UTC(2026, 0, 1);      // day 1 = 2026-01-01 UTC

  var TOKENS_PER_GOAL = 3;
  var TOKENS_ALL_THREE = 5;
  var TOKENS_FIRST_RUN = 10;             // so the shop isn't a locked door
  var GOALS_PER_DAY = 3;

  function blank() {
    return {
      tokens: 0,
      streak: 0, maxStreak: 0,
      lastCompleteDay: 0,                // last day all three goals were done
      maxDaySeen: 0,                     // high-water mark; blocks clock-rollback farming
      daily: null,                       // { day, goals:[{id,game,progress,done}], bonusPaid }
      boosts: {},                        // { echo_pings: 3, ... }
      plays: {},                         // { slug: launch count }
      seenVersion: null,                 // for the what's-new sheet
      firstRunPaid: false
    };
  }

  var S = blank();

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var got = JSON.parse(raw);
        var base = blank();
        for (var k in base) if (got[k] !== undefined) base[k] = got[k];
        S = base;
      }
    } catch (e) {
      /* A corrupt or unreadable value must not cost the player their profile.
         Keep whatever is in memory; the next save rewrites a valid document. */
    }
    return S;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  /* ---------------- dates ---------------- */
  function dayNumber(d) {
    d = d || new Date();
    return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - EPOCH) / 86400000) + 1;
  }
  function msUntilNextDay(d) {
    d = d || new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime();
  }

  /* deterministic PRNG so everyone gets the same challenge */
  function rngFor(day) {
    var s = (day * 2654435761) >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* ---------------- the daily challenge ---------------- */
  /* Three goals, each from a different game, chosen from the date alone.
     Deterministic, so it is the same challenge on every device — which is
     what makes it worth talking about. */
  function pickGoals(day) {
    var rand = rngFor(day);
    var pool = (global.Registry ? Registry.allGoals() : []);
    var byGame = {};
    pool.forEach(function (g) { (byGame[g.game] = byGame[g.game] || []).push(g); });

    var slugs = Object.keys(byGame);
    /* Fisher-Yates with the seeded PRNG */
    for (var i = slugs.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = slugs[i]; slugs[i] = slugs[j]; slugs[j] = t;
    }
    var out = [];
    for (var k = 0; k < slugs.length && out.length < GOALS_PER_DAY; k++) {
      var list = byGame[slugs[k]];
      var pick = list[Math.floor(rand() * list.length)];
      out.push({ id: pick.id, game: pick.game, progress: 0, done: false });
    }
    return out;
  }

  /* Rolls the challenge over when the UTC date changes, and settles the
     streak. Call this before reading `daily` anywhere. */
  function refresh(now) {
    var day = dayNumber(now);

    /* The device clock is not trustworthy. Winding it back would otherwise
       regenerate a day that was already completed and pay for it again, and
       rewrite lastCompleteDay so the streak could be advanced twice in one
       real day. A high-water mark makes the day monotonic. */
    if (day < (S.maxDaySeen || 0)) day = S.maxDaySeen;
    else if (day > (S.maxDaySeen || 0)) { S.maxDaySeen = day; save(); }

    /* A goal or a game can disappear in an update. A stored slot pointing at
       one is a dead end for the rest of the day, so treat it as a new day. */
    var stale = !!(S.daily && S.daily.goals.some(function (slot) {
      return !global.Registry || !Registry.goal(slot.id) || !Registry.by(slot.game);
    }));

    if (!S.daily || S.daily.day !== day || stale) {
      /* A day with no completion, other than yesterday's grace, ends a run. */
      if (S.streak > 0 && S.lastCompleteDay < day - 1) S.streak = 0;
      S.daily = { day: day, goals: pickGoals(day), bonusPaid: false };
      save();
    }
    if (!S.firstRunPaid) {
      S.firstRunPaid = true;
      S.tokens += TOKENS_FIRST_RUN;
      save();
    }
    return S.daily;
  }

  /* ---------------- events from games ---------------- */
  /* ev: { game:'echo', type:'level', ...whatever the goal reads }
     Returns a summary the hub can turn into a toast. */
  function report(ev) {
    if (!ev || !ev.game) return { tokens: 0, completed: [], allDone: false };

    /* Deliberately NOT refresh() here. A run that started at 23:58 and ends at
       00:01 must be graded against the challenge the player was shown, not
       against tomorrow's — rolling over here threw away the finished day's
       progress and scored the run against goals the player never saw. The hub
       rolls the day over on its own clock, which only ticks with no game open. */
    if (!S.daily) refresh();

    var gained = 0, completed = [];
    S.daily.goals.forEach(function (slot) {
      if (slot.done || slot.game !== ev.game) return;
      var goal = global.Registry ? Registry.goal(slot.id) : null;
      if (!goal || typeof goal.count !== 'function') return;
      var hit = false;
      try { hit = !!goal.count(ev); } catch (e) { hit = false; }
      if (!hit) return;
      slot.progress++;
      if (slot.progress >= goal.need) {
        slot.done = true;
        gained += TOKENS_PER_GOAL;
        completed.push({ id: slot.id, text: goal.text });
      }
    });

    var allDone = S.daily.goals.length > 0 && S.daily.goals.every(function (s) { return s.done; });
    if (allDone && !S.daily.bonusPaid) {
      S.daily.bonusPaid = true;
      gained += TOKENS_ALL_THREE;
      if (S.lastCompleteDay !== S.daily.day) {
        /* Yesterday keeps the run alive; anything older starts a new one. */
        S.streak = (S.lastCompleteDay === S.daily.day - 1) ? S.streak + 1 : 1;
        S.lastCompleteDay = S.daily.day;
        if (S.streak > S.maxStreak) S.maxStreak = S.streak;
      }
    }
    S.tokens += gained;
    save();
    return { tokens: gained, completed: completed, allDone: allDone, streak: S.streak };
  }

  function noteLaunch(slug) {
    refresh();
    S.plays[slug] = (S.plays[slug] || 0) + 1;
    save();
  }

  /* ---------------- tokens and boosts ---------------- */
  function buy(row) {
    if (!row || S.tokens < row.cost) return false;
    S.tokens -= row.cost;
    S.boosts[row.key] = (S.boosts[row.key] || 0) + row.grant;
    save();
    return true;
  }

  /* Games claim boosts through this. Decrements, so a boost is spent once.
     No re-read: games do not load this file — PB.takeBoost runs in the hub's
     own realm against this same S, and JS is single-threaded. Re-reading here
     used to revert every unsaved change (a failed save, or a rollover) back to
     the last snapshot on disk. */
  function takeBoost(key, max) {
    var have = S.boosts[key] || 0;
    if (have <= 0) return 0;
    var take = (max === undefined) ? have : Math.min(have, max);
    S.boosts[key] = have - take;
    save();
    return take;
  }
  function peekBoost(key) { return S.boosts[key] || 0; }

  /* ---------------- stats, read from each game's own storage ---------------- */
  /* The games are unchanged in how they save; the hub just knows where to look.
     Keeping this in one place means a new game adds one case, not a refactor. */
  function gameStat(slug) {
    function g(key, dflt) {
      try {
        var v = localStorage.getItem(slug + ':' + key);
        return v === null ? dflt : JSON.parse(v);
      } catch (e) { return dflt; }
    }
    switch (slug) {
      case 'echo':      return { primary: Math.max(0, g('unlocked', 1) - 1), label: 'levels cleared', of: 60 };
      case 'prism':      var st = g('stars', {}); var sum = 0;
                         for (var k in st) sum += st[k] || 0;
                         return { primary: sum, label: 'stars', of: 135 };
      case 'starfall':   return { primary: g('best', 0), label: 'best light years' };
      case 'vortex':     return { primary: g('best', 0), label: 'best score' };
      case 'dailylock':  var s = g('stats', null);
                         return { primary: (s && s.streak) || 0, label: 'day streak' };
      default:           return { primary: 0, label: 'played' };
    }
  }

  global.Profile = {
    read: read, save: save, refresh: refresh,
    get state() { return S; },
    get tokens() { return S.tokens; },
    dayNumber: dayNumber, msUntilNextDay: msUntilNextDay,
    pickGoals: pickGoals,
    report: report, noteLaunch: noteLaunch,
    buy: buy, takeBoost: takeBoost, peekBoost: peekBoost,
    gameStat: gameStat,
    /* exposed for tests */
    _blank: blank, _reset: function () { S = blank(); save(); },
    TOKENS_PER_GOAL: TOKENS_PER_GOAL, TOKENS_ALL_THREE: TOKENS_ALL_THREE,
    TOKENS_FIRST_RUN: TOKENS_FIRST_RUN, GOALS_PER_DAY: GOALS_PER_DAY
  };
})(window);
