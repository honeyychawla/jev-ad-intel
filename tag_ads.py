"""Tag ads with Jev: hook, offer, CTA, awareness stage, tags and landing-page match.

Input: a JSON list of ads in the normalized shape (see sample_ads.json).
Output: results/<name>.jsonl (full answers), results/<name>.csv, results/<name>_summary.json

    .venv/bin/python tag_ads.py sample_ads.json
    .venv/bin/python tag_ads.py ads.json --limit 20 --concurrency 8
    .venv/bin/python tag_ads.py sample_ads.json --dry-run    # show the request, no API call
"""

import argparse
import asyncio
import csv
import json
import os
import re
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

import taxonomy as tx
from fetchers import LandingPages, fetch_image_part
from jev_client import JevClient, JevError, load_env

HERE = Path(__file__).parent
CHOICE_REVIEW_BELOW = 0.5  # choice confidence under this -> flag for a human look
NOUL_UNSURE = (0.35, 0.65)  # yes/no probability in this band -> unsure


def first_line(text: str) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:300]
    return ""


def days_running(ad: dict) -> int | None:
    start = ad.get("start_date")
    if not start:
        return None
    try:
        if isinstance(start, (int, float)):
            d0 = datetime.fromtimestamp(start, tz=timezone.utc).date()
        else:
            d0 = date.fromisoformat(str(start)[:10])
    except ValueError:
        return None
    end = ad.get("end_date")
    try:
        d1 = date.fromisoformat(str(end)[:10]) if end and not ad.get("is_active", True) else date.today()
    except ValueError:
        d1 = date.today()
    return max(0, (d1 - d0).days)


def ad_state(ad: dict, creative: dict | None) -> dict:
    s = {
        "brand": ad.get("brand") or ad.get("page_name"),
        "format": ad.get("format"),
        "first_line": first_line(ad.get("body", "")),
        "primary_text": (ad.get("body") or "")[:3000],
        "headline": ad.get("headline"),
        "description": ad.get("link_description"),
        "button_label": ad.get("cta_button"),
    }
    if ad.get("video_transcript"):
        s["video_transcript"] = ad["video_transcript"][:3000]
    if creative:
        s["creative"] = creative
    return {"ad": {k: v for k, v in s.items() if v}}


def lp_state(page: dict) -> dict:
    return {k: page.get(k) for k in ("title", "meta_description", "headlines", "buttons", "text") if page.get(k)}


def read_choice(ans: dict) -> tuple[str | None, float | None]:
    return (ans.get("choice"), ans.get("confidence")) if ans else (None, None)


def read_score(ans: dict, labels: list[str]) -> tuple[str | None, float | None, float | None]:
    if not ans or ans.get("score") is None:
        return None, None, None
    idx = min(len(labels) - 1, max(0, round(ans["score"])))
    return labels[idx], round(ans["score"], 2), ans.get("confidence")


def is_homepage(url: str | None) -> bool:
    return bool(url) and urlparse(url).path.strip("/") == ""


