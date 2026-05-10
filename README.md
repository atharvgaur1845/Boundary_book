# Boundary Book

A classical IPL fantasy-betting ledger — Dream11-style contests, position-based payouts, no real money.
Pure static site (HTML + CSS + vanilla JS) backed by a single shared CricAPI feed
that's refreshed by a GitHub Actions cron. **Visitors don't need any API key.**

## How the data flows

```text
GitHub Actions (cron, every 30 min)
        │
        ▼
   scripts/fetch.js   ──── reads CRICAPI_KEY (repo secret)
        │
        ▼
   data/feed.json     ──── committed back to the repo
        │
        ▼
   GitHub Pages       ──── serves the static site
        │
        ▼
   browser app        ──── reads data/feed.json (no key in client)
```

A power user can still paste their own CricAPI key in **Settings** to get
sub-cron freshness (live mode) — it bypasses the feed for that browser only.

## Features

- **Live IPL fixtures** via the shared JSON feed (or live CricAPI in opt-in personal mode).
- **Multi-parameter predictions** per match: toss, match winner, POTM, top run-scorer, top wicket-taker, captain duel, total 4s/6s ranges, highest individual score.
- **Contest tiers** with simulated bot opponents so the position-based payouts are meaningful in a single-user app.
- **Payout schedules**:
  - 3 seats → 60 / 40 (top 2 win, third goes home empty)
  - 5 seats → 50 / 30 / 20
  - 10 seats → 40 / 25 / 18 / 10 / 7
- **Auto-grading** — pull scorecard, score everyone, credit winnings.
- **Wallet & ledger** — money put, money won, net P/L. Starts at ₹10,000.
- **Local-only state** — wallet & contests live in your `localStorage`. No accounts, no real transactions.

## Deploy in 5 minutes

### 1. Push the repo

```bash
git init
git add .
git commit -m "init"
gh repo create boundary-book --public --source=. --push
```

### 2. Add the API key as a repo secret

1. Sign up at <https://cricapi.com> and copy your free key.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `CRICAPI_KEY`
   - Value: *(paste your key)*

### 3. Enable GitHub Pages

**Settings → Pages → Source:** `main` branch, root → Save.
Site will be at `https://<you>.github.io/boundary-book/`.

### 4. Trigger the first feed build

The cron runs every 30 min, but you don't have to wait.
**Actions → Fetch IPL feed → Run workflow.**

After ~30 seconds you'll see a new commit `feed: refresh …` from the bot user. Reload the site — fixtures will appear.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To test the feed builder locally:

```bash
CRICAPI_KEY=your_key node scripts/fetch.js
# inspects data/feed.json
```

## File map

```text
index.html                          — shell + nav + wallet
css/styles.css                      — classic navy / parchment / gold theme
js/data.js                          — IPL teams, squads, bet types, payout tiers
js/storage.js                       — localStorage layer (profile, contests, settings, cache)
js/api.js                           — feed loader + optional live CricAPI override
js/contests.js                      — contest creation, bot generation, scoring, settlement
js/app.js                           — hash routing, views, modal, event handling
data/feed.json                      — built nightly by the workflow (committed)
scripts/fetch.js                    — Node 20 fetch script run by the workflow
.github/workflows/fetch-feed.yml    — cron + checkout + commit
README.md                           — this file
```

## Notes & limits

- **Squads** in `js/data.js` are indicative; players move teams between auctions. Each player picker has a free-text "Other" option.
- **Captain duel** scoring needs captain stats from the scorecard — many free-tier responses don't include them, so this parameter may be left ungraded for some matches.
- **Total 4s / 6s** require a scorecard with per-batter boundary counts. Free-tier CricAPI returns these inconsistently — buckets that can't be graded simply don't award points.
- **POTM** is taken from `player_of_the_match` / `manOfMatch` — present for most completed matches.
- Free CricAPI tier is ~100 calls/day. The cron uses ~3 calls + up to 12 scorecard calls per run × 48 runs/day = well within the ceiling but tighten the cron cadence if you also use live mode.
