/* Boundary Book — contest engine.
   Single-user app with simulated bot opponents so position-based payouts have
   meaning. All randomness is local; no networking here. */

const Contests = (() => {

  // -- ids -------------------------------------------------------------------
  function uid() {
    return "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // -- create a contest ------------------------------------------------------
  // match: normalised match object from Api
  // tier: { entry, size, label }
  // userPredictions: { [betKey]: pickValue }
  function create(match, tier, userPredictions) {
    const profile = Store.ensureProfile();
    if (profile.balance < tier.entry) throw new Error("Insufficient balance.");

    const pool = tier.entry * tier.size;
    const bots = generateBots(tier.size - 1, match);
    const c = {
      id: uid(),
      matchId: match.id,
      matchLabel: `${match.teamA} vs ${match.teamB}`,
      teamA: match.teamA,
      teamB: match.teamB,
      teamACode: match.teamACode,
      teamBCode: match.teamBCode,
      startsAt: match.startMs,
      tierLabel: tier.label,
      entry: tier.entry,
      size: tier.size,
      pool,
      schedule: PAYOUT_SCHEDULES[tier.size] || PAYOUT_SCHEDULES[3],
      userPredictions,
      bots,
      status: "open",        // open | settled
      result: null,
      ranking: null,
      createdAt: Date.now(),
      settledAt: null
    };
    Store.adjustBalance(-tier.entry);
    Store.addContest(c);
    return c;
  }

  // -- bots ------------------------------------------------------------------
  function generateBots(n, match) {
    const used = new Set();
    const bots = [];
    while (bots.length < n) {
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      if (used.has(name)) continue;
      used.add(name);
      bots.push({ name, predictions: randomPredictions(match) });
    }
    return bots;
  }

  function randomPredictions(match) {
    const codeA = match.teamACode, codeB = match.teamBCode;
    const teams = [match.teamA, match.teamB];
    const pickTeam = () => teams[Math.random() < 0.5 ? 0 : 1];
    const squadA = SQUADS[codeA] || [];
    const squadB = SQUADS[codeB] || [];
    const allPlayers = [...squadA, ...squadB];
    const pickPlayer = () => allPlayers.length
      ? allPlayers[Math.floor(Math.random() * allPlayers.length)]
      : "Unknown";

    const out = {};
    for (const b of BET_TYPES) {
      if (b.kind === "team") out[b.key] = pickTeam();
      else if (b.kind === "player") out[b.key] = pickPlayer();
      else if (b.kind === "range") {
        const bk = b.buckets[Math.floor(Math.random() * b.buckets.length)];
        out[b.key] = bk.id;
      }
    }
    return out;
  }

  // -- result extraction (best-effort from CricAPI shape) --------------------
  function extractResult(matchInfoData, contest) {
    // matchInfoData: raw CricAPI match_info data field
    if (!matchInfoData) return null;

    const r = {};
    // Toss
    r.toss = matchInfoData.tossWinner || null;
    // Match winner — CricAPI sometimes returns it as matchWinner
    r.winner = matchInfoData.matchWinner || extractWinnerFromStatus(matchInfoData.status, contest);

    // Scorecard parsing
    const scorecard = matchInfoData.scorecard || matchInfoData.scoreCard || [];
    let topRunPlayer = null, topRunVal = -1;
    let topWktPlayer = null, topWktVal = -1;
    let topScore = -1;
    let totalFours = 0, totalSixes = 0;

    for (const inn of scorecard) {
      const batting = inn.batting || inn.batsmen || [];
      const bowling = inn.bowling || inn.bowlers || [];
      for (const b of batting) {
        const runs = num(b.r ?? b.runs);
        const fours = num(b["4s"] ?? b.fours);
        const sixes = num(b["6s"] ?? b.sixes);
        totalFours += fours; totalSixes += sixes;
        if (runs > topRunVal) { topRunVal = runs; topRunPlayer = b.batsman || b.name || null; }
        if (runs > topScore) topScore = runs;
      }
      for (const w of bowling) {
        const wkts = num(w.w ?? w.wickets);
        if (wkts > topWktVal) { topWktVal = wkts; topWktPlayer = w.bowler || w.name || null; }
      }
    }

    r.topRun    = cleanName(topRunPlayer);
    r.topWicket = cleanName(topWktPlayer);
    r.fours     = totalFours;
    r.sixes     = totalSixes;
    r.topScore  = topScore < 0 ? null : topScore;
    r.potm      = matchInfoData.player_of_the_match || matchInfoData.manOfMatch || null;
    // Captain comparison — derive from scorecard captains if present, else null
    r.captain   = null;

    return r;
  }

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function cleanName(s) {
    if (!s) return null;
    return s.replace(/\s*\(c\)|\s*\(wk\)|†|\*/g, "").trim();
  }
  function extractWinnerFromStatus(status, contest) {
    if (!status) return null;
    const s = status.toLowerCase();
    for (const t of [contest.teamA, contest.teamB]) {
      if (s.includes(t.toLowerCase())) return t;
    }
    return null;
  }

  // -- scoring ---------------------------------------------------------------
  function score(predictions, result) {
    let pts = 0;
    const breakdown = {};
    for (const b of BET_TYPES) {
      const pick = predictions[b.key];
      const truth = result?.[b.key];
      let got = 0;
      if (pick == null || truth == null) {
        breakdown[b.key] = { pick, truth, got: 0, status: "ungraded" };
        continue;
      }
      if (b.kind === "team" || b.kind === "player") {
        if (matchText(pick, truth)) got = b.points;
      } else if (b.kind === "range") {
        const bucket = b.buckets.find(x => x.id === pick);
        if (bucket && truth >= bucket.min && truth <= bucket.max) got = b.points;
      }
      pts += got;
      breakdown[b.key] = { pick, truth, got, status: got ? "win" : "loss" };
    }
    return { points: pts, breakdown };
  }

  function matchText(a, b) {
    if (a == null || b == null) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  // -- settle ----------------------------------------------------------------
  // Returns ranking list and credits the user's payout
  function settle(contestId, result) {
    const c = Store.getContest(contestId);
    if (!c) throw new Error("Contest not found.");
    if (c.status === "settled") return c;

    const profile = Store.ensureProfile();
    const userScored = score(c.userPredictions, result);
    const entries = [
      { name: profile.name, isUser: true, points: userScored.points, breakdown: userScored.breakdown }
    ];
    for (const bot of c.bots) {
      const s = score(bot.predictions, result);
      entries.push({ name: bot.name, isUser: false, points: s.points, breakdown: s.breakdown });
    }

    // Sort by points desc, tie-break by random stable order on creation
    entries.forEach((e, i) => e._idx = i);
    entries.sort((a, b) => (b.points - a.points) || (a._idx - b._idx));

    const schedule = c.schedule;
    let userPayout = 0;
    entries.forEach((e, rank) => {
      const pct = schedule[rank] || 0;
      e.payout = Math.round(c.pool * pct);
      e.rank = rank + 1;
      delete e._idx;
      if (e.isUser) userPayout = e.payout;
    });

    if (userPayout > 0) Store.adjustBalance(userPayout);

    return Store.updateContest(contestId, {
      status: "settled",
      result,
      ranking: entries,
      settledAt: Date.now()
    });
  }

  // -- aggregate stats -------------------------------------------------------
  function stats() {
    const all = Store.getAllContests();
    const settled = all.filter(c => c.status === "settled");
    let totalIn = 0, totalOut = 0, wins = 0;
    for (const c of all) totalIn += c.entry;
    for (const c of settled) {
      const me = (c.ranking || []).find(r => r.isUser);
      if (me) {
        totalOut += me.payout;
        if (me.payout >= c.entry) wins++;
      }
    }
    return {
      contests: all.length,
      settled: settled.length,
      totalIn,
      totalOut,
      net: totalOut - totalIn,
      wins,
      winRate: settled.length ? (wins / settled.length) : 0
    };
  }

  return { create, settle, score, extractResult, stats, randomPredictions };
})();
