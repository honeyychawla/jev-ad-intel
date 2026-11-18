"""Fetch landing-page text and ad creatives so Jev can read them."""

import asyncio
import base64
import io
import re
from urllib.parse import parse_qsl, urlencode, urlparse

TRACKING_PREFIXES = ("utm_", "hsa_", "pk_", "mc_")
TRACKING_PARAMS = {"fbclid", "gclid", "gbraid", "wbraid", "msclkid", "ttclid", "twclid", "igshid", "ref", "ref_src",
                   "campaign_id", "adset_id", "ad_id", "placement", "site_source_name"}

import httpx
from bs4 import BeautifulSoup
from PIL import Image

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# Destinations that are not a web landing page we can read.
NON_PAGE_HOSTS = {
    "wa.me": "whatsapp", "api.whatsapp.com": "whatsapp", "m.me": "messenger",
    "play.google.com": "app_store", "apps.apple.com": "app_store", "itunes.apple.com": "app_store",
    "fb.me": "facebook", "facebook.com": "facebook", "www.facebook.com": "facebook",
    "m.facebook.com": "facebook", "instagram.com": "instagram", "www.instagram.com": "instagram",
}


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


async def fetch_landing_page(http: httpx.AsyncClient, url: str | None, max_chars: int = 4000) -> dict:
    if not url:
        return {"status": "no_url"}
    host = (urlparse(url).hostname or "").lower()
    if host in NON_PAGE_HOSTS:
        return {"status": "not_a_web_page", "kind": NON_PAGE_HOSTS[host], "url": url}
    try:
        r = await http.get(url, headers={"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"},
                           follow_redirects=True, timeout=20)
    except httpx.HTTPError as e:
        return {"status": "error", "url": url, "error": type(e).__name__}
    final_host = (r.url.host or "").lower()
    if final_host in NON_PAGE_HOSTS:
        return {"status": "not_a_web_page", "kind": NON_PAGE_HOSTS[final_host], "url": str(r.url)}
    if r.status_code >= 400:
        return {"status": "blocked" if r.status_code in (401, 403, 429) else "error",
                "url": str(r.url), "http_status": r.status_code}
    if "html" not in r.headers.get("content-type", ""):
        return {"status": "not_a_web_page", "kind": r.headers.get("content-type", "unknown"), "url": str(r.url)}

    soup = BeautifulSoup(r.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "template"]):
        tag.decompose()
    meta = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    page = {
        "status": "ok",
        "url": str(r.url),
        "title": _clean(soup.title.string if soup.title else ""),
        "meta_description": _clean(meta.get("content", "") if meta else ""),
        "headlines": [_clean(h.get_text(" ")) for h in soup.find_all(["h1", "h2"])][:8],
        "buttons": list(dict.fromkeys(
            _clean(b.get_text(" ")) for b in soup.find_all(["button", "a"])
            if 0 < len(_clean(b.get_text(" "))) <= 40 and re.search(
                r"buy|enrol|enroll|register|sign|book|start|join|get|claim|pay|subscribe|download|try|apply",
                b.get_text(" "), re.I)
        ))[:10],
        "text": _clean(soup.get_text(" "))[:max_chars],
    }
    if len(page["text"]) < 200:
        # Usually a JavaScript-only page; too little to judge a match fairly.
        page["status"] = "too_little_text"
    return page


