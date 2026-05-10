/* Boundary Book — data layer.
   Default path: read data/feed.json (built by GitHub Actions on a 30-min cron,
   single shared CricAPI key held as a repo secret). No key in the browser.
   Override path: if the user pastes a personal CricAPI key in Settings, the
   client falls back to live CricAPI calls so they get sub-cron freshness. */

const Api = (() => {
  const BASE = "https://api.cricapi.com/v1";
  const FEED_URL = "data/feed.json";        // relative — works on GH Pages
  const TTL_FEED      = 5 * 60 * 1000;       // 5 min in-browser cache of the JSON
  const TTL_MATCHLIST = 30 * 60 * 1000;
  const TTL_MATCHINFO = 60 * 1000;

  let lastDiagnostics = null;
  let feedCache = null;
  let feedCacheAt = 0;

  function key() { return (Store.getSettings().apiKey || "").trim(); }
  function hasUserKey() { return !!key(); }
  // Site is functional even without a user key — JSON feed covers it.
  function hasKey() { return true; }
  function getDiagnostics() { return lastDiagnostics; }

  // ---- shared cricapi caller (only used when user key present) ------------
  async function call(path, params = {}, { ttl = 0, force = false } = {}) {
    const k = key();
    if (!k) throw new Error("Live mode requires a personal CricAPI key in Settings.");
    const ck = `${path}::${JSON.stringify(params)}`;
    if (ttl && !force) {
      const hit = Store.getCache(ck);
      if (hit) return hit;
    }
    const url = new URL(`${BASE}/${path}`);
    url.searchParams.set("apikey", k);
    for (const [p, v] of Object.entries(params)) url.searchParams.set(p, v);
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`CricAPI ${r.status}: ${r.statusText}`);
    const j = await r.json();
    if (j.status && j.status !== "success") throw new Error(j.reason || "API error");
    if (ttl) Store.putCache(ck, j, ttl);
    return j;
  }

  // ---- feed loader (shared JSON) ------------------------------------------
  async function loadFeed({ force = false } = {}) {
    const fresh = feedCache && (Date.now() - feedCacheAt < TTL_FEED);
    if (fresh && !force) return feedCache;
    const url = `${FEED_URL}?t=${Math.floor(Date.now() / TTL_FEED)}`;
    const r = await fetch(url, { cache: force ? "no-cache" : "default" });
    if (!r.ok) throw new Error(`Feed ${r.status}: ${r.statusText}`);
    feedCache = await r.json();
    feedCacheAt = Date.now();
    return feedCache;
  }

  // ---- match list ----------------------------------------------------------
  async function listMatches({ force = false, includeAll = false } = {}) {
    if (hasUserKey()) return listMatchesLive({ force, includeAll });
    return listMatchesFromFeed({ force, includeAll });
  }

  async function listMatchesFromFeed({ force = false } = {}) {
    try {
      const feed = await loadFeed({ force });
      lastDiagnostics = {
        mode: "feed",
        generatedAt: feed.generatedAt,
        totalRaw: feed.counts?.total ?? feed.matches?.length ?? 0,
        iplFound: feed.matches?.length ?? 0,
        sampleSeries: feed.series ? [feed.series.name] : [],
        errors: feed.errors || []
      };
      return (feed.matches || []).map(normaliseMatch);
    } catch (e) {
      lastDiagnostics = { mode: "feed", error: e.message };
      throw e;
    }
  }

  async function listMatchesLive({ force = false, includeAll = false } = {}) {
    const seriesPromise = (async () => {
      try {
        const s = await findIplSeries();
        if (!s?.id) return [];
        const j = await call("series_info", { id: s.id }, { ttl: TTL_MATCHLIST, force });
        const list = j.data?.matchList || j.data?.matches || [];
        return list.map(m => ({ ...m, series: m.series || s.name || "Indian Premier League" }));
      } catch { return []; }
    })();

    const sources = await Promise.all([
      call("currentMatches", { offset: 0 }, { ttl: TTL_MATCHLIST, force }).catch(e => ({ _err: e })),
      call("matches",        { offset: 0 }, { ttl: TTL_MATCHLIST, force }).catch(e => ({ _err: e })),
      seriesPromise
    ]);
    const errs = sources.slice(0, 2).filter(s => s._err).map(s => s._err.message);
    const fromGeneral = sources.slice(0, 2).filter(s => !s._err).flatMap(s => s.data || []);
    const fromSeries  = sources[2] || [];

    const dedup = new Map();
    for (const m of [...fromGeneral, ...fromSeries]) if (m.id) dedup.set(m.id, m);
    const all = [...dedup.values()];

    const seriesIds = new Set(fromSeries.map(m => m.id));
    const ipl = all.filter(m => seriesIds.has(m.id) || isIpl(m));

    lastDiagnostics = {
      mode: "live",
      totalRaw: all.length,
      fromGeneral: fromGeneral.length,
      fromSeries: fromSeries.length,
      iplFound: ipl.length,
      sampleSeries: [...new Set(all.map(m => m.series).filter(Boolean))].slice(0, 8),
      errors: errs
    };

    const chosen = includeAll ? all : ipl;
    if (!chosen.length && all.length === 0 && errs.length) throw new Error(errs[0]);
    return chosen.map(normaliseMatch);
  }

  // ---- match info ----------------------------------------------------------
  async function matchInfo(matchId, { force = false } = {}) {
    // 1) try the feed (already includes scorecards for live/completed matches)
    try {
      const feed = await loadFeed({ force });
      const hit = (feed.matches || []).find(m => m.id === matchId);
      if (hit?.fullInfo) return hit.fullInfo;
    } catch { /* fall through */ }

    // 2) live override if a personal key is present
    if (hasUserKey()) {
      const j = await call("match_info", { id: matchId }, { ttl: TTL_MATCHINFO, force });
      return j.data || null;
    }
    return null;
  }

  async function findIplSeries() {
    const j = await call("series", { offset: 0, search: "Indian Premier League" },
                         { ttl: 6 * 60 * 60 * 1000 });
    return (j.data || [])[0] || null;
  }

  // ---- IPL detection (used in live mode) ----------------------------------
  const IPL_SERIES_RX = /\b(indian premier league|ipl)\b/i;
  const IPL_TEAM_KEYWORDS = Object.values(IPL_TEAMS).flatMap(t => [
    t.name.toLowerCase(), t.short.toLowerCase()
  ]);
  function isIpl(m) {
    const fields = [m.series, m.name, m.matchType].filter(Boolean).join(" ").toLowerCase();
    if (IPL_SERIES_RX.test(fields)) return true;
    const teamStr = (m.teams || []).join(" ").toLowerCase();
    let hits = 0;
    for (const kw of IPL_TEAM_KEYWORDS) {
      if (teamStr.includes(kw)) { hits++; if (hits >= 2) return true; }
    }
    return false;
  }

  // ---- shape normalisation -------------------------------------------------
  function normaliseMatch(m) {
    const teamA = m.teams?.[0] || (m.teamInfo?.[0]?.name) || "TBA";
    const teamB = m.teams?.[1] || (m.teamInfo?.[1]?.name) || "TBA";
    const tInfo = (m.teamInfo || []).reduce((a, t) => { a[t.name] = t; return a; }, {});
    const status = computeStatus(m);
    const startISO = m.dateTimeGMT || m.date || null;
    return {
      id: m.id,
      teamA, teamB,
      teamACode: codeFor(teamA, tInfo),
      teamBCode: codeFor(teamB, tInfo),
      teamALogo: tInfo[teamA]?.img || "",
      teamBLogo: tInfo[teamB]?.img || "",
      squads: m.squads || null,                 // { [teamName]: [{name, role, ...}] }
      venue: m.venue || "",
      series: m.series || "",
      startISO,
      startMs: startISO ? Date.parse(startISO) : 0,
      status,
      raw: m
    };
  }

  function codeFor(name, tInfo) {
    if (!name) return "";
    if (tInfo[name]?.shortname) return tInfo[name].shortname;
    const lc = name.toLowerCase();
    for (const [code, t] of Object.entries(IPL_TEAMS)) {
      if (lc.includes(t.short.toLowerCase()) || lc.includes(t.name.toLowerCase())) return code;
    }
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 4);
  }

  function computeStatus(m) {
    if (m.matchEnded || m.status?.toLowerCase().includes("won")) return "completed";
    if (m.matchStarted) return "live";
    return "upcoming";
  }

  return {
    hasKey, hasUserKey, listMatches, matchInfo, findIplSeries,
    normaliseMatch, getDiagnostics, loadFeed
  };
})();