async def tag_one(ad: dict, jev: JevClient, http: httpx.AsyncClient, pages: LandingPages,
                  img_dir: Path | None = None, on_media=None, on_partial=None) -> dict:
    """Tag one ad with Jev in two steps so a live view can show progress:
    1. creative + ad copy → Jev ad questions → `on_partial(row)` (usually ~1s after the pull)
    2. landing page (can take a while if it blocks bots) → `on_media(ad, creative, page)`
       → Jev landing-page questions.
    Catalog (DPA) ads land on a different product page per viewer, so their page isn't judged."""
    creative_url = (ad.get("image_urls") or [None])[0] or ad.get("video_thumbnail_url")
    img_file = None
    if img_dir is not None and creative_url:
        img_file = re.sub(r"[^\w-]", "_", str(ad.get("ad_id"))) + ".jpg"
    catalog = (ad.get("format") or "") == "dpa" and "landing_page_override" not in ad
    if "landing_page_override" in ad:
        page_task = asyncio.ensure_future(asyncio.sleep(0, result={"status": "ok", **ad["landing_page_override"]}))
    elif catalog:
        page_task = asyncio.ensure_future(asyncio.sleep(0, result={"status": "catalog", "url": ad.get("landing_url")}))
    else:
        page_task = asyncio.ensure_future(pages.get(ad.get("landing_url")))
    creative = await fetch_image_part(http, creative_url, save_to=(img_dir / img_file) if img_file else None)
    state = ad_state(ad, creative)

    row = {
        "ad_id": ad.get("ad_id"), "brand": ad.get("brand") or ad.get("page_name"),
        "format": ad.get("format"), "days_running": days_running(ad),
        "variant_count": ad.get("variant_count"), "button_label": ad.get("cta_button"),
        "first_line": first_line(ad.get("body", "")), "landing_url": ad.get("landing_url"),
        "lp_homepage": is_homepage(ad.get("landing_url")),
        "creative_sent": bool(creative), "img": img_file if creative else None, "lp_status": "pending",
    }
    results, jev_ms = [], 0
    try:
        results.append(await jev.decide(state, tx.ad_questions()))
        jev_ms += results[-1].get("_ms", 0)
    except JevError as e:
        page_task.cancel()
        return {"row": {**row, "lp_status": None, "error": str(e)}, "raw": None}

    a = results[0]["answers"]
    review = []
    for field in ("hook_type", "offer_type", "cta_ask", "creative_format", "driver", "funnel"):
        row[field], conf = read_choice(a.get(field))
        row[f"{field}_conf"] = round(conf, 2) if conf is not None else None
        if conf is None or conf < CHOICE_REVIEW_BELOW:
            review.append(field)
    row["awareness_stage"], row["awareness_score"], conf = read_score(a.get("awareness_stage"), tx.AWARENESS_LABELS)
    row["awareness_conf"] = round(conf, 2) if conf is not None else None
    for field in ("hook_specificity", "offer_strength", "durability"):
        ans = a.get(field) or {}
        row[field] = round(ans["score"], 1) if ans.get("score") is not None else None
        row[f"{field}_conf"] = round(ans["confidence"], 2) if ans.get("confidence") is not None else None
        probs = ans.get("probabilities") or {}
        row[f"{field}_probs"] = [round(probs.get(str(i), 0), 2) for i in range(4)] if probs else None
    p = (a.get("claim_risk") or {}).get("noul")
    row["claim_risk"] = round(p, 2) if p is not None else None
    row["tokens"] = (results[0].get("usage") or {}).get("input_tokens")
    for tag in tx.AD_TAGS:
        p = (a.get(f"tag_{tag}") or {}).get("noul")
        row[f"tag_{tag}"] = round(p, 2) if p is not None else None
    row["jev_ms"] = round(jev_ms)
    row["judgments"] = len(a)
    row["cost_usd"] = round(results[0].get("usage", {}).get("cost") or 0, 7)
    row["needs_review"] = ",".join(review)
    if on_partial:
        on_partial(dict(row))

    page = await page_task
    if on_media:
        on_media(ad, creative, page)
    row.update({
        "lp_status": page.get("status"), "lp_kind": page.get("kind"),
        "lp_via": page.get("via", "direct") if page.get("status") == "ok" else None,
        "lp_title": page.get("title"), "lp_headlines": " | ".join((page.get("headlines") or [])[:3]) or None,
    })
    if page.get("status") == "ok":
        try:
            results.append(await jev.decide({**state, "landing_page": lp_state(page)}, tx.landing_page_questions()))
            jev_ms += results[-1].get("_ms", 0)
        except JevError as e:
            row["lp_status"] = "jev_error"
            row["lp_error"] = str(e)[:200]
    cost = sum(r.get("usage", {}).get("cost") or 0 for r in results)
    row["jev_ms"] = round(jev_ms)
    row["judgments"] = sum(len(r["answers"]) for r in results)
    row["tokens"] = sum((r.get("usage") or {}).get("input_tokens") or 0 for r in results)
    row["requests"] = len(results)

    if len(results) > 1:
        b = results[1]["answers"]
        row["lp_match"], row["lp_match_score"], _ = read_score(b.get("lp_match"), tx.LANDING_PAGE_MATCH_LABELS)
        for k in ("lp_same_offer", "lp_free_to_paid", "lp_headline_continues_hook"):
            p = (b.get(k) or {}).get("noul")
            row[k] = round(p, 2) if p is not None else None
        p = row.get("lp_same_offer")
        # A generic homepage is its own finding ("sends traffic to the homepage"), not a broken promise.
        row["mismatch"] = None if p is None or row["lp_homepage"] else p < 0.5
        if p is not None and NOUL_UNSURE[0] < p < NOUL_UNSURE[1]:
            review.append("lp_same_offer")

    row["needs_review"] = ",".join(review)
    row["cost_usd"] = round(cost, 7)
    raw = {"ad": {k: v for k, v in ad.items() if k != "landing_page_override"}, "landing_page": page,
           "jev": [{"model": r.get("model"), "answers": r["answers"], "usage": r.get("usage")} for r in results]}
    return {"row": row, "raw": raw}