async def fetch_via_apify_browser(http: httpx.AsyncClient, url: str, token: str, max_chars: int = 4000) -> dict:
    """Load a page in a real browser through Apify (handles bot blocks and JavaScript pages).
    Costs about $0.002 per page."""
    try:
        r = await http.post(
            "https://api.apify.com/v2/acts/apify~rag-web-browser/run-sync-get-dataset-items",
            headers={"Authorization": f"Bearer {token}"},
            params={"timeout": 120, "maxTotalChargeUsd": 0.02},
            json={"query": url, "maxResults": 1, "scrapingTool": "browser-playwright",
                  "outputFormats": ["markdown"], "requestTimeoutSecs": 30, "dynamicContentWaitSecs": 4},
            timeout=150,
        )
        r.raise_for_status()
        items = r.json()
    except httpx.HTTPStatusError as e:
        return {"status": "error", "url": url, "error": f"apify_browser HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except (httpx.HTTPError, ValueError) as e:
        return {"status": "error", "url": url, "error": f"apify_browser: {type(e).__name__}"}
    if not isinstance(items, list) or not items or not items[0].get("markdown"):
        crawl = (items[0].get("crawl") if isinstance(items, list) and items else None) or {}
        return {"status": "blocked", "url": url, "via": "apify_browser", "http_status": crawl.get("httpStatusCode")}
    item = items[0]
    meta = item.get("metadata") or {}
    page = markdown_to_page(item["markdown"], max_chars)
    return {"status": "ok" if len(page["text"]) >= 200 else "too_little_text", "via": "apify_browser",
            "url": meta.get("url") or url, "title": _clean(meta.get("title", "")),
            "meta_description": _clean(meta.get("description", "")), **page}


LINK = r"\[([^\]\n]{0,300})\]\([^)\n]{0,2000}\)"
IMAGE = r"!\[[^\]\n]{0,300}\]\([^)\n]{0,2000}\)"
CTA_WORDS = r"buy|enrol|enroll|register|sign|book|start|join|get|claim|pay|subscribe|download|try|apply|shop|add to"


def markdown_to_page(md: str, max_chars: int) -> dict:
    """Keep the page's real copy; drop menu and footer lines that are only links."""
    headlines, buttons, kept = [], [], []
    for line in md.splitlines():
        s = re.sub(IMAGE, "", line.strip())
        if not s:
            continue
        for label in re.findall(LINK, s):
            label = _clean(label)
            if 0 < len(label) <= 40 and re.search(CTA_WORDS, label, re.I):
                buttons.append(label)
        if re.match(r"^#{1,2} ", s):
            headlines.append(_clean(re.sub(LINK, r"\1", s.lstrip("#"))))
        bare = re.sub(LINK, "", s)
        if len(re.sub(r"[\s*\-+|#>.\d]", "", bare)) < 3:  # line was only links/bullets
            continue
        kept.append(_clean(re.sub(r"[#*_>|`]+", " ", re.sub(LINK, r"\1", s))))
    return {"headlines": headlines[:8], "buttons": list(dict.fromkeys(buttons))[:10],
            "text": " ".join(kept)[:max_chars]}


class LandingPages:
    """Fetches each landing page once (many ads share one page). Tries a plain request
    first, then falls back to a real browser via Apify when the page blocks bots or
    needs JavaScript."""

    def __init__(self, http: httpx.AsyncClient, apify_token: str | None = None, browser_concurrency: int = 5):
        self.http, self.token = http, apify_token
        self.cache: dict[str, asyncio.Task] = {}
        self.sem = asyncio.Semaphore(browser_concurrency)

    @staticmethod
    def key(url: str) -> str:
        """Same page = same host, path and meaningful query. Tracking params (utm_*, fbclid…)
        are ignored, but params like ?program=germany still tell pages apart."""
        p = urlparse(url)
        kept = sorted((k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                      if not k.lower().startswith(TRACKING_PREFIXES) and k.lower() not in TRACKING_PARAMS)
        return f"{p.netloc.lower()}{p.path.rstrip('/')}" + (f"?{urlencode(kept)}" if kept else "")

    async def _load(self, url: str) -> dict:
        page = await fetch_landing_page(self.http, url)
        if page["status"] in ("blocked", "too_little_text", "error") and self.token:
            async with self.sem:
                retry = await fetch_via_apify_browser(self.http, url, self.token)
                if retry["status"] == "error":  # a transient Apify failure: one more try
                    retry = await fetch_via_apify_browser(self.http, url, self.token)
            if retry["status"] == "ok":
                return retry
            return {**page, "fallback": {k: retry.get(k) for k in ("status", "error", "http_status")}}
        return page

    async def get(self, url: str | None) -> dict:
        if not url:
            return {"status": "no_url"}
        k = self.key(url)
        if k not in self.cache:
            self.cache[k] = asyncio.ensure_future(self._load(url))
        return await self.cache[k]


async def fetch_image_part(http: httpx.AsyncClient, url: str | None, max_side: int = 1024,
                           save_to=None) -> dict | None:
    """Download an image and return it as a Jev image part (JPEG data URL), or None.
    With save_to, also keeps a small copy on disk (Meta's image links expire)."""
    if not url:
        return None
    try:
        r = await http.get(url, headers={"User-Agent": UA}, follow_redirects=True, timeout=20)
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content))
        img = img.convert("RGB")
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        if save_to is not None:
            thumb = img.copy()
            thumb.thumbnail((480, 480))
            thumb.save(save_to, format="JPEG", quality=80)
    except Exception:
        return None
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
