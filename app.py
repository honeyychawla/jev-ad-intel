"""Local web app: search Meta Ad Library and watch every ad get pulled and analysed by Jev live.

    .venv/bin/python app.py        → open http://localhost:8765

Keys come from .env (OPENROUTER_API_KEY for Jev, APIFY_TOKEN for scraping).
Each search is saved under runs/<id>/ so you can reopen it later.
Run and ad states are defined in states.py.
"""

import asyncio
import csv
import hashlib
import io
import json
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from fetchers import LandingPages
from jev_client import JevClient, JevError, load_env
from scrape_ads import ACTOR, API, PRICE_PER_AD, AdFilter, actor_input
from states import LP_STATUS, TERMINAL, RunState, check_transition, resolve_saved
from tag_ads import days_running, summarize, tag_one

HERE = Path(__file__).parent
RUNS = HERE / "runs"
RUNS.mkdir(exist_ok=True)
CLEARED = RUNS / ".cleared"  # searches removed from Recent are moved here, not deleted
CACHE = HERE / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
CACHE_HOURS = 6
ENV_FILE = HERE / ".env"
DEFAULT_MODEL = "typesafe/jev-1.14"
# Settings the settings menu can change, saved to .env. Keys set in the shell before launch win over .env on restart.
SETTING_ENV = {"openrouter_api_key": "OPENROUTER_API_KEY", "apify_token": "APIFY_TOKEN", "jev_model": "JEV_MODEL"}
FROM_SHELL = {v for v in SETTING_ENV.values() if os.environ.get(v)}
load_env(ENV_FILE)

BROWSER_PAGE_USD = 0.00228
JEV_WAIT_SECS = 45   # after the last ad is pulled, wait at most this long for Jev to read every ad
PAGE_WAIT_SECS = 20  # ...then at most this long for slow landing pages
JEV_USD_PER_AD = 0.0002
SAVE_EVERY_SECS = 3     # while a run is live, save progress this often so a crash keeps what finished
LIVE_KEEP_SECS = 300    # keep a finished run in memory this long (late page reloads), then serve it from disk
PUBLIC_AD_FIELDS = ("ad_id", "brand", "format", "body", "headline", "link_description", "cta_button",
                    "landing_url", "start_date", "days_running", "variant_count", "platforms",
                    "card_count", "is_dynamic_template", "page_avatar", "caption", "cards", "image_urls",
                    "video_url", "video_thumbnail_url", "ad_library_url", "page_id")

app = FastAPI()
LIVE: dict[str, "Run"] = {}


class SearchRequest(BaseModel):
    brands: list[str] = Field(min_length=1, max_length=40)
    country: str = "IN"
    per_brand: int = Field(25, ge=1, le=500)
    reuse: bool = True  # reuse ads pulled for the same search in the last few hours


def public_ad(ad: dict) -> dict:
    out = {k: ad.get(k) for k in PUBLIC_AD_FIELDS}
    out["body"] = (out["body"] or "")[:1500]
    return out


def cache_path(req: SearchRequest) -> Path:
    key = json.dumps([sorted(b.strip().lower() for b in req.brands), req.country, req.per_brand])
    return CACHE / (hashlib.sha1(key.encode()).hexdigest()[:16] + ".json")


