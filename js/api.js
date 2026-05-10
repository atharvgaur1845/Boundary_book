/* Boundary Book — CricAPI v1 wrapper.
   - Free tier is rate-limited (~100 calls/day) so we cache aggressively.
   - All endpoints take an apikey query param.
   - We filter results to IPL-only client-side, since search support is patchy. */

const Api = (() => {
  const BASE = "https://api.cricapi.com/v1";
  const TTL_MATCHLIST = 30 * 60 * 1000;  // 30 min
  const TTL_MATCHINFO = 60 * 1000;        // 1 min for live, longer if completed (handled below)

  function key() { return (Store.getSettings().apiKey || "").trim(); }
  function hasKey() { return !!key(); }

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

  // ---- IPL filter helpers --------------------------------------------------
  const IPL_NAMES = ["indian premier league", "ipl"];
  function isIpl(m) {
    const s = (m.series || m.name || "").toLowerCase();
    return IPL_NAMES.some(n => s.includes(n));
  }

  // ---- public surface ------------------------------------------------------

  // List currently scheduled / live / recently-finished matches.
  // CricAPI returns mixed cricket worldwide; we filter to IPL.
  async function listMatches({ force = false } = {}) {
    const j = await call("currentMatches", { offset: 0 }, { ttl: TTL_MATCHLIST, force });
    const all = (j.data || []).filter(isIpl);
    return all.map(normaliseMatch);
  }

  // Match info — full scorecard if available.
  async function matchInfo(matchId, { force = false } = {}) {
    // Completed matches: cache long. Live/upcoming: short cache so re-grading reflects updates.
    const j = await call("match_info", { id: matchId }, { ttl: TTL_MATCHINFO, force });
    return j.data || null;
  }

  // Score endpoint (light; useful for quick status polling)
  async function scores() {
    const j = await call("cricScore", {}, { ttl: TTL_MATCHINFO });
    return (j.data || []).filter(isIpl);
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
      startISO,
      startMs: startISO ? Date.parse(startISO) : 0,
      status,                     // upcoming | live | completed
      raw: m
    };
  }

  function codeFor(name, tInfo) {
    if (!name) return "";
    if (tInfo[name]?.shortname) return tInfo[name].shortname;
    // Fall back to a guess against our IPL_TEAMS table
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

  return { hasKey, listMatches, matchInfo, scores, normaliseMatch };
})();
