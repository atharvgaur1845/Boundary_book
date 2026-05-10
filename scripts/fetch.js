// Boundary Book — feed builder.
// Runs in GitHub Actions on a 30-min cron. Pulls IPL fixtures + completed
// scorecards from CricAPI using the CRICAPI_KEY repo secret, writes
// data/feed.json. The browser app reads only that file — no API key in client.
//
// Node 20+ (uses global fetch).

const fs = require('fs');
const path = require('path');

const KEY = process.env.CRICAPI_KEY;
if (!KEY) { console.error('CRICAPI_KEY missing'); process.exit(1); }

const BASE = 'https://api.cricapi.com/v1';
const OUT  = path.join(__dirname, '..', 'data', 'feed.json');

async function call(p, params = {}) {
  const u = new URL(`${BASE}/${p}`);
  u.searchParams.set('apikey', KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
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

async function main() {
  const errors = [];
  const safe = (label, p) => p.then(d => d || []).catch(e => {
    errors.push(`${label}: ${e.message}`); return [];
  });

  const [current, upcoming] = await Promise.all([
    safe('currentMatches', call('currentMatches', { offset: 0 })),
    safe('matches',        call('matches',        { offset: 0 }))
  ]);

  // Series-based pull — most reliable for IPL
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

  // Dedupe by id, prefer richer record
  const dedup = new Map();
  for (const m of [...seriesMatches, ...current, ...upcoming]) {
    if (!m.id) continue;
    const existing = dedup.get(m.id);
    dedup.set(m.id, existing ? { ...existing, ...m } : m);
  }
  const seriesIds = new Set(seriesMatches.map(m => m.id));
  const ipl = [...dedup.values()].filter(m => seriesIds.has(m.id) || isIpl(m));

  // Sort upcoming first by start time
  ipl.sort((a, b) => {
    const ad = Date.parse(a.dateTimeGMT || a.date || 0) || 0;
    const bd = Date.parse(b.dateTimeGMT || b.date || 0) || 0;
    return ad - bd;
  });

  // Pull match_info for live + completed matches (for grading).
  // Skip pure-upcoming to conserve API quota. Cap to avoid runaway calls.
  const MAX_INFO_CALLS = 12;
  let infoCalls = 0;
  for (const m of ipl) {
    if (infoCalls >= MAX_INFO_CALLS) break;
    if (!(m.matchEnded || m.matchStarted)) continue;
    try {
      const info = await call('match_info', { id: m.id });
      if (info) m.fullInfo = info;
      infoCalls++;
    } catch (e) {
      errors.push(`match_info ${m.id}: ${e.message}`);
    }
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
      withScorecard: ipl.filter(m => m.fullInfo).length
    },
    errors,
    matches: ipl
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`wrote ${ipl.length} matches (${infoCalls} scorecards) → ${OUT}`);
  if (errors.length) console.warn('soft errors:', errors);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
