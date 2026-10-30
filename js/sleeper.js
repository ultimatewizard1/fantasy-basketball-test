/*
 * Thin client for Sleeper's public (read-only, no auth) API.
 * Official endpoints live on api.sleeper.app/v1; season projections, stats and
 * ADP come from the unofficial api.sleeper.com endpoints the Sleeper app uses,
 * so several URL shapes are tried in turn.
 */
(function (root) {
  'use strict';

  var V1 = 'https://api.sleeper.app/v1';
  var WEB = 'https://api.sleeper.com';
  var LINES = 'https://api.sleeper.app/lines/available?dynamic=true&include_preseason=true';
  var POSITIONS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'];
  var PLAYER_CACHE_KEY = 'fbd.players.v1';
  var PLAYER_CACHE_MS = 24 * 60 * 60 * 1000;

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error(res.status + ' from ' + url);
      return res.json();
    });
  }

  function firstWorking(urls, accept) {
    var errors = [];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error(errors.join('; ')));
      var url = urls[i++];
      return getJson(url).then(function (data) {
        if (accept && !accept(data)) { errors.push('empty response from ' + url); return next(); }
        return { data: data, url: url };
      }, function (err) { errors.push(err.message); return next(); });
    }
    return next();
  }

  function nonEmpty(data) {
    if (Array.isArray(data)) return data.length > 0;
    return data && typeof data === 'object' && Object.keys(data).length > 0;
  }

  function seasonUrls(kind, season) {
    var pos = POSITIONS.map(function (p) { return 'position[]=' + p; }).join('&');
    return [
      WEB + '/' + kind + '/nba/' + season + '?season_type=regular&' + pos,
      WEB + '/' + kind + '/nba/' + season + '?season_type=regular',
      V1 + '/' + kind + '/nba/regular/' + season
    ];
  }

  // Keep only the fields the tool needs so the cache fits in localStorage.
  function slimPlayers(all) {
    var out = {};
    Object.keys(all || {}).forEach(function (id) {
      var p = all[id];
      if (!p) return;
      out[id] = {
        full_name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
        team: p.team || null,
        position: p.position || null,
        fantasy_positions: p.fantasy_positions || null,
        injury_status: p.injury_status || null,
        active: p.active !== false,
        age: p.age || null
      };
    });
    return out;
  }

  function readCache(maxAge) {
    try {
      var raw = localStorage.getItem(PLAYER_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.at > (maxAge || PLAYER_CACHE_MS)) return null;
      return parsed.players;
    } catch (e) { return null; }
  }

  function writeCache(players) {
    try { localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({ at: Date.now(), players: players })); } catch (e) { /* quota or private mode */ }
  }

  var Sleeper = {
    V1: V1,
    WEB: WEB,
    seasonUrls: seasonUrls,
    slimPlayers: slimPlayers,

    state: function () { return getJson(V1 + '/state/nba'); },

    league: function (leagueId) {
      return Promise.all([
        getJson(V1 + '/league/' + leagueId),
        getJson(V1 + '/league/' + leagueId + '/users').catch(function () { return []; }),
        getJson(V1 + '/league/' + leagueId + '/drafts').catch(function () { return []; })
      ]).then(function (r) { return { league: r[0], users: r[1] || [], drafts: r[2] || [] }; });
    },

    draft: function (draftId) { return getJson(V1 + '/draft/' + draftId); },
    rosters: function (leagueId) { return getJson(V1 + '/league/' + leagueId + '/rosters'); },
    matchups: function (leagueId, week) { return getJson(V1 + '/league/' + leagueId + '/matchups/' + week); },
    picks: function (draftId) { return getJson(V1 + '/draft/' + draftId + '/picks'); },

    // maxAge: accept a cached copy up to this old (ms); in-season injuries change daily.
    players: function (force, maxAge) {
      var cached = !force && readCache(maxAge);
      if (cached) return Promise.resolve(cached);
      return getJson(V1 + '/players/nba').then(function (all) {
        var slim = slimPlayers(all);
        writeCache(slim);
        return slim;
      });
    },

    projections: function (season) { return firstWorking(seasonUrls('projections', season), nonEmpty); },
    // Per-game projections for one week: one row per player per game, with date and opponent.
    weekProjections: function (season, week) {
      var pos = POSITIONS.map(function (p) { return 'position[]=' + p; }).join('&');
      return getJson(WEB + '/projections/nba/' + season + '/' + week + '?season_type=regular&' + pos);
    },
    // Box scores for the week, one row per player per game (date, stats).
    weekStats: function (season, week) {
      var pos = POSITIONS.map(function (p) { return 'position[]=' + p; }).join('&');
      return getJson(WEB + '/stats/nba/' + season + '/' + week + '?season_type=regular&' + pos);
    },
    // Locked games this week: { rosterId: { playerId: sleeperGameId } }. From the GraphQL
    // endpoint Sleeper's own app uses (matchup_legs_raw works without signing in).
    lockedGames: function (leagueId, week) {
      var q = '{ matchup_legs_raw(league_id: "' + leagueId + '", round: ' + week + ') { roster_id starters_games } }';
      return getJson('https://sleeper.com/graphql?query=' + encodeURIComponent(q)).then(function (d) {
        if (!d || !d.data || !d.data.matchup_legs_raw) throw new Error('no lock data');
        var out = {};
        d.data.matchup_legs_raw.forEach(function (m) { out[m.roster_id] = m.starters_games || {}; });
        return out;
      });
    },
    transactions: function (leagueId, week) { return getJson(V1 + '/league/' + leagueId + '/transactions/' + week); },
    // Sleeper Picks over/under lines for upcoming games (all sports; usually the next day's NBA games).
    lines: function () { return getJson(LINES); },
    stats: function (season) { return firstWorking(seasonUrls('stats', season), nonEmpty); }
  };

  root.Sleeper = Sleeper;
})(typeof self !== 'undefined' ? self : this);