def summarize(rows: list[dict]) -> dict:
    ok = [r for r in rows if not r.get("error")]
    def dist(key, subset=None):
        c = Counter(r.get(key) for r in (subset or ok) if r.get(key))
        n = sum(c.values()) or 1
        return {k: {"count": v, "pct": round(100 * v / n, 1)} for k, v in c.most_common()}
    checked = [r for r in ok if r.get("mismatch") is not None]
    by_brand = defaultdict(list)
    for r in ok:
        by_brand[r.get("brand")].append(r)
    top = lambda rs, key: next(iter(Counter(r.get(key) for r in rs if r.get(key)).most_common(1)), (None,))[0]
    return {
        "ads_total": len(rows), "ads_tagged": len(ok), "errors": len(rows) - len(ok),
        "total_cost_usd": round(sum(r.get("cost_usd") or 0 for r in ok), 5),
        "format": dist("format"), "hook_type": dist("hook_type"), "offer_type": dist("offer_type"),
        "cta_ask": dist("cta_ask"), "awareness_stage": dist("awareness_stage"),
        "landing_pages": {"checked": len(checked),
                          "mismatch_pct": round(100 * sum(r["mismatch"] for r in checked) / len(checked), 1) if checked else None,
                          "status": dist("lp_status")},
        "needs_review": sum(1 for r in ok if r.get("needs_review")),
        "by_brand": {b: {"ads": len(rs), "top_hook": top(rs, "hook_type"), "top_offer": top(rs, "offer_type")}
                     for b, rs in by_brand.items()},
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    load_env(HERE / ".env")

    ads = json.loads(args.input.read_text())[: args.limit]
    if args.dry_run:
        print(json.dumps({"state": ad_state(ads[0], None), "questions": tx.ad_questions()}, indent=2, ensure_ascii=False)[:4000])
        return

    jev = JevClient(concurrency=args.concurrency)
    t0 = time.time()
    async with httpx.AsyncClient() as http:
        pages = LandingPages(http, os.environ.get("APIFY_TOKEN"))
        out = await asyncio.gather(*(tag_one(ad, jev, http, pages) for ad in ads))
    await jev.close()
    elapsed = time.time() - t0

    outdir = HERE / "results"
    outdir.mkdir(exist_ok=True)
    stem = args.input.stem
    rows = [o["row"] for o in out]
    with open(outdir / f"{stem}.jsonl", "w") as f:
        for o in out:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with open(outdir / f"{stem}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    summary = summarize(rows)
    summary["seconds"] = round(elapsed, 1)
    summary["model"] = jev.model
    (outdir / f"{stem}_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))

    print(f"Tagged {summary['ads_tagged']}/{summary['ads_total']} ads in {summary['seconds']}s, "
          f"Jev cost ${summary['total_cost_usd']}  ({summary['errors']} errors, {summary['needs_review']} flagged for review)")
    for r in rows:
        if r.get("error"):
            print(f"  ERROR {r['ad_id']}: {r['error'][:200]}")
    print(f"Results: results/{stem}.csv")


if __name__ == "__main__":
    asyncio.run(main())
