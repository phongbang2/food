#!/usr/bin/env python3
"""Free trend discovery through public RSS feeds.

This module stores only short metadata and source links. It does not scrape
TikTok/Google/News article pages or bypass login, CAPTCHA, or rate limits.
"""

from __future__ import annotations

import json
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


APP_NAME = "AnSapSaiGon-trend-reader/1.0"
CACHE_FILE = Path(__file__).resolve().parent / "out" / "trend_cache.json"
CACHE_TTL_SECONDS = 30 * 60


def _fetch_xml(url: str) -> ET.Element:
    request = Request(
        url,
        headers={
            "User-Agent": APP_NAME,
            "Accept": "application/rss+xml, application/xml, text/xml",
        },
    )
    with urlopen(request, timeout=20) as response:
        return ET.fromstring(response.read())


def _google_news_url(query: str) -> str:
    params = {
        "q": query,
        "hl": "vi",
        "gl": "VN",
        "ceid": "VN:vi",
    }
    return "https://news.google.com/rss/search?" + urlencode(params)


def _bing_news_url(query: str) -> str:
    return "https://www.bing.com/news/search?" + urlencode({"q": query, "format": "rss"})


def _read_text(parent: ET.Element, name: str) -> str:
    value = parent.findtext(name)
    return str(value or "").strip()


def _load_cache() -> dict:
    try:
        payload = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if time.time() - float(payload.get("savedAt", 0)) < CACHE_TTL_SECONDS:
            return payload
    except (OSError, ValueError, TypeError):
        pass
    return {}


def _save_cache(key: str, items: list[dict]) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps(
                {"savedAt": time.time(), "key": key, "items": items},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def search_trends(district: str = "", keyword: str = "", limit: int = 30) -> dict:
    district = district.strip()
    keyword = keyword.strip()
    location = district or "Sài Gòn"
    base = keyword or "quán ngon"
    queries = [
        f'"{base}" "{location}"',
        f'"review quán ăn" "{location}"',
        f'"địa điểm ăn uống" "{location}"',
        f'site:tiktok.com "quán ăn" "{location}"',
        f'site:youtube.com "review quán ăn" "{location}"',
    ]
    cache_key = "|".join(queries)

    cache = _load_cache()
    if cache.get("key") == cache_key and isinstance(cache.get("items"), list):
        return {
            "items": cache["items"][:limit],
            "sources": ["cache RSS"],
            "errors": [],
        }

    items: list[dict] = []
    seen: set[str] = set()
    errors: list[str] = []
    sources: list[str] = []

    for source_name, url_builder in (("Google News RSS", _google_news_url), ("Bing News RSS", _bing_news_url)):
        source_success = False
        for query in queries:
            try:
                root = _fetch_xml(url_builder(query))
                source_success = True
                for item in root.findall(".//item"):
                    title = _read_text(item, "title")
                    link = _read_text(item, "link")
                    if not title or not link:
                        continue
                    key = link or title
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(
                        {
                            "title": title,
                            "link": link,
                            "published": _read_text(item, "pubDate"),
                            "source": _read_text(item, "source") or source_name,
                            "query": query,
                        }
                    )
                    if len(items) >= limit:
                        break
                if len(items) >= limit:
                    break
            except (HTTPError, URLError, TimeoutError, ET.ParseError, OSError) as error:
                errors.append(f"{source_name}: {error}")
        if source_success:
            sources.append(source_name)
        if len(items) >= limit:
            break

    items = items[:limit]
    _save_cache(cache_key, items)
    if not items and errors:
        raise RuntimeError("Không lấy được RSS xu hướng:\n" + "\n".join(errors[:4]))

    return {"items": items, "sources": sources, "errors": errors[:4]}


if __name__ == "__main__":
    result = search_trends("Quận 1", "quán ngon", 10)
    print(json.dumps(result, ensure_ascii=False, indent=2))
