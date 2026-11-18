"""Pull live ads from Meta Ad Library with Apify's official scraper, then normalize them
into the shape tag_ads.py reads.

Each brand can be a Facebook page URL (most precise) or a plain name (keyword search,
then filtered to ads whose page name contains that name).

    .venv/bin/python scrape_ads.py --name edtech_test --country IN --per-brand 50 \
        "https://www.facebook.com/SomeBrandPage" "Another Brand"

Writes data/<name>_raw.json (as scraped) and data/<name>.json (normalized, ready to tag).
Apify charges per ad scraped (about $0.006 on the free tier); --max-usd caps a run.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

import httpx

from jev_client import load_env

HERE = Path(__file__).parent
# jmlp's Meta Ad Library scraper: first ads in ~6-8s (vs ~45-60s for apify/facebook-ads-scraper),
# about $0.00015 per ad, parallel across brands, and it resolves brand names to their exact page.
ACTOR = "jmlp~meta-ad-library-scraper"
API = "https://api.apify.com/v2"
PRICE_PER_AD = 0.00015  # used for the cost estimate and the spending cap


def actor_input(brands: list[str], country: str, per_brand: int) -> dict:
    """Ad Library URLs go in as URLs; names, page IDs, @usernames and page links go in as pages
    (the scraper looks names up in Ad Library's own advertiser search)."""
    urls = [b for b in brands if "facebook.com/ads/library" in b]
    pages = [b for b in brands if b not in urls]
    inp = {"country": country or "ALL", "activeStatus": "active", "maxAdsPerTarget": per_brand,
           "maxAds": per_brand * max(1, len(brands)), "maxConcurrency": min(20, max(4, 2 * len(brands))),
           "keywordFallback": True}
    if urls:
        inp["adLibraryUrls"] = urls
    if pages:
        inp["pageIDs"] = pages
    return inp


def library_url(brand: str, country: str) -> str:
    if brand.startswith("http"):
        return brand
    if brand.isdigit():  # a Facebook page ID: every ad from exactly that page
        return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
                f"&country={country}&view_all_page_id={brand}&search_type=page&media_type=all")
    return ("https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
            f"&country={country}&q={quote(brand)}&search_type=keyword_unordered&media_type=all")


def get(d: dict | None, *keys, default=None):
    """First non-empty value among camelCase / snake_case variants."""
    if not isinstance(d, dict):
        return default
    for k in keys:
        v = d.get(k)
        if v not in (None, "", [], {}):
            return v
    return default


def unwrap_link(url: str | None) -> str | None:
    """Meta wraps outbound links as l.facebook.com/l.php?u=<real url>."""
    if not url:
        return None
    p = urlparse(url)
    if p.hostname and p.hostname.endswith("facebook.com") and p.path.startswith("/l.php"):
        return parse_qs(p.query).get("u", [url])[0]
    return url


def text_of(v) -> str:
    if isinstance(v, dict):
        return v.get("text") or v.get("markup", {}).get("__html", "") or ""
    return v or ""


PLACEHOLDER = re.compile(r"\s*(\{\{[^}]*\}\}\s*)+")


def clean_text(t):
    """Catalog/dynamic ads keep placeholders like {{product.name}}: drop text that is only
    placeholders, and show inline ones as [name]."""
    if not t or PLACEHOLDER.fullmatch(t):
        return None
    return re.sub(r"\{\{\s*(?:product\.)?([\w.]+)\s*\}\}", lambda m: f"[{m.group(1).replace('_', ' ')}]", t)


def img_of(d):
    return get(d, "originalImageUrl", "original_image_url", "resizedImageUrl", "resized_image_url")


