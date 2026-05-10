/* Boundary Book — localStorage layer.
   Single namespace; lazy reads, single write per mutation, no JSON re-parsing
   inside hot loops. All access goes through Store.* — no scattered keys. */

const Store = (() => {
  const NS = "bb.v1";
  const KEYS = {
    profile:   `${NS}.profile`,
    contests:  `${NS}.contests`,
    apiCache:  `${NS}.apiCache`,
    settings:  `${NS}.settings`
  };

  const STARTING_BALANCE = 10000;

  // ----- generic ------------------------------------------------------------
  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ----- profile ------------------------------------------------------------
  function getProfile() {
    return get(KEYS.profile, null);
  }
  function setProfile(p) { set(KEYS.profile, p); }

  function ensureProfile() {
    let p = getProfile();
    if (!p) {
      p = { name: "Guest", balance: STARTING_BALANCE, createdAt: Date.now() };
      setProfile(p);
    }
    return p;
  }

  function setName(name) {
    const p = ensureProfile();
    p.name = (name || "Guest").trim().slice(0, 32) || "Guest";
    setProfile(p);
    return p;
  }

  function adjustBalance(delta) {
    const p = ensureProfile();
    p.balance = Math.max(0, Math.round((p.balance + delta) * 100) / 100);
    setProfile(p);
    return p.balance;
  }

  function resetWallet() {
    const p = ensureProfile();
    p.balance = STARTING_BALANCE;
    setProfile(p);
  }

  // ----- contests -----------------------------------------------------------
  // Shape: [{ id, matchId, matchLabel, startsAt, entry, size, status,
  //           userPredictions, bots:[{name,predictions}],
  //           result:null|{...}, ranking:null|[{name,points,payout}],
  //           createdAt, settledAt }]

  function getAllContests() { return get(KEYS.contests, []); }
  function setAllContests(list) { set(KEYS.contests, list); }

  function addContest(c) {
    const list = getAllContests();
    list.unshift(c);
    setAllContests(list);
  }

  function updateContest(id, patch) {
    const list = getAllContests();
    const i = list.findIndex(c => c.id === id);
    if (i === -1) return null;
    list[i] = { ...list[i], ...patch };
    setAllContests(list);
    return list[i];
  }

  function getContest(id) {
    return getAllContests().find(c => c.id === id) || null;
  }

  function getContestsByMatch(matchId) {
    return getAllContests().filter(c => c.matchId === matchId);
  }

  function deleteContest(id) {
    setAllContests(getAllContests().filter(c => c.id !== id));
  }

  // ----- settings -----------------------------------------------------------
  function getSettings() {
    return get(KEYS.settings, { apiKey: "", autoGrade: true });
  }
  function setSettings(s) { set(KEYS.settings, { ...getSettings(), ...s }); }

  // ----- api cache ----------------------------------------------------------
  // Shape: { [cacheKey]: { ts, ttl, data } }
  function getCache(key) {
    const all = get(KEYS.apiCache, {});
    const e = all[key];
    if (!e) return null;
    if (Date.now() - e.ts > e.ttl) return null;
    return e.data;
  }
  function putCache(key, data, ttlMs) {
    const all = get(KEYS.apiCache, {});
    all[key] = { ts: Date.now(), ttl: ttlMs, data };
    set(KEYS.apiCache, all);
  }
  function clearCache() { set(KEYS.apiCache, {}); }

  // ----- exports ------------------------------------------------------------
  return {
    KEYS, STARTING_BALANCE,
    ensureProfile, getProfile, setName, adjustBalance, resetWallet,
    getAllContests, addContest, updateContest, getContest,
    getContestsByMatch, deleteContest,
    getSettings, setSettings,
    getCache, putCache, clearCache
  };
})();
