/* Boundary Book — CricAPI v1 wrapper.
   - Free tier rate-limited (~100 calls/day) so we cache aggressively.
   - We pull from BOTH /currentMatches (live + recent) AND /matches (upcoming)
     because /currentMatches alone often has nothing during the IPL off-season
     window or between match days.
   - IPL filter is broad (matches series id, series name, team names) and the
     UI exposes a "Show all cricket" toggle when nothing IPL-shaped is found. */

const Api = (() => {
  const BASE = "https://api.cricapi.com/v1";
  const TTL_MATCHLIST = 30 * 60 * 1000;  // 30 min
  const TTL_MATCHINFO = 60 * 1000;
  const TTL_SERIES    = 6 * 60 * 60 * 1000;

  let lastDiagnostics = null;

  function key() { return (Store.getSettings().apiKey || "").trim(); }
  function hasKey() { return !!key(); }
  function getDiagnostics() { return lastDiagnostics; }

  async function call(path, params = {}, { ttl = 0, cacheKey = null, force = false } = {}) {
    const k = key();
    if (!k) throw new Error("No API key set. Open Settings to add a CricAPI key.");
    const ck = cacheKey || `${path}::${JSON.stringify(params)}`;
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

  // ---- IPL detection -------------------------------------------------------
  // Match anything that smells like the IPL: series name, match name, team
  // names against our roster. Keeps false positives low without being brittle.
  const IPL_SERIES_RX = /\b(indian premier league|ipl)\b/i;
  const IPL_TEAM_KEYWORDS = Object.values(IPL_TEAMS).flatMap(t => [
    t.name.toLowerCase(),
    t.short.toLowerCase()
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

  // ---- public surface ------------------------------------------------------

  // Combined list: current + upcoming, deduped by id, optionally unfiltered.
  // Returns { matches, ipl, all } so the UI can fall back to "all cricket"
  // when no IPL is in season.
  async function listMatches({ force = false, includeAll = false } = {}) {
    const sources = await Promise.all([
      call("currentMatches", { offset: 0 }, { ttl: TTL_MATCHLIST, force }).catch(e => ({ _err: e })),
      call("matches",        { offset: 0 }, { ttl: TTL_MATCHLIST, force }).catch(e => ({ _err: e }))
    ]);
    const errs = sources.filter(s => s._err).map(s => s._err.message);
    const raw  = sources.filter(s => !s._err).flatMap(s => s.data || []);
    const dedup = new Map();
    for (const m of raw) if (m.id) dedup.set(m.id, m);
    const all = [...dedup.values()];
    const ipl = all.filter(isIpl);

    lastDiagnostics = {
      totalRaw: all.length,
      iplFound: ipl.length,
      sampleSeries: [...new Set(all.map(m => m.series).filter(Boolean))].slice(0, 8),
      errors: errs
    };

    const chosen = (includeAll || ipl.length === 0 && includeAll) ? all : ipl;
    const out = (includeAll ? all : ipl).map(normaliseMatch);
    // Throw a helpful error only when we got nothing back at all
    if (!out.length && all.length === 0 && errs.length) {
      throw new Error(errs[0]);
    }
    return out;
  }

  async function matchInfo(matchId, { force = false } = {}) {
    const j = await call("match_info", { id: matchId }, { ttl: TTL_MATCHINFO, force });
    return j.data || null;
  }

  async function scores() {
    const j = await call("cricScore", {}, { ttl: TTL_MATCHINFO });
    return (j.data || []).filter(isIpl);
  }

  // Find the active IPL series id via /series search; useful for series-info pulls.
  async function findIplSeries() {
    const j = await call("series", { offset: 0, search: "Indian Premier League" },
                         { ttl: TTL_SERIES });
    return (j.data || [])[0] || null;
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

  return { hasKey, listMatches, matchInfo, scores, findIplSeries,
           normaliseMatch, getDiagnostics };
})();
