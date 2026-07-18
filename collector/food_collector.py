#!/usr/bin/env python3
"""Collect food places from public OpenStreetMap data for An Sap Sai Gon.

Default behavior is safe: download, normalize, deduplicate, and write JSON/CSV.
Use --push only after configuring APPS_SCRIPT_URL and IMPORT_TOKEN in .env.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


APP_NAME = "AnSapSaiGon-food-collector/1.0"
SHEET_ID = "1LHQlScoOABMay4-faE4ECdX7LlcPaDQzlDJFYqKmiZ8"
SHEET_NAME = "HCM"
DEFAULT_ENDPOINTS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
CATEGORY_CHOICES = ("all", "restaurant", "cafe", "fastfood", "bakery")
BBOXES = {
    "quan 1": "10.755,106.680,10.790,106.715",
    "quan 2": "10.745,106.720,10.825,106.800",
    "quan 3": "10.770,106.675,10.795,106.710",
    "quan 4": "10.745,106.695,10.775,106.730",
    "quan 5": "10.735,106.650,10.775,106.695",
    "quan 6": "10.725,106.625,10.755,106.670",
    "quan 7": "10.690,106.700,10.755,106.775",
    "quan 8": "10.690,106.650,10.750,106.735",
    "quan 10": "10.755,106.655,10.785,106.690",
    "quan 11": "10.745,106.635,10.775,106.675",
    "quan 12": "10.820,106.620,10.900,106.720",
    "binh thanh": "10.785,106.700,10.835,106.755",
    "phu nhuan": "10.785,106.660,10.815,106.705",
    "tan binh": "10.775,106.615,10.835,106.700",
    "tan phu": "10.765,106.605,10.820,106.670",
    "go vap": "10.805,106.635,10.875,106.720",
    "binh tan": "10.680,106.580,10.780,106.670",
    "thu duc": "10.780,106.760,10.950,106.900",
}
DEFAULT_BBOX = "10.33,106.35,11.15,107.05"


def normalize(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def http_json(url: str, method: str = "GET", payload: dict | bytes | None = None, timeout: int = 20) -> dict:
    body = None
    headers = {"User-Agent": APP_NAME, "Accept": "application/json"}
    if payload is not None:
        if method.upper() == "GET" and isinstance(payload, dict):
            separator = "&" if "?" in url else "?"
            url += separator + urlencode(payload)
        elif isinstance(payload, (bytes, bytearray)):
            body = bytes(payload)
            headers["Content-Type"] = "application/json"
        else:
            body = urlencode(payload).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = Request(url, data=body, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
        return json.loads(raw)


def http_text(url: str, timeout: int = 30) -> str:
    request = Request(url, headers={"User-Agent": APP_NAME, "Accept": "text/csv,*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def build_query(category: str, district: str) -> str:
    bbox = BBOXES.get(normalize(district), DEFAULT_BBOX)
    statements = {
        "all": [
            f'nwr["amenity"~"restaurant|cafe|fast_food|food_court|bar|pub"]["name"]({bbox});',
            f'nwr["shop"~"bakery|pastry|confectionery"]["name"]({bbox});',
        ],
        "restaurant": [f'nwr["amenity"="restaurant"]["name"]({bbox});'],
        "cafe": [f'nwr["amenity"="cafe"]["name"]({bbox});'],
        "fastfood": [f'nwr["amenity"="fast_food"]["name"]({bbox});'],
        "bakery": [f'nwr["shop"~"bakery|pastry|confectionery"]["name"]({bbox});'],
    }[category]
    return "[out:json][timeout:45];(" + "".join(statements) + ");out center tags;"


def fetch_overpass(query: str) -> tuple[dict, str]:
    errors: list[str] = []
    for endpoint in DEFAULT_ENDPOINTS:
        for method in ("POST", "GET"):
            try:
                print(f"Đang thử Overpass: {endpoint} ({method})", file=sys.stderr)
                return http_json(endpoint, method=method, payload={"data": query}, timeout=18), endpoint
            except Exception as error:
                errors.append(f"{endpoint} {method}: {error}")
                time.sleep(0.5)
    raise RuntimeError("Không kết nối được Overpass:\n" + "\n".join(errors))


def map_arcgis_category(raw_category: str, name: str) -> str:
    text = normalize(f"{raw_category} {name}")
    if any(word in text for word in ("bakery", "banh mi", "bread")):
        return "Bánh mì"
    if any(word in text for word in ("cafe", "coffee", "drink")):
        return "Quán nước"
    if any(word in text for word in ("fast", "burger", "pizza")):
        return "Fastfood"
    if any(word in text for word in ("rice", "com")):
        return "Cơm"
    return "Món khô"


def web_mercator_to_wgs84(geometry: dict | None) -> tuple[float, float] | None:
    if not geometry or geometry.get("x") is None or geometry.get("y") is None:
        return None
    x = float(geometry["x"])
    y = float(geometry["y"])
    longitude = x / 20037508.34 * 180
    latitude = y / 20037508.34 * 180
    latitude = 180 / 3.141592653589793 * (
        2 * __import__("math").atan(__import__("math").exp(latitude * 3.141592653589793 / 180))
        - 3.141592653589793 / 2
    )
    return latitude, longitude


def fetch_arcgis_places(
    district: str,
    category: str,
    allowed_types: list[str],
    allowed_districts: list[str],
    limit: int,
) -> tuple[list[dict], str]:
    base_url = "https://services.arcgis.com/EaQ3hSM51DBnlwMq/ArcGIS/rest/services/Food_in_HCM/FeatureServer/0/query"
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "resultRecordCount": "1000",
        "f": "json",
    }
    payload = http_json(base_url, method="GET", payload=params, timeout=25)
    candidates: list[dict] = []

    for feature in payload.get("features", []):
        attributes = feature.get("attributes") or {}
        keys = list(attributes)

        def read(aliases: tuple[str, ...]) -> str:
            normalized = {normalize(key): key for key in keys}
            for alias in aliases:
                key = normalized.get(normalize(alias))
                if key is not None and attributes.get(key) not in (None, ""):
                    return str(attributes[key]).strip()
            for key in keys:
                if any(normalize(alias) in normalize(key) for alias in aliases):
                    if attributes.get(key) not in (None, ""):
                        return str(attributes[key]).strip()
            return ""

        name = read(("name", "ten quan", "ten nha hang", "restaurant", "title"))
        if not name:
            continue
        raw_category = read(("category", "loai", "type", "cuisine", "food"))
        item_type = canonical_choice(map_arcgis_category(raw_category, name), allowed_types, "Món khô")
        item_district = read(("district", "quan", "huyen", "suburb")) or district
        if allowed_districts:
            district_match = next(
                (item for item in allowed_districts if normalize(item) == normalize(item_district)),
                "",
            )
            if not district_match:
                continue
            item_district = district_match

        coordinates = web_mercator_to_wgs84(feature.get("geometry"))
        street = read(("address", "dia chi", "street", "duong", "location")) or "Chưa rõ địa chỉ"
        map_url = ""
        if coordinates:
            latitude, longitude = coordinates
            map_url = f"https://www.google.com/maps/search/?api=1&query={latitude},{longitude}"
        object_id = read(("objectid", "fid", "id"))
        source = (
            "https://services.arcgis.com/EaQ3hSM51DBnlwMq/ArcGIS/rest/services/"
            "Food_in_HCM/FeatureServer/0/query?where="
            + __import__("urllib.parse", fromlist=["quote"]).quote(f"OBJECTID={object_id}")
            + "&outFields=*&f=pjson"
            if object_id
            else base_url
        )
        candidate = {
            "id": f"arcgis-{object_id or name}",
            "name": name,
            "food": raw_category or "Món ăn đang cập nhật",
            "type": item_type,
            "street": street,
            "district": item_district,
            "hours": read(("opening hours", "gio mo cua", "hours")),
            "price": "",
            "note": "Nguồn ArcGIS Food_in_HCM; cần xác minh tên, địa chỉ và giờ mở cửa.",
            "source": source,
            "mapUrl": map_url,
            "reason": "Đề xuất từ ArcGIS công khai; cần kiểm tra thực tế trước khi duyệt.",
            "duplicate": False,
        }
        if category != "all":
            wanted = normalize(category)
            detected = normalize(map_arcgis_category(raw_category, name))
            if (
                (wanted == "restaurant" and detected not in {"mon kho", "com"})
                or (wanted == "cafe" and detected != "quan nuoc")
                or (wanted == "fastfood" and detected != "fastfood")
                or (wanted == "bakery" and detected != "banh mi")
            ):
                continue
        candidates.append(candidate)

    return candidates[:limit], "ArcGIS Food_in_HCM"




def read_sheet_catalog() -> tuple[set[str], list[str], list[str]]:
    """Read public HCM data for duplicate and validation checks."""
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq"
        f"?tqx=out:csv&sheet={SHEET_NAME}"
    )
    try:
        rows = list(csv.reader(http_text(url).splitlines()))
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        print(f"Cảnh báo: không đọc được Google Sheet để kiểm tra trùng: {error}", file=sys.stderr)
        return set(), [], []

    if not rows:
        return set(), [], []

    existing: set[str] = set()
    types: list[str] = []
    districts: list[str] = []
    for row in rows[1:]:
        if len(row) < 6:
            continue
        key = restaurant_key({"name": row[1], "street": row[4], "district": row[5]})
        if key:
            existing.add(key)
        if row[3].strip() and row[3].strip() not in types:
            types.append(row[3].strip())
        if row[5].strip() and row[5].strip() not in districts:
            districts.append(row[5].strip())
    return existing, types, districts


def restaurant_key(item: dict) -> str:
    name = normalize(item.get("name"))
    street = normalize(item.get("street"))
    district = normalize(item.get("district"))
    if not name:
        return ""
    return "|".join((name, street, district))


def canonical_choice(value: str, allowed: list[str], fallback: str = "") -> str:
    if not allowed:
        return value.strip()
    wanted = normalize(value)
    for item in allowed:
        if normalize(item) == wanted:
            return item
    aliases = {
        "banh mi": ("banh mi", "banh"),
        "com": ("com", "rice"),
        "pho": ("pho", "noodle"),
        "quan nuoc": ("cafe", "coffee", "drink"),
        "fastfood": ("fast", "burger", "pizza"),
    }
    for key, terms in aliases.items():
        if key in wanted or any(term in wanted for term in terms):
            for item in allowed:
                if any(term in normalize(item) for term in terms):
                    return item
    if fallback and fallback in allowed:
        return fallback
    return allowed[0]


def map_type(tags: dict) -> str:
    amenity = normalize(tags.get("amenity"))
    shop = normalize(tags.get("shop"))
    cuisine = normalize(tags.get("cuisine"))
    if shop in {"bakery", "pastry", "confectionery"} or "banh mi" in cuisine:
        return "Bánh mì"
    if amenity == "cafe":
        return "Quán nước"
    if amenity == "fast food":
        return "Fastfood"
    if "rice" in cuisine or "com" in cuisine:
        return "Cơm"
    if amenity in {"bar", "pub"}:
        return "Nhậu nhẹt"
    return "Món khô"


def map_food(tags: dict) -> str:
    cuisine = str(tags.get("cuisine") or "").strip().lower()
    if not cuisine:
        return "Món ăn đang cập nhật"
    if "coffee" in cuisine or "cafe" in cuisine:
        return "Cà phê"
    if "vietnamese" in cuisine:
        return "Món Việt"
    if "rice" in cuisine or "com" in cuisine:
        return "Cơm"
    if "noodle" in cuisine or "pho" in cuisine:
        return "Món nước"
    if "pizza" in cuisine:
        return "Pizza"
    if "burger" in cuisine:
        return "Burger"
    return re.sub(r"[_;]+", " ", cuisine)


def map_element(element: dict, requested_district: str, allowed_types: list[str], allowed_districts: list[str]) -> dict | None:
    tags = element.get("tags") or {}
    name = str(tags.get("name:vi") or tags.get("name") or "").strip()
    if not name:
        return None

    position = (
        (element.get("lat"), element.get("lon"))
        if element.get("lat") is not None and element.get("lon") is not None
        else (
            (element.get("center", {}).get("lat"), element.get("center", {}).get("lon"))
            if element.get("center")
            else (None, None)
        )
    )
    if position[0] is None or position[1] is None:
        return None

    street = " ".join(
        part for part in (
            str(tags.get("addr:housenumber") or "").strip(),
            str(tags.get("addr:street") or "").strip(),
        ) if part
    )
    district = str(
        tags.get("addr:district")
        or tags.get("addr:city_district")
        or tags.get("addr:suburb")
        or requested_district
        or ""
    ).strip()
    if allowed_districts:
        district_match = next(
            (item for item in allowed_districts if normalize(item) == normalize(district)),
            "",
        )
        if not district_match:
            return None
        district = district_match

    item_type = canonical_choice(map_type(tags), allowed_types, "Món khô")
    object_path = f"{element.get('type', 'node')}/{element.get('id')}"
    latitude, longitude = position
    source = f"https://www.openstreetmap.org/{object_path}"
    map_url = (
        "https://www.google.com/maps/search/?api=1&query="
        f"{latitude},{longitude}"
    )
    cuisine = str(tags.get("cuisine") or "").strip()
    note_parts = [
        f"Tọa độ: {latitude}, {longitude}",
        f"Cuisine OSM: {cuisine}" if cuisine else "",
        "Cần xác minh tên, địa chỉ và giờ mở cửa.",
    ]
    return {
        "id": object_path,
        "name": name,
        "food": map_food(tags),
        "type": item_type,
        "street": street or "Chưa rõ địa chỉ",
        "district": district or requested_district,
        "hours": str(tags.get("opening_hours") or "").strip(),
        "price": "",
        "note": " • ".join(part for part in note_parts if part),
        "source": source,
        "mapUrl": map_url,
        "reason": "Đề xuất từ OpenStreetMap; cần kiểm tra thực tế trước khi duyệt.",
        "duplicate": False,
    }


def collect(args: argparse.Namespace) -> tuple[list[dict], str]:
    existing, allowed_types, allowed_districts = read_sheet_catalog()
    candidates: list[dict] = []
    endpoint = ""

    try:
        query = build_query(args.category, args.district)
        payload, endpoint = fetch_overpass(query)
        elements = payload.get("elements", [])
        for element in elements:
            item = map_element(element, args.district, allowed_types, allowed_districts)
            if item:
                candidates.append(item)
    except Exception as overpass_error:
        print(f"Overpass không dùng được, chuyển sang ArcGIS: {overpass_error}", file=sys.stderr)
        candidates, endpoint = fetch_arcgis_places(
            args.district,
            args.category,
            allowed_types,
            allowed_districts,
            args.limit,
        )

    seen: set[str] = set()
    unique: list[dict] = []
    for item in candidates:
        key = restaurant_key(item)
        if not key or key in seen:
            continue
        seen.add(key)
        item["duplicate"] = key in existing
        unique.append(item)

    unique.sort(key=lambda item: (item["duplicate"], normalize(item["name"])))
    return unique[: args.limit], endpoint


def write_outputs(candidates: list[dict], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "candidates.json"
    csv_path = output_dir / "candidates.csv"
    envelope = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(candidates),
        "candidates": candidates,
    }
    json_path.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
    fields = ["name", "food", "type", "street", "district", "hours", "price", "note", "source", "mapUrl", "duplicate"]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({field: item.get(field, "") for field in fields} for item in candidates)
    return json_path, csv_path


def push_to_apps_script(candidates: list[dict]) -> dict:
    url = os.environ.get("APPS_SCRIPT_URL", "").strip()
    token = os.environ.get("IMPORT_TOKEN", "").strip()
    if not url or not token:
        raise RuntimeError("Cần đặt APPS_SCRIPT_URL và IMPORT_TOKEN trong collector/.env trước khi dùng --push.")
    selected = [item for item in candidates if not item.get("duplicate")]
    if not selected:
        return {"added": 0, "skipped": len(candidates), "message": "Không có quán mới để gửi."}
    return http_json(
        url,
        method="POST",
        payload=json.dumps({"token": token, "candidates": selected}, ensure_ascii=False).encode("utf-8"),
        timeout=180,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Thu thập địa điểm ăn uống HCMC từ OpenStreetMap.")
    parser.add_argument("--district", default="", help="Ví dụ: Quận 2. Bỏ trống để tìm toàn vùng HCMC.")
    parser.add_argument("--category", choices=CATEGORY_CHOICES, default="all")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--output-dir", default=str(Path(__file__).parent / "out"))
    parser.add_argument("--push", action="store_true", help="Gửi quán mới vào hàng chờ Review qua Apps Script.")
    args = parser.parse_args()

    load_env(Path(__file__).parent / ".env")
    try:
        candidates, endpoint = collect(args)
    except Exception as error:
        print(f"Lỗi thu thập: {error}", file=sys.stderr)
        return 1

    json_path, csv_path = write_outputs(candidates, Path(args.output_dir))
    fresh = [item for item in candidates if not item.get("duplicate")]
    duplicates = len(candidates) - len(fresh)
    print(f"Nguồn: {endpoint}")
    print(f"Tìm thấy: {len(candidates)} | Quán mới: {len(fresh)} | Trùng: {duplicates}")
    print(f"Đã ghi: {json_path}")
    print(f"Đã ghi: {csv_path}")

    if args.push:
        try:
            result = push_to_apps_script(fresh)
        except Exception as error:
            print(f"Lỗi gửi Apps Script: {error}", file=sys.stderr)
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