class Run:
    def __init__(self, req: SearchRequest):
        self.id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        self.dir = RUNS / self.id
        (self.dir / "img").mkdir(parents=True)
        self.req = req
        self.created = datetime.now().isoformat(timespec="seconds")
        self.t0 = time.time()
        self.events: list[dict] = []
        self.subs: set[asyncio.Queue] = set()
        self.ads: dict[str, dict] = {}
        self.rows: list[dict] = []          # finished ads
        self.partials: dict[str, dict] = {}  # ads Jev has read whose landing page is still loading
        self.raw: list[dict] = []
        self.last_save = 0.0
        self.browser_pages: set[str] = set()
        self.apify_run_id: str | None = None
        self.task: asyncio.Task | None = None
        self.stop_event = asyncio.Event()
        self.state = RunState.STARTING
        self.stats = dict(status=self.state.value, notice=None, scraped=0, pulled=0, pages_read=0, analysed=0,
                          judgments=0, mismatches=0, errors=0, dropped=0, duplicates=0, jev_cost=0.0,
                          jev_ms_total=0, apify_cost_est=0.0, browser_cost_est=0.0, elapsed=0.0)

    # --- state machine -------------------------------------------------------
    @property
    def done(self) -> bool:
        return self.state in TERMINAL

    @property
    def stopping(self) -> bool:
        return self.stop_event.is_set()

    def set_state(self, new: RunState):
        check_transition(self.state, new)
        self.state = new
        self.stats["status"] = new.value
        self.emit("state", state=new.value)

    def finish(self, state: RunState, error: str | None = None):
        """The only way a run ends: record the final state, save everything, tell listeners."""
        try:
            summary = summarize(self.rows) if self.rows else {}
        except Exception as e:  # a summary problem must never stop the run from reaching a final state
            summary, error = {}, error or f"Couldn't build the summary: {type(e).__name__}: {e}"
        if error and not self.stats["notice"]:
            self.stats["notice"] = error
        self.set_state(state)
        self.save(summary)
        if state is RunState.FAILED:
            self.emit("failed", error=error or "failed")
        else:
            self.emit("done", summary=summary)
        # Saved runs are served from disk; release this one from memory once late listeners are gone.
        asyncio.get_running_loop().call_later(LIVE_KEEP_SECS, LIVE.pop, self.id, None)

    # --- events --------------------------------------------------------------
    def emit(self, type_: str, **data):
        self.stats["elapsed"] = round(time.time() - self.t0, 1)
        ev = {"i": len(self.events), "type": type_, "t": self.stats["elapsed"], "s": dict(self.stats), **data}
        self.events.append(ev)
        for q in list(self.subs):
            q.put_nowait(ev)

    def log(self, kind: str, msg: str):
        self.emit("log", kind=kind, msg=msg)

    # --- persistence ---------------------------------------------------------
    def meta(self) -> dict:
        brands = list(dict.fromkeys(a.get("brand") for a in self.ads.values() if a.get("brand")))
        return {"id": self.id, "created": self.created, "request": self.req.model_dump(), "stats": self.stats,
                "brands_found": brands}

    def rows_to_save(self) -> list[dict]:
        """Finished rows, plus ads Jev has read whose page hadn't loaded (only non-empty mid-run)."""
        done_ids = {r["ad_id"] for r in self.rows}
        return self.rows + [{**p, "lp_status": "interrupted"} for a, p in self.partials.items() if a not in done_ids]

    def save_progress(self):
        """Throttled save while live, so a crash or closed app keeps what has finished."""
        if not self.done and time.time() - self.last_save >= SAVE_EVERY_SECS:
            self.save()

    def save(self, summary: dict | None = None):
        self.last_save = time.time()
        (self.dir / "meta.json").write_text(json.dumps(self.meta(), indent=1, ensure_ascii=False))
        (self.dir / "ads.json").write_text(json.dumps([public_ad(a) for a in self.ads.values()], ensure_ascii=False))
        with open(self.dir / "rows.jsonl", "w") as f:
            for r in self.rows_to_save():
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        with open(self.dir / "raw.jsonl", "w") as f:
            for r in self.raw:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        if summary is not None:
            (self.dir / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))


