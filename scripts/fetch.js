// Boundary Book — feed builder.
// Cron-scheduled (GitHub Actions). Pulls IPL fixtures, scorecards, and squads
// from CricAPI using CRICAPI_KEY (repo secret). Writes data/feed.json.
//
// Delta cache: reads the previous feed and only re-fetches expensive endpoints
// (match_info, match_squad) when the new state actually warrants it. This keeps
// us comfortably under the free tier's daily quota.
//
// Node 20+ (uses global fetch).

const fs = require('fs');
const path = require('path');

const KEY = process.env.CRICAPI_KEY;
if (!KEY) { console.error('CRICAPI_KEY missing'); process.exit(1); }

const BASE = 'https://api.cricapi.com/v1';
const OUT  = path.join(__dirname, '..', 'data', 'feed.json');

// Per-run caps so a runaway never blows the quota
const CAP_INFO  = 6;
const CAP_SQUAD = 6;

// Time windows
const SQUAD_FETCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // pull squads up to 7 days ahead

let calls = 0;
async function call(p, params = {}) {
  const u = new URL(`${BASE}/${p}`);
  u.searchParams.set('apikey', KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  calls++;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.status && j.status !== 'success') throw new Error(`${p}: ${j.reason || 'api error'}`);
  return j.data;
}

const IPL_RX = /\b(indian premier league|ipl)\b/i;
function isIpl(m) {
  const fields = [m.series, m.name, m.matchType].filter(Boolean).join(' ');
  return IPL_RX.test(fields);
}

function loadPrevious() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const map = new Map();
    for (const m of (j.matches || [])) if (m.id) map.set(m.id, m);
    return map;
  } catch { return new Map(); }
}

function normalisedSquads(rawSquadData) {
  // CricAPI shape: [{ teamName, shortname, img, players: [{name, role, ...}] }, ...]
  const out = {};
  for (const t of (rawSquadData || [])) {
    if (!t.teamName) continue;
    out[t.teamName] = (t.players || []).map(p => ({
      name: p.name,
      role: p.role || '',
      country: p.country || '',
      img:  p.playerImg || p.img || ''
    }));
  }
  return out;
}

async function main() {
  const errors = [];
  const safe = (label, p) => p.then(d => d || []).catch(e => {
    errors.push(`${label}: ${e.message}`); return [];
  });

  const previous = loadPrevious();

  // 1) Light list pulls — current + upcoming
  const [current, upcoming] = await Promise.all([
    safe('currentMatches', call('currentMatches', { offset: 0 })),
    safe('matches',        call('matches',        { offset: 0 }))
  ]);

  // 2) Series-based pull — most reliable for IPL
  let seriesMatches = [];
  let seriesMeta = null;
  try {
    const series = await call('series', { offset: 0, search: 'Indian Premier League' });
    if (series?.[0]?.id) {
      seriesMeta = { id: series[0].id, name: series[0].name };
      const info = await call('series_info', { id: series[0].id });
      const list = info?.matchList || info?.matches || [];
      seriesMatches = list.map(m => ({
        ...m,
        series: m.series || series[0].name || 'Indian Premier League'
      }));
    }
  } catch (e) {
    errors.push(`series: ${e.message}`);
  }

  // 3) Dedupe by id, prefer richer record (later in the merge wins)
  const dedup = new Map();
  for (const m of [...current, ...upcoming, ...seriesMatches]) {
    if (!m.id) continue;
    const existing = dedup.get(m.id);
    dedup.set(m.id, existing ? { ...existing, ...m } : m);
  }
  const seriesIds = new Set(seriesMatches.map(m => m.id));
  const ipl = [...dedup.values()].filter(m => seriesIds.has(m.id) || isIpl(m));

  // Sort soonest first
  ipl.sort((a, b) => {
    const ad = Date.parse(a.dateTimeGMT || a.date || 0) || 0;
    const bd = Date.parse(b.dateTimeGMT || b.date || 0) || 0;
    return ad - bd;
  });

  // 4) Carry forward fullInfo + squads from previous run when not stale
  for (const m of ipl) {
    const prev = previous.get(m.id);
    if (prev?.fullInfo && (m.matchEnded || prev.matchEnded)) m.fullInfo = prev.fullInfo;
    if (prev?.squads) m.squads = prev.squads;
  }

  // 5) match_info for live + just-completed matches we haven't captured yet
  let infoCalls = 0;
  for (const m of ipl) {
    if (infoCalls >= CAP_INFO) break;
    const live = m.matchStarted && !m.matchEnded;
    const justEnded = m.matchEnded && !m.fullInfo;
    if (!live && !justEnded) continue;
    try {
      const info = await call('match_info', { id: m.id });
      if (info) m.fullInfo = info;
      infoCalls++;
    } catch (e) { errors.push(`match_info ${m.id}: ${e.message}`); }
  }

  // 6) match_squad for upcoming matches without squads, prioritised by start time
  let squadCalls = 0;
  const now = Date.now();
  const squadCandidates = ipl
    .filter(m => !m.squads || Object.keys(m.squads).length === 0)
    .filter(m => {
      const t = Date.parse(m.dateTimeGMT || m.date || 0);
      return t && t > now - 6 * 60 * 60 * 1000 && t < now + SQUAD_FETCH_WINDOW_MS;
    });
  for (const m of squadCandidates) {
    if (squadCalls >= CAP_SQUAD) break;
    try {
      const squads = await call('match_squad', { id: m.id });
      const norm = normalisedSquads(squads);
      if (Object.keys(norm).length) m.squads = norm;
      squadCalls++;
    } catch (e) { errors.push(`match_squad ${m.id}: ${e.message}`); }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'cricapi.com',
    series: seriesMeta,
    counts: {
      total: ipl.length,
      live: ipl.filter(m => m.matchStarted && !m.matchEnded).length,
      completed: ipl.filter(m => m.matchEnded).length,
      upcoming: ipl.filter(m => !m.matchStarted).length,
      withScorecard: ipl.filter(m => m.fullInfo).length,
      withSquads: ipl.filter(m => m.squads).length
    },
    apiCalls: calls,
    errors,
    matches: ipl
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`wrote ${ipl.length} matches · ${infoCalls} scorecards · ${squadCalls} squads · ${calls} total calls`);
  if (errors.length) console.warn('soft errors:', errors);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
