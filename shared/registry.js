/* ============================================================
   THE GAME REGISTRY  —  the extension point.
   ------------------------------------------------------------
   To add a game to Playbox in an update:
     1. drop its folder into games/<slug>/
     2. add one entry to GAMES below, with `since` set to the
        versionName you are about to ship
     3. bump versionCode + versionName in app.config.json
     4. ./tools/build-android.sh
   The hub picks it up from here — shelf tile, NEW badge,
   what's-new entry, daily-challenge pool, shop rows. Nothing
   else in the app needs to know the game exists.

   `tools/new-game.mjs <slug>` scaffolds a working skeleton that
   already satisfies shared/CONTRACT.md.
   ============================================================ */
(function (global) {
  'use strict';

  var GAMES = [
    {
      slug: 'echo', name: 'Echo', tagline: 'See with sound',
      kind: 'Puzzle', detail: '60 levels', accent: '#4ee1c1',
      since: '1.0.0',
      blurb: 'A maze you cannot see. Ping to light the walls, then remember.',
      /* Daily-challenge goals. `ev` is whatever the game reports.
         Keep each goal reachable in about a minute. */
      goals: [
        { id: 'echo-3',      text: 'Clear 3 levels in Echo',
          need: 3, count: function (ev) { return ev.type === 'level'; } },
        { id: 'echo-spare',  text: 'Clear an Echo level with 2 pings to spare',
          need: 1, count: function (ev) { return ev.type === 'level' && ev.pingsLeft >= 2; } },
        { id: 'echo-quick',  text: 'Clear an Echo level in under 40 seconds',
          need: 1, count: function (ev) { return ev.type === 'level' && ev.time < 40; } }
      ],
      /* Shop rows. `key` is the boost the game claims via PB.takeBoost. */
      shop: [
        { key: 'echo_pings', label: '3 extra pings', note: 'Added to your next Echo level', cost: 4, grant: 3 }
      ]
    },
    {
      slug: 'starfall', name: 'Starfall', tagline: 'Slingshot the galaxy',
      kind: 'Arcade', detail: 'Endless', accent: '#ffc857',
      since: '1.0.0',
      blurb: 'You never steer. You launch, and gravity bends the flight.',
      goals: [
        { id: 'star-400',    text: 'Reach 400 light years in Starfall',
          need: 1, count: function (ev) { return ev.type === 'run' && ev.score >= 400; } },
        { id: 'star-assist', text: 'Chain 3 gravity assists in one Starfall run',
          need: 1, count: function (ev) { return ev.type === 'run' && ev.assists >= 3; } },
        { id: 'star-two',    text: 'Finish 2 Starfall runs',
          need: 2, count: function (ev) { return ev.type === 'run' && !ev.continued; } }
      ],
      shop: [
        { key: 'starfall_continue', label: 'One free continue', note: 'Skip the ad on your next run', cost: 6, grant: 1 }
      ]
    },
    {
      slug: 'prism', name: 'Prism', tagline: 'Split the light',
      kind: 'Puzzle', detail: '45 levels', accent: '#7c5cff',
      since: '1.0.0',
      blurb: 'Split white light into colour, then put it back together.',
      goals: [
        { id: 'prism-2',     text: 'Solve 2 Prism puzzles',
          need: 2, count: function (ev) { return ev.type === 'level'; } },
        { id: 'prism-3star', text: 'Three-star a Prism puzzle',
          need: 1, count: function (ev) { return ev.type === 'level' && ev.stars >= 3; } },
        { id: 'prism-nohint',text: 'Solve a Prism puzzle without a hint',
          need: 1, count: function (ev) { return ev.type === 'level' && ev.hintsUsed === 0; } }
      ],
      shop: [
        { key: 'prism_hints', label: '3 hints', note: 'Usable on any Prism puzzle', cost: 5, grant: 3 }
      ]
    },
    {
      slug: 'vortex', name: 'Vortex', tagline: "Don't touch the walls",
      kind: 'Arcade', detail: '8 zones', accent: '#43d9ff',
      since: '1.0.0',
      blurb: 'Rings collapse inward around a core. Be in the gap.',
      goals: [
        { id: 'vortex-15',   text: 'Score 15 in Vortex',
          need: 1, count: function (ev) { return ev.type === 'run' && ev.score >= 15; } },
        /* Zone n starts at 25n points, so this one is the stretch goal of the
           pool. The text says the number so it does not read as a short hop. */
        { id: 'vortex-zone', text: 'Reach Zone 2 in Vortex (25 points)',
          need: 1, count: function (ev) { return ev.type === 'run' && ev.zone >= 1; } },
        /* `continued` excludes revived runs, or one run plus a revive would
           count as two. */
        { id: 'vortex-three',text: 'Finish 3 Vortex runs',
          need: 3, count: function (ev) { return ev.type === 'run' && !ev.continued; } }
      ],
      shop: [
        { key: 'vortex_revive', label: 'One free revive', note: 'Skip the ad on your next run', cost: 6, grant: 1 }
      ]
    },
    {
      slug: 'dailylock', name: 'Daily Lock', tagline: 'One lock a day',
      kind: 'Daily', detail: 'New each day', accent: '#4ee1c1',
      since: '1.0.0',
      blurb: 'One deduction lock a day, the same for everyone, in no language.',
      /* These accept practice as well as the daily lock on purpose. Today's
         lock can be lost, and once it is, S.done blocks it for the rest of the
         day — a daily-only goal would leave the whole challenge unwinnable
         through no further fault of the player. Practice is unlimited. */
      goals: [
        { id: 'lock-crack',  text: 'Crack a lock in Daily Lock',
          need: 1, count: function (ev) { return (ev.type === 'daily' || ev.type === 'practice') && ev.won; } },
        { id: 'lock-four',   text: 'Crack a lock in 4 tries or fewer',
          need: 1, count: function (ev) { return (ev.type === 'daily' || ev.type === 'practice') && ev.won && ev.tries <= 4; } },
        { id: 'lock-try',    text: 'Attempt a lock in practice',
          need: 1, count: function (ev) { return ev.type === 'practice'; } }
      ],
      shop: [
        { key: 'dailylock_reveal', label: 'One dial reveal', note: 'Skip the ad on a practice lock', cost: 5, grant: 1 }
      ]
    }
  ];

  /* What's-new copy, newest first. One entry per shipped version. */
  var CHANGELOG = [
    { version: '1.0.0', date: '2026-08-29', notes: [
      'Five games to start: Echo, Starfall, Prism, Vortex and Daily Lock.',
      'A daily challenge picks three goals across three games. Finish all three to keep your streak.',
      'Tokens earned from the challenge spend on boosts in any game.'
    ] }
  ];

  var R = {
    games: GAMES,
    changelog: CHANGELOG,
    by: function (slug) {
      for (var i = 0; i < GAMES.length; i++) if (GAMES[i].slug === slug) return GAMES[i];
      return null;
    },
    /* Every goal, flattened, for the daily picker. */
    allGoals: function () {
      var out = [];
      GAMES.forEach(function (g) {
        (g.goals || []).forEach(function (goal) {
          out.push({ game: g.slug, id: goal.id, text: goal.text, need: goal.need, count: goal.count });
        });
      });
      return out;
    },
    goal: function (id) {
      var all = R.allGoals();
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    },
    shopRows: function () {
      var out = [];
      GAMES.forEach(function (g) {
        (g.shop || []).forEach(function (row) {
          out.push({ game: g.slug, gameName: g.name, accent: g.accent,
                     key: row.key, label: row.label, note: row.note,
                     cost: row.cost, grant: row.grant });
        });
      });
      return out;
    },
    /* Games added after `version` — drives the NEW badge. */
    newerThan: function (version) {
      return GAMES.filter(function (g) { return cmp(g.slug && g.since, version) > 0; });
    }
  };

  /* semver-ish compare, enough for x.y.z */
  function cmp(a, b) {
    if (!a || !b) return 0;
    /* A placeholder like 'NEXT_VERSION' would silently compare as 0.0.0 and the
       game would never get a NEW badge. Fail loudly in the console instead. */
    if (!/^\d+\.\d+\.\d+$/.test(String(a)) || !/^\d+\.\d+\.\d+$/.test(String(b))) {
      console.warn('[registry] not a version:', a, b);
      return 0;
    }
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < 3; i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  R.cmpVersion = cmp;

  global.Registry = R;
})(window);
