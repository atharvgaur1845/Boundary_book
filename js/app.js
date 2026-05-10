/* Boundary Book — UI controller.
   Hash-based routing, vanilla DOM, declarative render functions.
   Keep DOM updates batched and avoid layout thrash inside loops. */

(() => {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const VIEW = $("#view");
  const MODAL_ROOT = $("#modalRoot");
  const NAV = $("#topnav");
  const WALLET_NAME = $("#walletName");
  const WALLET_BAL  = $("#walletBalance");

  const ROUTES = ["matches", "contests", "history", "settings"];
  let currentRoute = "matches";

  // ------------------------------------------------------------------ utils

  const fmt = {
    money: n => "₹" + Math.round(n).toLocaleString("en-IN"),
    date:  ts => ts ? new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—",
    time:  ts => ts ? new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—",
    day:   ts => ts ? new Date(ts).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "—"
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));

  function teamBadge(name, code, logoUrl) {
    const t = IPL_TEAMS[code] || { color: "#1c3556", text: "#f4ecd8", short: name || "?" };
    const initials = (t.code || (name || "?").slice(0, 3)).toUpperCase();
    const initialsHtml = `<span class="badge-initials" style="background:${t.color};color:${t.text}">${esc(initials)}</span>`;
    if (logoUrl) {
      return `<div class="team-badge has-img">
        ${initialsHtml}
        <img src="${esc(logoUrl)}" alt="${esc(name)}" loading="lazy"
             onerror="this.remove(); this.parentElement.classList.remove('has-img');" />
      </div>`;
    }
    return `<div class="team-badge">${initialsHtml}</div>`;
  }

  // ------------------------------------------------------------- toast

  function toast(msg, type = "") {
    let stack = $(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 0.25s"; }, 3000);
    setTimeout(() => t.remove(), 3400);
  }

  // ------------------------------------------------------------- modal

  function openModal({ title, body, foot }) {
    MODAL_ROOT.innerHTML = `
      <div class="modal-backdrop" data-close="1">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h2>${esc(title)}</h2>
            <button class="modal-close" data-close="1" aria-label="Close">×</button>
          </div>
          <div class="modal-body">${body}</div>
          ${foot ? `<div class="modal-foot">${foot}</div>` : ""}
        </div>
      </div>
    `;
    MODAL_ROOT.addEventListener("click", e => {
      if (e.target.dataset.close === "1") closeModal();
    });
    document.body.style.overflow = "hidden";
    return $(".modal", MODAL_ROOT);
  }

  function closeModal() {
    MODAL_ROOT.innerHTML = "";
    document.body.style.overflow = "";
  }

  // ---------------------------------------------------------- wallet header

  let _displayedBalance = 0;
  function refreshWallet() {
    const p = Store.ensureProfile();
    WALLET_NAME.textContent = p.name;
    const target = Math.round(p.balance);
    if (target !== _displayedBalance) {
      tickerTo(WALLET_BAL, _displayedBalance, target, 600);
      const wrap = WALLET_BAL.parentElement;
      wrap.classList.add("bump");
      setTimeout(() => wrap.classList.remove("bump"), 280);
      _displayedBalance = target;
    } else {
      WALLET_BAL.textContent = target.toLocaleString("en-IN");
    }
  }

  // Animated count-up ticker for the wallet balance
  function tickerTo(el, from, to, duration = 600) {
    const start = performance.now();
    const delta = to - from;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const k = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + delta * k);
      el.textContent = v.toLocaleString("en-IN");
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  $("#wallet").addEventListener("click", () => {
    location.hash = "#/settings";
  });

  // ---------------------------------------------------------- routing

  window.addEventListener("hashchange", route);
  function route() {
    const m = (location.hash || "#/matches").replace(/^#\//, "");
    const [base, sub, tok] = m.split("/");
    if (base === "join" && sub) {
      currentRoute = "join";
      $$("a", NAV).forEach(a => a.classList.toggle("active", false));
      renderJoin(sub, tok);
      return;
    }
    const r = ROUTES.includes(base) ? base : "matches";
    currentRoute = r;
    $$("a", NAV).forEach(a => a.classList.toggle("active", a.dataset.route === r));
    render();
  }

  function render() {
    refreshWallet();
    if (currentRoute === "matches")  return renderMatches();
    if (currentRoute === "contests") return renderContests();
    if (currentRoute === "history")  return renderHistory();
    if (currentRoute === "settings") return renderSettings();
  }

  // ============================================================ MATCHES

  let matchCache = null;
  let dateFilter = "all"; // YYYY-MM-DD or "all"
  let showAllCricket = false;

  async function renderMatches({ force = false } = {}) {
    VIEW.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Today's Card</h2>
          <div class="meta">${showAllCricket ? "All cricket · live & upcoming" : "IPL fixtures · live & upcoming"}</div>
        </div>
        <div class="actions">
          <button class="btn ${showAllCricket ? "btn-primary" : "btn-ghost"}" id="toggleAll">
            ${showAllCricket ? "Showing All" : "IPL Only"}
          </button>
          <button class="btn btn-ghost" id="refreshMatches">Refresh</button>
        </div>
      </div>
      <div id="dateStrip" class="date-strip"></div>
      <div id="matchArea"></div>
    `;
    $("#refreshMatches").addEventListener("click", () => renderMatches({ force: true }));
    $("#toggleAll").addEventListener("click", () => {
      showAllCricket = !showAllCricket;
      matchCache = null;
      renderMatches({ force: true });
    });

    const area = $("#matchArea");
    area.innerHTML = skeletonGrid(6);
    try {
      if (force || !matchCache) {
        matchCache = await Api.listMatches({ force, includeAll: showAllCricket });
      }
      const diag = Api.getDiagnostics();
      if (!matchCache.length && !showAllCricket && diag) {
        area.innerHTML = noIplState(diag);
        $("#dateStrip").innerHTML = "";
        $("#showAllInline")?.addEventListener("click", () => {
          showAllCricket = true; matchCache = null; renderMatches({ force: true });
        });
        $("#reloadFeedInline")?.addEventListener("click", async () => {
          matchCache = null;
          await Api.loadFeed({ force: true }).catch(() => {});
          renderMatches({ force: true });
        });
        return;
      }
      renderDateStrip(matchCache);
      renderMatchCards(matchCache);
    } catch (e) {
      area.innerHTML = emptyState("Couldn't load fixtures",
        esc(e.message) + " — try Reload Feed in Settings.",
        "⚠");
    }
  }

  function noIplState(diag) {
    const series = diag.sampleSeries?.length
      ? `<p style="margin-top:14px;font-size:13px;color:var(--parchment);opacity:0.85">
           <strong style="color:var(--gold)">Series sample:</strong>
           <em>${diag.sampleSeries.map(esc).join(" · ")}</em>
         </p>`
      : "";
    const errs = diag.errors?.length
      ? `<p style="color:#e88;font-size:12px">${diag.errors.map(esc).join(" · ")}</p>`
      : "";
    const sub = diag.mode === "feed"
      ? `Shared feed last refreshed ${diag.generatedAt ? fmt.date(Date.parse(diag.generatedAt)) : "never"}.
         The cron may not have run yet, or the IPL window is closed.`
      : `Live API returned ${diag.totalRaw} match${diag.totalRaw === 1 ? "" : "es"}
         (${diag.fromGeneral || 0} general · ${diag.fromSeries || 0} via series search) — none matched the IPL filter.`;
    const action = diag.mode === "feed"
      ? `<button class="btn btn-ghost" id="reloadFeedInline">Reload Feed</button>
         <a href="#/settings" class="btn btn-primary">Open Settings</a>`
      : `<button class="btn btn-primary" id="showAllInline">Show All Cricket</button>`;
    return `
      <div class="empty-state">
        <div class="ico">🏟</div>
        <h3>No IPL fixtures right now</h3>
        <p>${sub}</p>
        ${series}
        ${errs}
        <p style="margin-top:18px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${action}</p>
      </div>
    `;
  }

  function renderFeedStatus(feed) {
    const el = $("#feedStatus");
    if (!el || !feed) return;
    if (!feed.generatedAt) {
      el.innerHTML = `<em>The shared feed has not been built yet. Run the GitHub Action manually or wait for the next cron tick.</em>`;
      return;
    }
    const c = feed.counts || {};
    const ago = Math.round((Date.now() - Date.parse(feed.generatedAt)) / 60000);
    el.innerHTML = `
      <strong>Shared feed:</strong>
      ${c.total ?? feed.matches?.length ?? 0} matches
      (${c.live || 0} live · ${c.upcoming || 0} upcoming · ${c.completed || 0} completed)
      · refreshed ${ago} min ago
      ${feed.series ? `· series: <em>${esc(feed.series.name)}</em>` : ""}
      ${feed.errors?.length ? `<br><span style="color:var(--maroon)">soft errors: ${feed.errors.map(esc).join("; ")}</span>` : ""}
    `;
  }

  function renderDateStrip(matches) {
    const days = new Map();
    for (const m of matches) {
      if (!m.startMs) continue;
      const d = new Date(m.startMs);
      const k = d.toISOString().slice(0, 10);
      if (!days.has(k)) days.set(k, { date: d, count: 0 });
      days.get(k).count++;
    }
    const sorted = [...days.entries()].sort();
    const html = [`<button data-d="all" class="${dateFilter === "all" ? "active" : ""}">
      <span class="dnum">All</span><span class="dlbl">${matches.length} matches</span>
    </button>`];
    for (const [k, info] of sorted) {
      const d = info.date;
      const lbl = d.toLocaleDateString("en-IN", { weekday: "short" });
      const dnum = d.getDate();
      html.push(`<button data-d="${k}" class="${dateFilter === k ? "active" : ""}">
        <span class="dnum">${dnum}</span><span class="dlbl">${esc(lbl)} · ${info.count}</span>
      </button>`);
    }
    const strip = $("#dateStrip");
    strip.innerHTML = html.join("");
    strip.addEventListener("click", e => {
      const b = e.target.closest("button[data-d]");
      if (!b) return;
      dateFilter = b.dataset.d;
      renderDateStrip(matchCache);
      renderMatchCards(matchCache);
    });
  }

  function renderMatchCards(matches) {
    const filtered = dateFilter === "all"
      ? matches
      : matches.filter(m => m.startMs && new Date(m.startMs).toISOString().slice(0, 10) === dateFilter);

    if (!filtered.length) {
      $("#matchArea").innerHTML = emptyState("No matches",
        "No IPL fixtures match this filter. Try another day or hit Refresh.", "🏟");
      return;
    }
    filtered.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    $("#matchArea").innerHTML = `<div class="match-grid">${filtered.map((m, i) => matchCard(m, i)).join("")}</div>`;
    $$("#matchArea .match-card").forEach(c => {
      c.addEventListener("click", () => onMatchClick(c.dataset.id));
    });
  }

  function skeletonGrid(n = 6) {
    return `<div class="skeleton-grid">${Array.from({ length: n }, () => `<div class="skel"></div>`).join("")}</div>`;
  }

  function matchCard(m, i = 0) {
    const statusLbl = m.status === "live" ? "LIVE" : m.status === "completed" ? "COMPLETED" : "UPCOMING";
    const time = m.startMs ? fmt.time(m.startMs) : "TBA";
    const dayStr = m.startMs ? fmt.day(m.startMs) : "";
    return `
      <div class="match-card" data-id="${esc(m.id)}" style="animation-delay:${i * 50}ms">
        <div class="mc-head">
          <span>${esc(dayStr)} · ${esc(time)}</span>
          <span class="mc-status ${m.status}">${statusLbl}</span>
        </div>
        <div class="mc-teams">
          <div class="team-block">
            ${teamBadge(m.teamA, m.teamACode, m.teamALogo)}
            <div class="team-name">${esc(m.teamA)}</div>
          </div>
          <div class="vs-divider">vs</div>
          <div class="team-block">
            ${teamBadge(m.teamB, m.teamBCode, m.teamBLogo)}
            <div class="team-name">${esc(m.teamB)}</div>
          </div>
        </div>
        <div class="mc-foot">
          <span class="info">${esc(m.venue || "Venue TBA")}</span>
          <button class="btn btn-primary">${m.status === "completed" ? "View" : "Join Contest"}</button>
        </div>
      </div>
    `;
  }

  function onMatchClick(matchId) {
    const m = matchCache?.find(x => x.id === matchId);
    if (!m) return;
    openContestPicker(m);
  }

  // ============================================================ CONTEST PICKER

  function openContestPicker(match) {
    const tiers = CONTEST_TIERS.map((t, i) => `
      <div class="bet-tile" data-i="${i}" style="cursor:pointer">
        <h4>${esc(t.label)} <span class="points">${t.size} seats</span></h4>
        <div class="helper">Entry ${fmt.money(t.entry)} · Pool ${fmt.money(t.entry * t.size)}</div>
        <div class="payout-list">
          ${(PAYOUT_SCHEDULES[t.size] || []).map((p, i) =>
            `<span class="payout-pill">#${i + 1} · ${fmt.money(t.entry * t.size * p)}</span>`
          ).join("")}
        </div>
      </div>
    `).join("");

    openModal({
      title: `${match.teamA} vs ${match.teamB}`,
      body: `
        <p style="margin-top:0;color:var(--ink-soft);font-style:italic">
          ${esc(match.venue || "Venue TBA")} · ${esc(fmt.date(match.startMs))}
        </p>
        <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--navy)">Choose a contest</h3>
        <div class="bet-grid" id="tierGrid">${tiers}</div>
      `,
      foot: `<span class="meta">Top finishers split the pool. The wooden spoon goes home empty.</span>
             <button class="btn btn-dark" data-close="1">Cancel</button>`
    });

    $$("#tierGrid .bet-tile").forEach(tile => {
      tile.addEventListener("click", () => {
        const tier = CONTEST_TIERS[+tile.dataset.i];
        openBetBuilder(match, tier);
      });
    });
  }

  // ============================================================ BET BUILDER

  // mode: { kind: "create", match, tier }  OR  { kind: "edit", contest }
  function openBetBuilder(arg1, arg2) {
    // Backwards-compat: if called with (match, tier) treat as create
    let mode;
    if (arg1 && arg1.kind) mode = arg1;
    else mode = { kind: "create", match: arg1, tier: arg2 };

    const isEdit = mode.kind === "edit";
    const c = isEdit ? mode.contest : null;

    // Synthesize the match-shape needed by the builder
    const match = isEdit
      ? { teamA: c.teamA, teamB: c.teamB, teamACode: c.teamACode, teamBCode: c.teamBCode,
          startMs: c.startsAt, venue: "", id: c.matchId }
      : mode.match;
    const tier = isEdit
      ? { entry: c.entry, size: c.size, label: c.tierLabel }
      : mode.tier;
    const existing = isEdit ? c.userPredictions : null;

    const codeA = match.teamACode, codeB = match.teamBCode;
    // Prefer the playing-15 returned by /match_squad; fall back to our static
    // marquee list. Group players by team in the dropdown for clarity.
    const liveA = match.squads?.[match.teamA]?.map(p => p.name) || null;
    const liveB = match.squads?.[match.teamB]?.map(p => p.name) || null;
    const squadA = liveA || (SQUADS[codeA] || []);
    const squadB = liveB || (SQUADS[codeB] || []);
    const squadSourceTag = (liveA && liveB)
      ? `<span class="squad-tag live">Playing-15 announced</span>`
      : `<span class="squad-tag stale">Indicative squads (lineup not yet announced)</span>`;
    const teamOpts = [match.teamA, match.teamB].map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    const playerOpts =
      `<optgroup label="${esc(match.teamA)}">` +
        squadA.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
      `</optgroup>` +
      `<optgroup label="${esc(match.teamB)}">` +
        squadB.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("") +
      `</optgroup>` +
      `<option value="__custom__">Other (type below)…</option>`;

    const tiles = BET_TYPES.map(b => {
      let body = "";
      if (b.kind === "team") {
        body = `<select data-bet="${b.key}"><option value="">— pick —</option>${teamOpts}</select>`;
      } else if (b.kind === "player") {
        body = `<select data-bet="${b.key}" data-player="1">
                  <option value="">— pick —</option>${playerOpts}
                </select>
                <input type="text" data-bet-custom="${b.key}" placeholder="Type player name" style="display:none;margin-top:6px">`;
      } else if (b.kind === "range") {
        body = `<select data-bet="${b.key}">
                  <option value="">— pick —</option>
                  ${b.buckets.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("")}
                </select>`;
      }
      return `
        <div class="bet-tile">
          <h4>${esc(b.label)} <span class="points">${b.points} pts</span></h4>
          <div class="helper">${esc(b.helper)}</div>
          ${body}
        </div>
      `;
    }).join("");

    const lockHint = match.startMs
      ? `Picks lock <strong>${fmt.time(match.startMs - Contests.LOCK_BUFFER_MS)}</strong> (${fmt.day(match.startMs - Contests.LOCK_BUFFER_MS)}) — about 30 min before listed start.`
      : `Picks remain editable until the toss begins.`;

    const isJoin = mode.kind === "join";
    const confirmLabel = isEdit ? "Save Picks" : isJoin ? "Join Contest" : "Play Solo";

    openModal({
      title: (isEdit ? "Edit Picks · " : isJoin ? "Join · " : "") + `${tier.label} — ${match.teamA} vs ${match.teamB}`,
      body: `
        <div class="contest-summary">
          <div class="stat"><div class="stat-label">Entry</div><div class="stat-value">${fmt.money(tier.entry)}</div></div>
          <div class="stat"><div class="stat-label">Seats</div><div class="stat-value">${tier.size}</div></div>
          <div class="stat"><div class="stat-label">Prize Pool</div><div class="stat-value">${fmt.money(tier.entry * tier.size)}</div></div>
          <div class="stat"><div class="stat-label">Top win</div><div class="stat-value">${fmt.money(tier.entry * tier.size * (PAYOUT_SCHEDULES[tier.size]?.[0] || 0))}</div></div>
        </div>
        <p style="font-style:italic;color:var(--text-3);margin-top:0">
          ${isEdit ? "Adjust your picks freely until the toss." : isJoin ? "Make your picks to join your friends' contest." : "Make your call on each parameter below. Points score on accuracy; the pool pays by rank."}
          <br><span style="color:var(--accent-2)">${lockHint}</span>
        </p>
        <div style="margin-bottom:14px">${squadSourceTag}</div>
        <div class="bet-grid" id="betGrid">${tiles}</div>
      `,
      foot: `
        <button class="btn btn-ghost" id="autoFillBtn">Suggest Picks</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-dark" data-close="1">Cancel</button>
          ${!isEdit && !isJoin ? `<button class="btn btn-ghost" id="shareContestBtn">Share with Friends</button>` : ""}
          <button class="btn btn-primary" id="confirmBet">${confirmLabel}</button>
        </div>
      `
    });

    // Pre-fill existing picks (edit mode)
    if (existing) {
      for (const [k, v] of Object.entries(existing)) {
        const sel = $(`#betGrid select[data-bet="${k}"]`);
        if (!sel) continue;
        if (sel.dataset.player === "1") {
          const opt = Array.from(sel.options).find(o => o.value === v);
          if (opt) sel.value = v;
          else {
            sel.value = "__custom__";
            const c2 = sel.parentElement.querySelector("input[data-bet-custom]");
            c2.style.display = "block";
            c2.value = v;
          }
        } else {
          sel.value = v;
        }
      }
    }

    // Player select with "Custom" toggle
    $$('#betGrid select[data-player="1"]').forEach(sel => {
      sel.addEventListener("change", () => {
        const custom = sel.parentElement.querySelector("input[data-bet-custom]");
        custom.style.display = sel.value === "__custom__" ? "block" : "none";
      });
    });

    $("#autoFillBtn").addEventListener("click", () => {
      const picks = Contests.randomPredictions(match);
      for (const [k, v] of Object.entries(picks)) {
        const sel = $(`#betGrid select[data-bet="${k}"]`);
        if (!sel) continue;
        // Player picks: set to dropdown if present, else custom field
        if (sel.dataset.player === "1") {
          const opt = Array.from(sel.options).find(o => o.value === v);
          if (opt) sel.value = v;
          else {
            sel.value = "__custom__";
            const c = sel.parentElement.querySelector("input[data-bet-custom]");
            c.style.display = "block";
            c.value = v;
          }
        } else {
          sel.value = v;
        }
      }
    });

    $("#confirmBet").addEventListener("click", async () => {
      const preds = collectPredictions();
      const missing = BET_TYPES.filter(b => !preds[b.key]);
      if (missing.length) {
        toast(`Make picks for: ${missing.map(b => b.label).join(", ")}`, "error");
        return;
      }
      const btn = $("#confirmBet");
      btn.disabled = true;
      try {
        if (isEdit) {
          Contests.updatePicks(c.id, preds);
          closeModal();
          toast("Picks updated", "success");
          renderContests();
        } else if (isJoin) {
          toast("Joining contest…");
          const updated = await Contests.joinShared(mode.contestId, preds, mode.tokenOverride);
          closeModal();
          toast(`Joined · ${fmt.money(updated.entry)} debited`, "success");
          refreshWallet();
          location.hash = "#/contests";
        } else {
          Contests.create(match, tier, preds);
          closeModal();
          toast(`Contest placed · ${fmt.money(tier.entry)} debited`, "success");
          refreshWallet();
          location.hash = "#/contests";
        }
      } catch (e) {
        toast(e.message, "error");
        btn.disabled = false;
      }
    });

    const shareBtn = $("#shareContestBtn");
    if (shareBtn) {
      shareBtn.addEventListener("click", async () => {
        const preds = collectPredictions();
        const missing = BET_TYPES.filter(b => !preds[b.key]);
        if (missing.length) {
          toast(`Make picks for: ${missing.map(b => b.label).join(", ")}`, "error");
          return;
        }
        shareBtn.disabled = true;
        shareBtn.textContent = "Creating…";
        try {
          const created = await Contests.createShared(match, tier, preds);
          closeModal();
          refreshWallet();
          toast("Shared contest created!", "success");
          location.hash = "#/contests";
          setTimeout(() => showShareModal(created), 300);
        } catch (e) {
          toast(e.message, "error");
          shareBtn.disabled = false;
          shareBtn.textContent = "Share with Friends";
        }
      });
    }
  }

  function collectPredictions() {
    const out = {};
    for (const b of BET_TYPES) {
      const sel = $(`#betGrid select[data-bet="${b.key}"]`);
      if (!sel) continue;
      let v = sel.value;
      if (b.kind === "player" && v === "__custom__") {
        v = sel.parentElement.querySelector("input[data-bet-custom]").value.trim();
      }
      if (v) out[b.key] = v;
    }
    return out;
  }

  // ============================================================ MY CONTESTS

  function renderContests() {
    const all = Store.getAllContests().filter(c => c.status === "open");
    VIEW.innerHTML = `
      <div class="section-head">
        <div>
          <h2>My Contests</h2>
          <div class="meta">Open positions awaiting result</div>
        </div>
        <div class="actions"><button class="btn btn-ghost" id="gradeAll">Grade Now</button></div>
      </div>
      <div id="contestList"></div>
    `;

    $("#gradeAll").addEventListener("click", () => gradeAllOpen());

    if (!all.length) {
      $("#contestList").innerHTML = emptyState("No open contests",
        "Browse the <a href='#/matches'>match card</a> to place your first call.", "📜");
      return;
    }
    $("#contestList").innerHTML = all.map(openContestRow).join("");
    $$("#contestList [data-grade]").forEach(b =>
      b.addEventListener("click", () => gradeOne(b.dataset.grade))
    );
    $$("#contestList [data-view]").forEach(b =>
      b.addEventListener("click", () => viewContest(b.dataset.view))
    );
    $$("#contestList [data-edit]").forEach(b =>
      b.addEventListener("click", () => editContestPicks(b.dataset.edit))
    );
    $$("#contestList [data-cancel]").forEach(b =>
      b.addEventListener("click", () => cancelContest(b.dataset.cancel))
    );
    $$("#contestList [data-share]").forEach(b =>
      b.addEventListener("click", () => showShareModal(Store.getContest(b.dataset.share)))
    );
  }

  function lockBadge(c) {
    if (Contests.isLocked(c)) {
      return `<span class="tag loss" title="Picks locked at toss">🔒 LOCKED</span>`;
    }
    const ms = Contests.msUntilLock(c);
    if (!ms) return `<span class="tag pending">Editable</span>`;
    return `<span class="tag pending" title="Picks lock 30 min before match">✎ ${formatDuration(ms)} to lock</span>`;
  }

  function formatDuration(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }

  function openContestRow(c) {
    const top = c.schedule[0] || 0;
    const locked = Contests.isLocked(c);
    const seats = c.isShared
      ? `${(c.participants || []).length} / ${c.size} joined`
      : `${c.size} seats`;
    return `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="margin-bottom:2px">${esc(c.matchLabel)}${c.isShared ? ' <span class="tag pending" style="font-size:11px;vertical-align:middle">SHARED</span>' : ""}</h3>
            <div class="meta" style="color:var(--ink-soft);font-style:italic">
              ${esc(c.tierLabel)} · ${seats} · placed ${fmt.date(c.createdAt)}
              ${c.lastEditedAt ? ` · edited ${fmt.date(c.lastEditedAt)}` : ""}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${lockBadge(c)}
            ${c.isShared ? `<button class="btn btn-ghost" data-share="${c.id}">Share Link</button>` : ""}
            ${locked
              ? `<button class="btn btn-dark" data-view="${c.id}">View Picks</button>
                 <button class="btn btn-primary" data-grade="${c.id}">Grade</button>`
              : `${!c.isShared ? `<button class="btn btn-primary" data-edit="${c.id}">Edit Picks</button>` : ""}
                 <button class="btn btn-dark" data-view="${c.id}">View</button>
                 <button class="btn btn-danger" data-cancel="${c.id}">Withdraw</button>`
            }
          </div>
        </div>
        <div class="contest-summary" style="margin-top:14px">
          <div class="stat"><div class="stat-label">Entry</div><div class="stat-value">${fmt.money(c.entry)}</div></div>
          <div class="stat"><div class="stat-label">Pool</div><div class="stat-value">${fmt.money(c.pool)}</div></div>
          <div class="stat"><div class="stat-label">Top Prize</div><div class="stat-value">${fmt.money(c.pool * top)}</div></div>
          <div class="stat"><div class="stat-label">Match Time</div><div class="stat-value" style="font-size:16px">${esc(fmt.day(c.startsAt))}<br><span style="font-size:13px">${esc(fmt.time(c.startsAt))}</span></div></div>
        </div>
      </div>
    `;
  }

  function editContestPicks(id) {
    const c = Store.getContest(id);
    if (!c) return;
    if (Contests.isLocked(c)) {
      toast("Picks have already locked.", "error");
      renderContests();
      return;
    }
    openBetBuilder({ kind: "edit", contest: c });
  }

  function viewContest(id) {
    const c = Store.getContest(id);
    if (!c) return;

    const profile = Store.ensureProfile();
    const myPicks = c.isShared
      ? (c.participants || []).find(p => p.userId === profile.userId)?.predictions || {}
      : (c.userPredictions || {});

    const rows = BET_TYPES.map(b => `
      <tr>
        <td>${esc(b.label)}</td>
        <td>${esc(displayPick(b, myPicks[b.key]))}</td>
        <td style="text-align:right;color:var(--ink-soft)">${b.points} pts</td>
      </tr>
    `).join("");

    let participantsHtml = "";
    if (c.isShared && (c.participants || []).length) {
      const pRows = c.participants.map(p => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span>${esc(p.name)}${p.userId === profile.userId ? ' <span class="tag pending">YOU</span>' : ""}${p.isCreator ? ' <span class="tag" style="background:var(--gold);color:#000">Host</span>' : ""}</span>
          <span style="color:var(--ink-soft)">${fmt.date(p.joinedAt)}</span>
        </div>
      `).join("");
      participantsHtml = `
        <h3 style="font-family:'Cormorant Garamond',serif;color:var(--navy);font-size:18px;margin-top:20px">
          Participants (${c.participants.length} / ${c.size})
        </h3>${pRows}`;
    }

    let resultHtml = "";
    if (c.status === "settled" && c.ranking) {
      resultHtml = renderRankingTable(c);
    }

    openModal({
      title: c.matchLabel,
      body: `
        <p style="margin-top:0;color:var(--ink-soft);font-style:italic">${esc(c.tierLabel)} · pool ${fmt.money(c.pool)}${c.isShared ? " · Shared" : ""}</p>
        ${participantsHtml}
        <h3 style="font-family:'Cormorant Garamond',serif;color:var(--navy);font-size:18px;margin-top:20px">Your picks</h3>
        <table><thead><tr><th>Parameter</th><th>Pick</th><th style="text-align:right">Weight</th></tr></thead><tbody>${rows}</tbody></table>
        ${resultHtml}
      `,
      foot: `<span class="meta">Settled contests credit winnings to your wallet automatically.</span>
             <button class="btn btn-dark" data-close="1">Close</button>`
    });
  }

  function renderRankingTable(c) {
    const head = `<div class="lb-row head"><div>Pos</div><div>Player</div><div>Points</div><div>Payout</div><div>P/L</div></div>`;
    const body = c.ranking.map(r => {
      const cls = r.isUser ? "you" : "";
      const pl = r.payout - c.entry;
      return `
        <div class="lb-row ${cls}">
          <div class="rank">#${r.rank}</div>
          <div>${esc(r.name)}${r.isUser ? ' <span class="tag pending" style="margin-left:6px">YOU</span>' : ''}</div>
          <div class="pay points">${r.points}</div>
          <div class="pay">${fmt.money(r.payout)}</div>
          <div class="pay ${pl >= 0 ? "win" : "loss"}">${pl >= 0 ? "+" : ""}${fmt.money(pl)}</div>
        </div>
      `;
    }).join("");
    return `<h3 style="font-family:'Cormorant Garamond',serif;color:var(--navy);font-size:18px;margin-top:24px">Result</h3>${head}${body}`;
  }

  function displayPick(bet, value) {
    if (!value) return "—";
    if (bet.kind === "range") {
      const b = bet.buckets.find(x => x.id === value);
      return b ? b.label : value;
    }
    return value;
  }

  function showShareModal(c) {
    const url = GithubStore.shareUrl(c.id);
    openModal({
      title: "Share Contest Link",
      body: `
        <p style="margin-top:0;color:var(--ink-soft);font-style:italic">
          Send this link to your friends. Each person needs to open it, make their picks, and join.
          <br>Seats: <strong>${c.participants?.length || 1} / ${c.size}</strong> filled.
        </p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="text" id="shareUrlInput" value="${esc(url)}" readonly
            style="flex:1;min-width:0;font-size:13px;font-family:monospace">
          <button class="btn btn-primary" id="copyShareUrl">Copy</button>
        </div>
      `,
      foot: `<button class="btn btn-dark" data-close="1">Done</button>`
    });
    $("#copyShareUrl").addEventListener("click", () => {
      navigator.clipboard.writeText(url).then(() => toast("Link copied!", "success"));
    });
  }

  async function renderJoin(contestId, encodedToken) {
    const tokenOverride = encodedToken ? GithubStore.decodeToken(encodedToken) : null;
    VIEW.innerHTML = `<div class="panel"><p style="color:var(--ink-soft)">Loading contest…</p></div>`;
    try {
      const c = await GithubStore.read(contestId);
      if (!c) {
        VIEW.innerHTML = emptyState("Contest Not Found",
          "This link may be invalid or the contest was removed.", "?");
        return;
      }

      const profile = Store.ensureProfile();
      const alreadyJoined = (c.participants || []).some(p => p.userId === profile.userId);
      const full = (c.participants || []).length >= c.size;
      const locked = Contests.isLocked(c);

      const participantRows = (c.participants || []).map(p => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span>${esc(p.name)}${p.isCreator ? ' <span class="tag pending">Host</span>' : ""}</span>
          <span style="color:var(--ink-soft);font-size:12px">${fmt.date(p.joinedAt)}</span>
        </div>
      `).join("");

      VIEW.innerHTML = `
        <div class="section-head">
          <div>
            <h2>${esc(c.matchLabel)}</h2>
            <div class="meta">${esc(c.tierLabel)} · Shared Contest</div>
          </div>
        </div>
        <div class="panel">
          <div class="contest-summary">
            <div class="stat"><div class="stat-label">Entry</div><div class="stat-value">${fmt.money(c.entry)}</div></div>
            <div class="stat"><div class="stat-label">Seats</div><div class="stat-value">${(c.participants||[]).length} / ${c.size}</div></div>
            <div class="stat"><div class="stat-label">Prize Pool</div><div class="stat-value">${fmt.money(c.pool)}</div></div>
            <div class="stat"><div class="stat-label">Match</div><div class="stat-value" style="font-size:15px">${esc(fmt.day(c.startsAt))}</div></div>
          </div>
          <h3 style="font-family:'Cormorant Garamond',serif;font-size:18px;color:var(--navy);margin-top:20px">Participants</h3>
          <div>${participantRows || '<p style="color:var(--ink-soft)">No one has joined yet.</p>'}</div>
          <div style="margin-top:20px">
            ${alreadyJoined
              ? `<p class="tag pending">You have already joined this contest.</p>
                 <a href="#/contests" class="btn btn-dark" style="margin-top:8px">My Contests</a>`
              : full
                ? `<p class="tag loss">All seats are filled.</p>`
                : locked
                  ? `<p class="tag loss">Picks are locked — toss has begun.</p>`
                  : `<button class="btn btn-primary" id="joinNowBtn">Make Picks &amp; Join</button>`
            }
          </div>
        </div>
      `;

      const joinBtn = $("#joinNowBtn");
      if (joinBtn) {
        joinBtn.addEventListener("click", async () => {
          // Need match shape for the bet builder
          const matchShape = {
            id: c.matchId,
            teamA: c.teamA, teamB: c.teamB,
            teamACode: c.teamACode, teamBCode: c.teamBCode,
            startMs: c.startsAt, venue: "", squads: null
          };
          const tier = { entry: c.entry, size: c.size, label: c.tierLabel };
          openBetBuilder({ kind: "join", match: matchShape, tier, contestId, tokenOverride });
        });
      }
    } catch (e) {
      VIEW.innerHTML = emptyState("Error Loading Contest", esc(e.message), "!");
    }
  }

  function cancelContest(id) {
    const c = Store.getContest(id);
    if (!c) return;
    if (!confirm(`Withdraw from "${c.tierLabel}"? Your entry of ${fmt.money(c.entry)} will be refunded.`)) return;
    Store.adjustBalance(c.entry);
    Store.deleteContest(id);
    refreshWallet();
    toast("Contest withdrawn · entry refunded", "success");
    renderContests();
  }

  // ============================================================ GRADING

  async function gradeOne(id) {
    const c = Store.getContest(id);
    if (!c) return;
    toast("Fetching match result…");
    try {
      const info = await Api.matchInfo(c.matchId, { force: true });
      const result = Contests.extractResult(info, c);
      if (!result || (!result.winner && !result.toss)) {
        toast(Api.hasUserKey()
          ? "Match not yet settled — try after the game ends."
          : "Result not in the shared feed yet. Cron refreshes every 30 min.", "error");
        return;
      }
      const updated = c.isShared
        ? await Contests.settleShared(id, result)
        : Contests.settle(id, result);
      const me = updated.ranking.find(r => r.isUser);
      const verdict = me?.payout >= c.entry
        ? `Finished #${me.rank} · won ${fmt.money(me.payout)}`
        : `Finished #${me?.rank || "?"} · no payout`;
      toast(verdict, me?.payout >= c.entry ? "success" : "error");
      refreshWallet();
      renderContests();
    } catch (e) {
      toast(e.message, "error");
    }
  }

  async function gradeAllOpen() {
    const open = Store.getAllContests().filter(c => c.status === "open");
    if (!open.length) { toast("Nothing to grade"); return; }
    let graded = 0;
    for (const c of open) {
      try {
        const info = await Api.matchInfo(c.matchId, { force: true });
        const result = Contests.extractResult(info, c);
        if (result && (result.winner || result.toss)) {
          if (c.isShared) await Contests.settleShared(c.id, result);
          else Contests.settle(c.id, result);
          graded++;
        }
      } catch (e) { /* skip */ }
    }
    toast(`Graded ${graded} of ${open.length} contests`, graded ? "success" : "");
    refreshWallet();
    renderContests();
  }

  // ============================================================ HISTORY

  function renderHistory() {
    const all = Store.getAllContests().filter(c => c.status === "settled");
    const s = Contests.stats();

    VIEW.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Ledger</h2>
          <div class="meta">Settled contests · running totals</div>
        </div>
      </div>
      <div class="contest-summary" style="margin-bottom:24px">
        <div class="stat"><div class="stat-label">Contests</div><div class="stat-value">${s.contests}</div></div>
        <div class="stat"><div class="stat-label">Money Put</div><div class="stat-value">${fmt.money(s.totalIn)}</div></div>
        <div class="stat"><div class="stat-label">Money Won</div><div class="stat-value">${fmt.money(s.totalOut)}</div></div>
        <div class="stat"><div class="stat-label">Net P/L</div><div class="stat-value" style="color:${s.net >= 0 ? "var(--gold)" : "#e88"}">
          ${s.net >= 0 ? "+" : ""}${fmt.money(s.net)}
        </div></div>
      </div>
      <div id="historyList"></div>
    `;

    if (!all.length) {
      $("#historyList").innerHTML = emptyState("No settled contests yet",
        "Once a contest is graded, it'll appear here with full breakdown.", "📖");
      return;
    }

    $("#historyList").innerHTML = all.map(historyRow).join("");
    $$("#historyList [data-view]").forEach(b =>
      b.addEventListener("click", () => viewContest(b.dataset.view))
    );
  }

  function historyRow(c) {
    const me = (c.ranking || []).find(r => r.isUser) || { rank: "?", payout: 0, points: 0 };
    const pl = me.payout - c.entry;
    const won = me.payout >= c.entry;
    return `
      <div class="panel" style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:14px;padding:16px 20px">
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;color:var(--navy)">${esc(c.matchLabel)}</div>
          <div style="font-size:12px;color:var(--ink-soft);font-style:italic">
            ${esc(c.tierLabel)} · settled ${fmt.date(c.settledAt)} · finished #${me.rank} of ${c.size}
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center">
          <div style="text-align:right">
            <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:${won ? "var(--green)" : "var(--maroon)"}">
              ${pl >= 0 ? "+" : ""}${fmt.money(pl)}
            </div>
            <div style="font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.06em">
              ${fmt.money(me.payout)} won · ${fmt.money(c.entry)} in
            </div>
          </div>
          <button class="btn btn-dark" data-view="${c.id}">Detail</button>
        </div>
      </div>
    `;
  }

  // ============================================================ SETTINGS

  function renderSettings() {
    const p = Store.ensureProfile();
    const s = Store.getSettings();
    VIEW.innerHTML = `
      <div class="section-head">
        <div><h2>Settings</h2><div class="meta">Profile · API · Data</div></div>
      </div>
      <div class="panel">
        <h3>Profile</h3>
        <div class="form-row split">
          <div>
            <label>Display Name</label>
            <input type="text" id="profName" value="${esc(p.name)}" maxlength="32">
          </div>
          <div>
            <label>Wallet Balance</label>
            <input type="text" value="${fmt.money(p.balance)}" disabled>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="saveProf">Save Profile</button>
          <button class="btn btn-ghost" id="resetWallet">Reset Wallet to ${fmt.money(Store.STARTING_BALANCE)}</button>
        </div>
      </div>

      <div class="panel">
        <h3>Data Source</h3>
        <p style="margin-top:0;color:var(--ink-soft);font-style:italic">
          By default, fixtures come from the shared feed (<code>data/feed.json</code>) refreshed every 30 minutes by GitHub Actions.
          No key required. Optionally, paste a personal CricAPI key to bypass the feed and pull live data on demand.
        </p>
        <div class="form-row">
          <label>Personal CricAPI Key (optional)</label>
          <input type="password" id="apiKey" value="${esc(s.apiKey || "")}" placeholder="leave blank to use the shared feed">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="saveApi">Save</button>
          <button class="btn btn-ghost" id="testApi">Test Live Mode</button>
          <button class="btn btn-dark" id="clearCache">Clear Cache</button>
          <button class="btn btn-dark" id="reloadFeed">Reload Feed</button>
        </div>
        <div id="feedStatus" style="margin-top:14px;font-size:13px;color:var(--ink-soft)"></div>
      </div>

      <div class="panel">
        <h3>Shared Contests</h3>
        <p style="margin-top:0;color:var(--ink-soft);font-style:italic">
          To create or join shared contests (real friends, not bots), paste a GitHub Personal Access Token with
          <code>Contents: Write</code> permission on this repo. Everyone in the group can use the same token.
          <br><br>
          Create one at <strong>GitHub → Settings → Developer settings → Fine-grained tokens</strong>.
          Set repository access to <em>atharvgaur1845/Boundary_book</em>, grant <em>Contents: Read & Write</em>.
        </p>
        <div class="form-row">
          <label>GitHub Token</label>
          <input type="password" id="githubToken" value="${esc(s.githubToken || "")}" placeholder="github_pat_…">
        </div>
        <button class="btn btn-primary" id="saveGithubToken">Save Token</button>
      </div>

      <div class="panel">
        <h3>Data</h3>
        <p style="margin-top:0;color:var(--ink-soft);font-style:italic">
          Wipe all local contests, history, and the wallet. The API key is preserved.
        </p>
        <button class="btn btn-danger" id="wipeAll">Wipe All Data</button>
      </div>
    `;

    $("#saveProf").addEventListener("click", () => {
      Store.setName($("#profName").value);
      refreshWallet();
      toast("Profile saved", "success");
    });
    $("#resetWallet").addEventListener("click", () => {
      if (!confirm("Reset balance to starting amount?")) return;
      Store.resetWallet();
      refreshWallet();
      toast("Wallet reset", "success");
      renderSettings();
    });
    $("#saveApi").addEventListener("click", () => {
      Store.setSettings({ apiKey: $("#apiKey").value.trim() });
      Store.clearCache();
      matchCache = null;
      toast("API key saved", "success");
    });
    $("#testApi").addEventListener("click", async () => {
      Store.setSettings({ apiKey: $("#apiKey").value.trim() });
      try {
        const list = await Api.listMatches({ force: true });
        toast(`Connected · ${list.length} IPL fixture(s) found`, "success");
      } catch (e) {
        toast(`Failed: ${e.message}`, "error");
      }
    });
    $("#clearCache").addEventListener("click", () => {
      Store.clearCache();
      matchCache = null;
      toast("Cache cleared", "success");
    });
    $("#reloadFeed").addEventListener("click", async () => {
      try {
        const feed = await Api.loadFeed({ force: true });
        matchCache = null;
        toast(`Feed reloaded · ${feed.matches?.length || 0} matches`, "success");
        renderFeedStatus(feed);
      } catch (e) {
        toast(`Feed error: ${e.message}`, "error");
      }
    });
    // Show feed metadata on load
    Api.loadFeed().then(renderFeedStatus).catch(() => {});
    $("#saveGithubToken").addEventListener("click", () => {
      Store.setSettings({ githubToken: $("#githubToken").value.trim() });
      toast("GitHub token saved", "success");
    });
    $("#wipeAll").addEventListener("click", () => {
      if (!confirm("This will erase your contests, history, and wallet. Continue?")) return;
      const apiKey = Store.getSettings().apiKey;
      localStorage.clear();
      Store.setSettings({ apiKey });
      Store.ensureProfile();
      refreshWallet();
      toast("All data wiped", "success");
      location.hash = "#/matches";
    });
  }

  // ------------------------------------------------------------- helpers

  function emptyState(title, body, ico = "•") {
    return `
      <div class="empty-state">
        <div class="ico">${ico}</div>
        <h3>${esc(title)}</h3>
        <p>${body}</p>
      </div>
    `;
  }

  // ------------------------------------------------------------- theme toggle

  const TOGGLE_BTN = $("#themeToggle");
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    TOGGLE_BTN.textContent = t === "dark" ? "🌙" : "☀️";
    localStorage.setItem("bb.v1.theme", t);
  }
  TOGGLE_BTN.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
  });
  // Sync icon to whatever was applied by the pre-paint inline script
  applyTheme(document.documentElement.dataset.theme || "dark");

  // ------------------------------------------------------------- boot

  Store.ensureProfile();
  refreshWallet();
  if (!location.hash) location.hash = "#/matches";
  route();
})();
