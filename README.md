# Boundary Book

A classical IPL fantasy-betting ledger — Dream11-style contests, position-based payouts, no real money.
Pure static site (HTML + CSS + vanilla JS). Ready for GitHub Pages.

## Features

- **Live IPL fixtures** via [CricAPI](https://cricapi.com) (free key, ~100 calls/day).
- **Multi-parameter predictions** per match: toss, match winner, POTM, top run-scorer, top wicket-taker, captain duel, total 4s/6s ranges, highest individual score.
- **Contest tiers** with simulated bot opponents (Lord Ashcombe, Major Whitfield, etc.) so the position-based payouts are meaningful in a single-user app.
- **Payout schedules**:
  - 3 seats → 60% / 40% (top 2 win, third goes home empty)
  - 5 seats → 50 / 30 / 20
  - 10 seats → 40 / 25 / 18 / 10 / 7
- **Auto-grading** — once a match is finished, "Grade" pulls the scorecard, scores everyone, and credits winnings.
- **Wallet & ledger** — money put, money won, net P/L. Starts at ₹10,000.
- **Local-only** — everything is in `localStorage`. No backend, no accounts, no real transactions.

## Run locally

Any static server works. From the project root:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or:

```bash
npx serve .
```

## Get a CricAPI key

1. Sign up at <https://cricapi.com>.
2. Copy your API key.
3. Open the site → **Settings** → paste the key → **Save Key**.
4. Hit **Test Connection** to confirm.

Without a key the wallet, contests, and history work — only live match ingestion is disabled.

## Deploy to GitHub Pages

1. Push this folder to a public GitHub repo, e.g. `boundary-book`.
2. Repo → Settings → Pages → Source: `main` branch, root.
3. Wait ~1 min, then open `https://<username>.github.io/boundary-book/`.

The whole site is one `index.html` plus relative `css/` and `js/` paths, so no build step.

## File map

```
index.html              — shell + nav + wallet
css/styles.css          — classic navy / parchment / gold theme
js/data.js              — IPL teams, squads, bet types, payout tiers
js/storage.js           — localStorage layer (profile, contests, settings, cache)
js/api.js               — CricAPI v1 wrapper with caching
js/contests.js          — contest creation, bot generation, scoring, settlement
js/app.js               — hash routing, views, modal, event handling
```

## Notes & limits

- **Squads** are indicative; players move teams between auctions. Each player picker has a free-text "Other" option for whoever isn't in the dropdown.
- **Captain duel** scoring needs captain stats from the scorecard — many free-tier responses don't include them, so this parameter may be left ungraded for some matches.
- **Total 4s / 6s** require a scorecard with per-batter boundary counts. The free CricAPI tier returns these inconsistently — buckets that can't be graded simply don't award points.
- **POTM** is taken from `player_of_the_match` / `manOfMatch` — present for most completed matches.
- One **API call per refresh + per grading**. Match list is cached for 30 min to stay well within the free quota.
