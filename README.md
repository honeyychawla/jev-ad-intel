# Ad intel: Meta Ad Library → Jev

Pulls live ads from Meta Ad Library, then has Jev (TypeSafe's decision model, via OpenRouter)
tag every ad: hook, offer, CTA, awareness stage, yes/no tags, and whether the landing page
delivers what the ad promised.

## Setup (once)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Then put both keys in `.env` (it's git-ignored), or start the app and paste them into
Settings (the gear at the top right), which tests each key and saves it to `.env` for you:

- `OPENROUTER_API_KEY=` from openrouter.ai/settings/keys (pays for Jev)
- `APIFY_TOKEN=` from console.apify.com → Settings → API & Integrations (pays for scraping)

## Web app (search box + live view)

```bash
.venv/bin/python app.py
```

Open http://localhost:8765, type advertisers (names, Facebook page links or page IDs),
pick a country, and hit Search. The teardown dashboard fills live: a wall of every ad pulled,
each ad broken down field by field with Jev's confidence, category bars, a "needs a human"
strip for low-confidence calls, and a summary screen at the end. Past searches are saved in
`runs/`; click the search bar to see recent searches, open one and press ▶ Replay to watch the
analysis again. The × on a recent search (or "Clear all") moves it to `runs/.cleared/` instead of
deleting it; move a folder back into `runs/` to restore it.

## States and API (for scripts and agents)

All states live in `states.py`; the server enforces the transitions.

```
starting ──► scraping ──► analysing ──► done
   └────────────┴─────────────┴──► stopped | failed        (interrupted = app exited mid-run)
```

| Call | What it does |
|---|---|
| `POST /api/runs` `{"brands": [...], "country": "IN", "per_brand": 25, "reuse": true}` | Start a search → `{"id", "state"}` |
| `GET /api/runs/{id}` | Current snapshot: `state`, `terminal` (true once finished), `meta.stats`, `ads`, `rows` |
| `GET /api/runs/{id}/events` | Live server-sent events (`ad`, `media`, `tagged`, `log`, `state`, `done`/`failed`), each with an `id`; reconnect with `Last-Event-ID` to resume |
| `POST /api/runs/{id}/stop` | Stop now; keeps every ad Jev has already read |
| `GET /api/runs/{id}/csv` | One row per ad |
| `DELETE /api/runs/{id}` | Remove a finished search from Recent (409 while it's running) |
| `DELETE /api/runs` | Clear Recent; searches still running are kept |
| `GET /api/settings` | Whether each key is saved (masked, never the key itself) and the Jev model |
| `POST /api/settings` `{"openrouter_api_key", "apify_token", "jev_model"}` | Save to `.env`; leave a field out to keep it, `""` to remove it |
| `POST /api/settings/test` `{"service": "openrouter" or "apify", "key"}` | Check a key with that service without saving it |
| `GET /api/config` | Keys present, model, prices, `run_states`, `terminal_states`, `lp_labels` |

To wait for a result, poll `GET /api/runs/{id}` until `terminal` is true, then read `rows`.
`meta.stats.notice` explains anything unusual (no ads found, scraper failed, run interrupted).
Each row's `lp_status` says what happened to its landing page; the meanings are in `states.LP_STATUS`.
Bug history and scores are in `ISSUES.md`. A run in progress is saved every 3 seconds, so a crash keeps what finished.

## Command line

```bash
# 1. Scrape: page links or IDs are exact; names are looked up in Ad Library's advertiser search
.venv/bin/python scrape_ads.py --name my_batch --country IN --per-brand 50 \
    "https://www.facebook.com/BrandPage" "Brand Name"

# 2. Tag with Jev
.venv/bin/python tag_ads.py data/my_batch.json
```

Results land in `results/`: a CSV (one row per ad), a JSONL with Jev's full probabilities,
and `<name>_summary.json` with the percentages.

## Files

| File | What it does |
|---|---|
| `taxonomy.py` | The label lists Jev picks from. Edit the wording to fit your market. |
| `scrape_ads.py` | Runs jmlp's Meta Ad Library scraper on Apify (first ads in ~6-10s) and normalizes the ads. |
| `tag_ads.py` | Sends each ad (copy + image + landing page) to Jev and writes results. |
| `fetchers.py` | Downloads ad images and landing-page text. |
| `jev_client.py` | Jev Decisions API client with retries and rate-limit backoff. |
| `sample_ads.json` | 4 made-up ads with known answers, for testing label changes. |

## Costs (Nov 2026 prices)

- Apify scraper (jmlp/meta-ad-library-scraper): about $0.00015 per ad. Repeat searches within 6h reuse the pulled ads for free.
- Bot-blocked landing pages are opened in a real browser via Apify: about $0.002 per page.
- Jev: $0.042 per million input tokens, output free → about $0.0002 per ad with image and landing page.

## Limits

- Ad Library shows no spend or results for normal commercial ads outside the EU/UK.
  "Days running" and "variant count" are the best proxies for what's working.
- Jev reads text and images, not audio: video ads are judged on copy + thumbnail.
- Jev gives no reasons. Check rows flagged in `needs_review`, and hand-check ~30 tags
  on each new market before trusting the totals.