async def execute(run: Run):
    req = run.req
    token = os.environ.get("APIFY_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        if not token:
            raise RuntimeError("APIFY_TOKEN is empty in .env")
        jev = JevClient(concurrency=16)
    except (JevError, RuntimeError) as e:
        run.finish(RunState.FAILED, error=str(e))
        return

    tasks: dict[str, asyncio.Task] = {}
    partials = run.partials
    async with httpx.AsyncClient(timeout=60) as http:
        pages = LandingPages(http, token, browser_concurrency=8)

        def on_media(ad, creative, page):
            if page.get("status") == "ok":
                run.stats["pages_read"] += 1
                if page.get("via") == "apify_browser":
                    run.browser_pages.add(LandingPages.key(page.get("url") or ""))
                    run.stats["browser_cost_est"] = round(len(run.browser_pages) * BROWSER_PAGE_USD, 4)
            run.emit("media", ad_id=ad["ad_id"], image=bool(creative),
                     page={k: page.get(k) for k in ("status", "via", "title", "url", "kind")})

        async def analyse(ad: dict):
            counted = {"judgments": 0, "cost_usd": 0.0, "jev_ms": 0, "analysed": False}

            def account(row: dict):
                s = run.stats
                if not counted["analysed"]:
                    s["analysed"] += 1
                    counted["analysed"] = True
                for key, stat in (("judgments", "judgments"), ("cost_usd", "jev_cost"), ("jev_ms", "jev_ms_total")):
                    v = row.get(key) or 0
                    s[stat] += v - counted[key]
                    counted[key] = v
                s["jev_cost"] = round(s["jev_cost"], 6)

            def on_partial(row: dict):  # ad questions answered; landing page still loading
                partials[row["ad_id"]] = row
                account(row)
                run.emit("tagged", row=row, partial=True)
                run.save_progress()

            try:
                res = await tag_one(ad, jev, http, pages, img_dir=run.dir / "img", on_media=on_media, on_partial=on_partial)
            except Exception as e:  # anything tag_one didn't handle: record it instead of losing the ad
                res = {"row": {"ad_id": ad["ad_id"], "brand": ad.get("brand"), "format": ad.get("format"),
                               "error": f"{type(e).__name__}: {e}"[:300]}, "raw": None}
            row = res["row"]
            run.rows.append(row)
            if res["raw"]:
                run.raw.append(res["raw"])
            account(row)
            if row.get("error"):
                run.stats["errors"] += 1
            run.stats["mismatches"] += 1 if row.get("mismatch") is True else 0
            run.emit("tagged", row=row)
            run.save_progress()

        def take(item: dict):
            ad = filt.accept(item)
            run.stats["dropped"], run.stats["duplicates"] = filt.dropped, filt.duplicates
            if not ad:
                if item.get("error"):
                    run.log("APIFY", f"Scraper note: {str(item.get('error'))[:160]}")
                return
            ad["days_running"] = days_running(ad)
            run.ads[ad["ad_id"]] = ad
            run.stats["pulled"] += 1
            run.emit("ad", ad=public_ad(ad))
            tasks[ad["ad_id"]] = asyncio.create_task(analyse(ad))

        async def wait_for_ads(deadline: float, ready) -> None:
            """Wait until every ad task satisfies `ready`, the deadline passes, or Stop is pressed."""
            stop = asyncio.ensure_future(run.stop_event.wait())
            try:
                while not run.stopping:
                    left = [t for a, t in tasks.items() if not ready(a, t)]
                    remaining = deadline - time.time()
                    if not left or remaining <= 0:
                        return
                    await asyncio.wait(left + [stop], timeout=min(remaining, 0.25), return_when=asyncio.FIRST_COMPLETED)
            finally:
                stop.cancel()

        try:
            brands = [b.strip() for b in req.brands if b.strip()]
            filt = AdFilter(brands)
            cached = cache_path(req)
            offset, scrape_status = 0, "SUCCEEDED"
            run.set_state(RunState.SCRAPING)
            if req.reuse and cached.exists() and time.time() - cached.stat().st_mtime < CACHE_HOURS * 3600:
                items = json.loads(cached.read_text())
                mins = int((time.time() - cached.stat().st_mtime) / 60)
                run.log("APIFY", f"Reusing the {len(items)} ads pulled for this search {mins} min ago (no scraping needed)")
                for item in items:
                    if run.stopping:
                        break
                    offset += 1
                    run.stats["scraped"] = offset
                    take(item)
                    await asyncio.sleep(0.04)  # let the wall fill visibly
            else:
                cap = round(len(brands) * req.per_brand * PRICE_PER_AD * 1.5 + 0.05, 2)
                run.log("APIFY", f"Searching Ad Library: {len(brands)} advertiser(s), country {req.country}, "
                                 f"up to {req.per_brand} live ads each (spend cap ${cap})")
                r = await http.post(f"{API}/acts/{ACTOR}/runs", headers=headers, params={"maxTotalChargeUsd": cap},
                                    json=actor_input(brands, req.country, req.per_brand))
                if r.status_code == 401:
                    raise RuntimeError("Apify rejected the token in .env")
                r.raise_for_status()
                arun = r.json()["data"]
                run.apify_run_id = arun["id"]
                run.log("APIFY", f"Scraper running (run {arun['id']}). Ads stream in as Ad Library answers…")
                scrape_status, last_note, all_items = arun["status"], time.time(), []
                while True:
                    items = (await http.get(f"{API}/datasets/{arun['defaultDatasetId']}/items", headers=headers,
                                            params={"offset": offset, "limit": 200, "format": "json"})).json()
                    for item in items:
                        offset += 1
                        run.stats["scraped"] = offset
                        run.stats["apify_cost_est"] = round(offset * PRICE_PER_AD, 4)
                        all_items.append(item)
                        take(item)
                    if run.stopping:
                        await http.post(f"{API}/actor-runs/{arun['id']}/abort", headers=headers)
                        break
                    if scrape_status not in ("READY", "RUNNING") and not items:
                        break
                    if not items and time.time() - last_note >= 12:
                        last_note = time.time()
                        run.log("APIFY", f"Scraper still loading Ad Library… {int(time.time() - run.t0)}s")
                    await asyncio.sleep(1)
                    scrape_status = (await http.get(f"{API}/actor-runs/{arun['id']}", headers=headers)).json()["data"]["status"]
                if all_items and scrape_status == "SUCCEEDED":
                    cached.write_text(json.dumps(all_items, ensure_ascii=False))

            run.log("APIFY", f"Scraper finished ({'stopped by you' if run.stopping else scrape_status}): {offset} items → "
                             f"{run.stats['pulled']} unique ads"
                             + (f", {filt.dropped} from other pages dropped" if filt.dropped else "")
                             + (f", {filt.duplicates} repeat copies merged" if filt.duplicates else ""))
            if not run.stopping and scrape_status != "SUCCEEDED":
                run.stats["notice"] = (f"The Ad Library scraper ended {scrape_status.lower()}"
                                       + (", so these results may be incomplete." if run.ads else " without finding any ads."))
            elif not run.stopping and not run.ads:
                run.stats["notice"] = (f"No live ads found for {', '.join(brands)} in {req.country}. Try the advertiser's "
                                       f"Facebook page link or page ID, or another country.")

            if not run.stopping:
                run.set_state(RunState.ANALYSING)
                # First let Jev read every ad (each ad's own questions take ~1-2s)...
                await wait_for_ads(time.time() + JEV_WAIT_SECS, lambda a, t: t.done() or a in partials)
                # ...then give slow, bot-blocked landing pages a fixed grace period instead of holding the run.
                await wait_for_ads(time.time() + PAGE_WAIT_SECS, lambda a, t: t.done())

            pending = [a for a, t in tasks.items() if not t.done()]
            for a in pending:
                tasks[a].cancel()
            if pending and run.stopping:
                run.log("PAGE", f"Stopped by you: kept {sum(a in partials for a in pending)} ad(s) Jev had already read")
            elif pending:
                run.log("PAGE", f"{len(pending)} ad(s) still loading after the wait: finishing without them")
            for a in pending:
                if a in partials:
                    row = {**partials[a], "lp_status": "stopped" if run.stopping else "timeout"}
                elif run.stopping:
                    continue  # Jev hadn't read it yet; it stays on the wall as pulled
                else:
                    ad = run.ads[a]
                    row = {"ad_id": a, "brand": ad.get("brand"), "format": ad.get("format"),
                           "error": "Jev didn't answer in time"}
                    run.stats["errors"] += 1
                run.rows.append(row)
                run.emit("tagged", row=row)
            run.finish(RunState.STOPPED if run.stopping else RunState.DONE)
        except Exception as e:  # keep whatever finished
            for t in tasks.values():
                t.cancel()
            run.finish(RunState.FAILED, error=f"{type(e).__name__}: {e}")
        finally:
            await jev.close()


# ---------- API ----------

@app.get("/api/config")
async def config():
    return {"has_openrouter": bool(os.environ.get("OPENROUTER_API_KEY")),
            "has_apify": bool(os.environ.get("APIFY_TOKEN")),
            "model": os.environ.get("JEV_MODEL", DEFAULT_MODEL),
            "apify_usd_per_ad": PRICE_PER_AD, "jev_usd_per_ad": JEV_USD_PER_AD,
            "run_states": [s.value for s in RunState], "terminal_states": sorted(s.value for s in TERMINAL),
            "lp_labels": LP_STATUS}


# ---------- settings (Jev / Apify keys) ----------

class SettingsUpdate(BaseModel):
    openrouter_api_key: str | None = None  # None keeps the current value, "" removes it
    apify_token: str | None = None
    jev_model: str | None = None


class KeyTest(BaseModel):
    service: Literal["openrouter", "apify"]
    key: str | None = None  # test this value; empty tests the saved one


def local_only(request: Request):
    """Settings hold secrets: refuse requests sent by pages from other sites."""
    origin = request.headers.get("origin")
    if origin and urlparse(origin).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise HTTPException(403, "Settings can only be changed from this app.")


def mask(v: str) -> str:
    return "" if not v else (f"{v[:4]}••••{v[-4:]}" if len(v) > 12 else "••••")


def settings_view() -> dict:
    def key(name: str) -> dict:
        v = os.environ.get(name, "")
        return {"set": bool(v), "hint": mask(v), "from_shell": name in FROM_SHELL}
    return {"openrouter": key("OPENROUTER_API_KEY"), "apify": key("APIFY_TOKEN"),
            "model": os.environ.get("JEV_MODEL", DEFAULT_MODEL), "default_model": DEFAULT_MODEL}


def write_env(updates: dict[str, str]):
    """Set or clear KEY=VALUE lines in .env, keeping comments and every other line.
    A missing .env starts from .env.example so its comments carry over."""
    src = ENV_FILE if ENV_FILE.exists() else HERE / ".env.example"
    lines = src.read_text().splitlines() if src.exists() else []
    out, seen = [], set()
    for line in lines:
        name = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
        if name in updates:
            if name not in seen:
                out.append(f"{name}={updates[name]}")
            seen.add(name)
        else:
            out.append(line)
    out += [f"{k}={v}" for k, v in updates.items() if k not in seen]
    tmp = ENV_FILE.with_name(".env.tmp")
    tmp.write_text("\n".join(out) + "\n")
    tmp.chmod(0o600)  # secrets: readable by you only
    tmp.replace(ENV_FILE)


@app.get("/api/settings")
async def get_settings():
    return settings_view()


@app.post("/api/settings")
async def save_settings(body: SettingsUpdate, request: Request):
    local_only(request)
    updates: dict[str, str] = {}
    for field, name in SETTING_ENV.items():
        value = getattr(body, field)
        if value is None:
            continue
        value = value.strip()
        if field == "jev_model":
            value = value or DEFAULT_MODEL
            if not re.fullmatch(r"[\w.\-]+/[\w.\-:]+", value):
                raise HTTPException(400, "Model should look like typesafe/jev-1.14")
        elif re.search(r"\s", value) or len(value) > 500:
            raise HTTPException(400, "Keys can't contain spaces or line breaks.")
        updates[name] = value
    if updates:
        write_env(updates)
        for name, value in updates.items():
            if value:
                os.environ[name] = value
            else:
                os.environ.pop(name, None)
    return settings_view()


@app.post("/api/settings/test")
async def test_key(t: KeyTest, request: Request):
    """Check a key with the service it belongs to (OpenRouter or Apify) without saving it."""
    local_only(request)
    name = {"openrouter": "OPENROUTER_API_KEY", "apify": "APIFY_TOKEN"}[t.service]
    key = (t.key or "").strip() or os.environ.get(name, "")
    if not key:
        return {"ok": False, "message": "No key to test yet."}
    url = "https://openrouter.ai/api/v1/key" if t.service == "openrouter" else f"{API}/users/me"
    site = "OpenRouter" if t.service == "openrouter" else "Apify"
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            r = await http.get(url, headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError:
        return {"ok": False, "message": f"Couldn't reach {site}. Check your internet connection."}
    if r.status_code in (401, 403):
        return {"ok": False, "message": f"{site} rejected this key."}
    if r.status_code != 200:
        return {"ok": False, "message": f"{site} answered HTTP {r.status_code}."}
    d = (r.json() or {}).get("data") or {}
    if t.service == "openrouter":
        bits = ["Key works"]
        if d.get("label"):
            bits.append(str(d["label"]))
        if isinstance(d.get("usage"), (int, float)):
            bits.append(f"${d['usage']:.2f} used")
        if isinstance(d.get("limit_remaining"), (int, float)):
            bits.append(f"${d['limit_remaining']:.2f} left")
        return {"ok": True, "message": " · ".join(bits)}
    plan = (d.get("plan") or {}).get("id") if isinstance(d.get("plan"), dict) else None
    return {"ok": True, "message": f"Signed in as {d.get('username') or 'your account'}" + (f" · {plan} plan" if plan else "")}


@app.post("/api/runs")
async def start_run(req: SearchRequest):
    run = Run(req)
    LIVE[run.id] = run
    run.save()
    run.task = asyncio.create_task(execute(run))
    return {"id": run.id, "state": run.state.value}


@app.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str):
    run = LIVE.get(run_id)
    if not run:
        raise HTTPException(404, "Not a live run")
    if run.done:
        return {"ok": False, "state": run.state.value}
    if not run.stopping:
        run.stop_event.set()
        run.log("APIFY", "Stopping: keeping everything Jev has already read…")
    return {"ok": True, "state": run.state.value}


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, request: Request):
    """Server-sent events. Each event has an id; a reconnecting browser sends Last-Event-ID
    and gets only what it missed instead of the whole history again."""
    run = LIVE.get(run_id)
    if not run:
        raise HTTPException(404, "Not a live run")
    try:
        start = int(request.headers.get("last-event-id", "-1")) + 1
    except ValueError:
        start = 0
    q: asyncio.Queue = asyncio.Queue()
    history = run.events[start:]
    run.subs.add(q)

    def frame(ev: dict) -> str:
        return f"id: {ev['i']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"

    async def stream():
        try:
            for ev in history:
                yield frame(ev)
            if run.done:
                return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), 15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield frame(ev)
                if ev["type"] in ("done", "failed"):
                    break
        finally:
            run.subs.discard(q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def load_meta(run_id: str) -> tuple[dict, RunState]:
    """A saved run's meta.json with its resolved state (cheap: doesn't read rows)."""
    d = RUNS / run_id
    if "/" in run_id or ".." in run_id or not (d / "meta.json").exists():
        raise HTTPException(404)
    meta = json.loads((d / "meta.json").read_text())
    if "brands_found" not in meta:  # runs saved before brands_found existed
        ads = json.loads((d / "ads.json").read_text()) if (d / "ads.json").exists() else []
        meta["brands_found"] = list(dict.fromkeys(a.get("brand") for a in ads if a.get("brand")))
    stats = meta.setdefault("stats", {})
    state = resolve_saved(stats.get("status"), run_id in LIVE)
    if state is RunState.INTERRUPTED and stats.get("status") != state.value:
        stats["status"] = state.value
        stats["notice"] = stats.get("notice") or "The app was closed while this search was running; showing what finished."
    return meta, state


def load_saved(run_id: str) -> dict:
    meta, state = load_meta(run_id)
    d = RUNS / run_id
    read = lambda name, default: json.loads((d / name).read_text()) if (d / name).exists() else default
    rows = [json.loads(l) for l in (d / "rows.jsonl").read_text().splitlines()] if (d / "rows.jsonl").exists() else []
    return {"meta": meta, "ads": read("ads.json", []), "rows": rows, "summary": read("summary.json", {}),
            "live": False, "state": state.value, "terminal": True}


@app.get("/api/runs")
async def list_runs():
    out = []
    for d in sorted(RUNS.iterdir(), reverse=True):
        if (d / "meta.json").exists():
            out.append(LIVE[d.name].meta() if d.name in LIVE else load_meta(d.name)[0])
    return out[:30]


def clear_run(run_id: str) -> bool:
    """Take a finished search out of Recent by moving its folder to runs/.cleared/.
    Returns False for a search that is still running (stop it first)."""
    run = LIVE.get(run_id)
    if run and not run.done:
        return False
    d = RUNS / run_id
    if "/" in run_id or ".." in run_id or run_id.startswith(".") or not (d / "meta.json").exists():
        raise HTTPException(404)
    CLEARED.mkdir(exist_ok=True)
    dest = CLEARED / run_id
    if dest.exists():
        dest = CLEARED / f"{run_id}-{uuid.uuid4().hex[:4]}"
    d.rename(dest)
    LIVE.pop(run_id, None)
    return True


@app.delete("/api/runs/{run_id}")
async def remove_run(run_id: str):
    if not clear_run(run_id):
        raise HTTPException(409, "This search is still running. Stop it first.")
    return {"ok": True}


@app.delete("/api/runs")
async def clear_runs():
    ids = [d.name for d in sorted(RUNS.iterdir()) if not d.name.startswith(".") and (d / "meta.json").exists()]
    cleared = [i for i in ids if clear_run(i)]
    return {"ok": True, "cleared": len(cleared), "kept_running": len(ids) - len(cleared)}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = LIVE.get(run_id)
    if run and not run.done:
        return {"meta": run.meta(), "ads": [public_ad(a) for a in run.ads.values()], "rows": run.rows,
                "summary": {}, "live": True, "state": run.state.value, "terminal": False}
    return load_saved(run_id)


@app.get("/api/runs/{run_id}/csv")
async def run_csv(run_id: str):
    rows = load_saved(run_id)["rows"]
    buf = io.StringIO()
    fields = list(dict.fromkeys(k for r in rows for k in r))
    w = csv.DictWriter(buf, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="ads_{run_id}.csv"'})


app.mount("/runs", StaticFiles(directory=RUNS), name="runs")
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")


@app.get("/")
async def index():
    return FileResponse(HERE / "static" / "index.html", headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", 8765)))