def normalize(item: dict) -> dict | None:
    if item.get("error") or not get(item, "adArchiveID", "adArchiveId", "ad_archive_id"):
        return None
    snap = item.get("snapshot") or {}
    cards = get(snap, "cards", default=[]) or []
    card = cards[0] if cards else {}
    images = get(snap, "images", default=[]) or []
    videos = get(snap, "videos", default=[]) or []
    image_urls = [img_of(i) for i in images] or [img_of(c) for c in cards[:4]]
    video = videos[0] if videos else next((c for c in cards if get(c, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url")), card)
    raw_texts = (text_of(get(snap, "body")), get(snap, "title"), get(snap, "linkDescription", "link_description"))
    # Dynamic (DCO) ads put a placeholder in the main fields and the real copy in their cards.
    body = clean_text(raw_texts[0]) or clean_text(text_of(get(card, "body"))) or ""
    headline = clean_text(raw_texts[1]) or clean_text(get(card, "title"))
    link_desc = clean_text(raw_texts[2]) or clean_text(get(card, "linkDescription", "link_description"))
    ad_id = get(item, "adArchiveID", "adArchiveId", "ad_archive_id")
    source = item.get("inputUrl") or item.get("url") or (item.get("input") if isinstance(item.get("input"), str) else None)
    return {
        "ad_id": ad_id,
        "brand": get(item, "pageName", "page_name") or get(snap, "pageName", "page_name"),
        "page_id": get(item, "pageID", "pageId", "page_id"),
        "page_avatar": get(snap, "pageProfilePictureUrl", "page_profile_picture_url"),
        "format": (get(snap, "displayFormat", "display_format") or "").lower() or None,
        "body": body,
        "is_dynamic_template": any("{{" in (t or "") for t in raw_texts),
        "headline": headline,
        "link_description": link_desc,
        "caption": get(snap, "caption") or get(card, "caption"),
        "cta_button": get(snap, "ctaText", "cta_text") or get(card, "ctaText", "cta_text"),
        "landing_url": unwrap_link(get(snap, "linkUrl", "link_url") or get(card, "linkUrl", "link_url")),
        "image_urls": [u for u in image_urls if u],
        "video_thumbnail_url": get(video, "videoPreviewImageUrl", "video_preview_image_url"),
        "video_url": get(video, "videoHdUrl", "video_hd_url", "videoSdUrl", "video_sd_url"),
        "cards": [{"title": clean_text(get(c, "title")), "body": clean_text(text_of(get(c, "body"))),
                   "image": img_of(c) or get(c, "videoPreviewImageUrl", "video_preview_image_url"),
                   "cta": get(c, "ctaText", "cta_text")} for c in cards[:10]],
        "card_count": len(cards),
        "start_date": get(item, "startDateFormatted") or get(item, "startDate", "start_date"),
        "end_date": get(item, "endDateFormatted") or get(item, "endDate", "end_date"),
        "is_active": get(item, "isActive", "is_active", default=True),
        "variant_count": get(item, "collationCount", "collation_count"),
        "collation_id": get(item, "collationId", "collation_id"),
        "platforms": get(item, "publisherPlatform", "publisher_platform", default=[]),
        "ad_library_url": f"https://www.facebook.com/ads/library/?id={ad_id}",
        "source_url": source,
    }


class AdFilter:
    """Normalizes scraped items one at a time, dropping errors, keyword hits from other
    pages, and repeat copies of the same creative."""

    def __init__(self, brands: list[str], keep_variants: bool = False):
        self.keyword_names = {b.lower() for b in brands if not b.startswith("http") and not b.isdigit()}
        self.keep_variants = keep_variants
        self.seen: set = set()
        self.dropped = 0  # keyword hits from other pages
        self.duplicates = 0

    def accept(self, item: dict) -> dict | None:
        ad = normalize(item)
        if not ad:
            return None
        src = ad["source_url"] or ""
        q = ((parse_qs(urlparse(src).query).get("q") or [""])[0] if src.startswith("http") else src).lower()
        squash = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
        # A name that matched no page is searched as a keyword: keep only that brand's own ads.
        if q in self.keyword_names and squash(q) not in squash(ad["brand"] or ""):
            self.dropped += 1
            return None
        key = ad["collation_id"] or ad["ad_id"]
        if not self.keep_variants and key in self.seen:
            self.duplicates += 1
            return None
        self.seen.add(key)
        return ad


def run_actor(token: str, urls: list[str], per_brand: int, max_usd: float) -> list[dict]:
    headers = {"Authorization": f"Bearer {token}"}
    run_input = urls  # already built by actor_input()
    with httpx.Client(timeout=60) as http:
        r = http.post(f"{API}/acts/{ACTOR}/runs", headers=headers, json=run_input,
                      params={"maxTotalChargeUsd": round(max_usd, 2)})
        if r.status_code == 401:
            sys.exit("Apify rejected the token. Paste a valid one into .env (APIFY_TOKEN=...).")
        r.raise_for_status()
        run = r.json()["data"]
        print(f"Apify run started: {run['id']} (cap ${max_usd:.2f})")
        while run["status"] in ("READY", "RUNNING"):
            time.sleep(10)
            run = http.get(f"{API}/actor-runs/{run['id']}", headers=headers).json()["data"]
            print(f"  status: {run['status']}")
        if run["status"] != "SUCCEEDED":
            print(f"Run ended with status {run['status']}; keeping whatever ads it collected.")
        items = http.get(f"{API}/datasets/{run['defaultDatasetId']}/items",
                         headers=headers, params={"clean": "true", "format": "json"}).json()
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brands", nargs="+", help="Facebook page URLs or brand names")
    ap.add_argument("--name", required=True, help="name for this batch, e.g. edtech_nov")
    ap.add_argument("--country", default="IN")
    ap.add_argument("--per-brand", type=int, default=50)
    ap.add_argument("--max-usd", type=float, help="spending cap for the Apify run")
    ap.add_argument("--keep-variants", action="store_true", help="keep every copy of near-identical ads")
    args = ap.parse_args()
    load_env(HERE / ".env")
    token = os.environ.get("APIFY_TOKEN", "")
    if not token:
        sys.exit("APIFY_TOKEN is empty. Paste your Apify token into .env.")

    cap = args.max_usd or round(len(args.brands) * args.per_brand * PRICE_PER_AD * 1.5 + 0.05, 2)
    items = run_actor(token, actor_input(args.brands, args.country, args.per_brand), args.per_brand, cap)

    datadir = HERE / "data"
    datadir.mkdir(exist_ok=True)
    (datadir / f"{args.name}_raw.json").write_text(json.dumps(items, ensure_ascii=False, indent=1))

    # Keyword searches return ads from any page that mentions the word, so keep only
    # ads whose page name contains one of the plain-name brands.
    filt = AdFilter(args.brands, keep_variants=args.keep_variants)
    ads = [ad for ad in (filt.accept(item) for item in items) if ad]
    dropped = filt.dropped
    (datadir / f"{args.name}.json").write_text(json.dumps(ads, ensure_ascii=False, indent=1))

    by_brand = {}
    for a in ads:
        by_brand[a["brand"]] = by_brand.get(a["brand"], 0) + 1
    print(f"Scraped {len(items)} items -> {len(ads)} unique ads from {len(by_brand)} brands"
          + (f" ({dropped} keyword hits from other pages dropped)" if dropped else ""))
    for b, n in sorted(by_brand.items(), key=lambda x: -x[1]):
        print(f"  {n:4}  {b}")
    print(f"Next: .venv/bin/python tag_ads.py data/{args.name}.json")


if __name__ == "__main__":
    main()
