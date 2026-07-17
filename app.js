const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1LHQlScoOABMay4-faE4ECdX7LlcPaDQzlDJFYqKmiZ8/export?format=csv&gid=0";
const DATA_CACHE_KEY = "food-finder-data-v3";
const GEOCODE_CACHE_KEY = "food-finder-geocode-v1";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_GEOCODES_PER_REQUEST = 3;

const state = {
  allData: [],
  loaded: false,
  filters: {
    district: "",
    food: "",
    type: ""
  },
  deferredPrompt: null,
  location: null,
  locating: false,
  geocodeRun: 0
};

const distanceByRow = new WeakMap();
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function normalise(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;|]+|[\s,;|]+$/g, "")
    .trim();
}

function valueKey(value) {
  return normalise(value).toLocaleLowerCase("vi");
}

function getField(row, keys) {
  for (const key of keys) {
    const value = normalise(row?.[key]);
    if (value) return value;
  }
  return "";
}

function splitValues(value) {
  const cleaned = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");

  return cleaned
    .split(/[,;|\r\n]/)
    .map(normalise)
    .filter(Boolean);
}

function uniqueSorted(values) {
  const unique = new Map();

  values.forEach(rawValue => {
    const value = normalise(rawValue);
    if (!value) return;

    const key = valueKey(value);
    if (!unique.has(key) || value.length > unique.get(key).length) {
      unique.set(key, value);
    }
  });

  return [...unique.values()].sort((a, b) =>
    a.localeCompare(b, "vi", { sensitivity: "base" })
  );
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function setStatus(message, tone = "") {
  const status = $("status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function showError(message) {
  const result = $("result");
  result.innerHTML =
    '<div class="empty-state error-state">' +
      '<div class="empty-icon" aria-hidden="true">!</div>' +
      "<h3>Chưa thể tải dữ liệu</h3>" +
      "<p>" + escapeHtml(message) + "</p>" +
      '<button class="secondary-button" id="retryButton" type="button">Thử lại</button>' +
    "</div>";

  $("retryButton")?.addEventListener("click", loadData);
}

function saveCachedCsv(csv) {
  try {
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      csv
    }));
  } catch (error) {
    console.warn("Không thể lưu dữ liệu offline:", error);
  }
}

function getCachedCsv() {
  try {
    const cached = JSON.parse(localStorage.getItem(DATA_CACHE_KEY) || "null");
    return cached?.csv || "";
  } catch (error) {
    return "";
  }
}

function parseCsv(csv) {
  if (!window.Papa) {
    throw new Error("Thư viện đọc dữ liệu chưa sẵn sàng.");
  }

  const parsed = window.Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: header => normalise(header)
  });

  if (parsed.errors?.length && !parsed.data?.length) {
    throw new Error("Dữ liệu món ăn không đúng định dạng.");
  }

  const rows = parsed.data.filter(row =>
    getField(row, ["Quận", "Quan"]) ||
    getField(row, ["Tên quán", "Ten quan", "Quán"])
  );

  if (!rows.length) {
    throw new Error("Chưa có dữ liệu món ăn hợp lệ.");
  }

  state.allData = rows;
  state.loaded = true;
  updateFilterOptions();
  render();
}

async function fetchCsv() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(SHEET_URL, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Máy chủ dữ liệu đang tạm thời không phản hồi.");
    }

    const csv = await response.text();
    if (!csv.trim()) throw new Error("Nguồn dữ liệu đang trống.");

    saveCachedCsv(csv);
    return csv;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadData() {
  const loadingState = $("loadingState");
  if (loadingState) loadingState.hidden = false;
  setStatus("Đang cập nhật danh sách món ngon…", "loading");

  try {
    const csv = await fetchCsv();
    parseCsv(csv);
    setStatus(
      window.navigator.onLine
        ? "Dữ liệu đã được cập nhật."
        : "Đang dùng dữ liệu đã lưu trên máy.",
      window.navigator.onLine ? "success" : "offline"
    );

    if (state.location) await updateDistances();
  } catch (error) {
    const cachedCsv = getCachedCsv();

    if (cachedCsv) {
      try {
        parseCsv(cachedCsv);
        setStatus("Mất kết nối — đang dùng dữ liệu gần nhất đã lưu.", "offline");
        return;
      } catch (cachedError) {
        console.warn("Dữ liệu offline không hợp lệ:", cachedError);
      }
    }

    setStatus("Không thể kết nối nguồn dữ liệu.", "error");
    showError(error.name === "AbortError"
      ? "Kết nối mất nhiều thời gian hơn dự kiến."
      : error.message || "Vui lòng thử lại sau.");
  }
}

function getRowValues(row, filterName) {
  if (filterName === "district") {
    return [getField(row, ["Quận", "Quan"])];
  }

  if (filterName === "food") {
    return splitValues(getField(row, ["Tên món", "Ten mon", "Món ăn"]));
  }

  return splitValues(getField(row, [
    "Phân loại món",
    "Phan loai mon",
    "Loại món",
    "Loai mon"
  ]));
}

function rowMatchesValue(row, filterName, selectedValue) {
  if (!selectedValue) return true;

  const selectedKey = valueKey(selectedValue);
  return getRowValues(row, filterName)
    .some(value => valueKey(value) === selectedKey);
}

function rowMatchesOtherFilters(row, excludedFilter) {
  return Object.entries(state.filters).every(([filterName, selectedValue]) =>
    filterName === excludedFilter ||
    !selectedValue ||
    rowMatchesValue(row, filterName, selectedValue)
  );
}

function getOptionsFor(filterName) {
  return uniqueSorted(
    state.allData
      .filter(row => rowMatchesOtherFilters(row, filterName))
      .flatMap(row => getRowValues(row, filterName))
  );
}

function setSelectOptions(select, values, placeholder, selectedValue = "") {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(new Option(placeholder, ""));

  const sortedValues = uniqueSorted(values);
  for (const value of sortedValues) {
    fragment.appendChild(new Option(value, value));
  }

  select.replaceChildren(fragment);
  select.value = sortedValues.some(value => valueKey(value) === valueKey(selectedValue))
    ? selectedValue
    : "";
}

function updateFilterOptions() {
  const selects = {
    district: $("districtSelect"),
    food: $("foodSelect"),
    type: $("typeSelect")
  };

  if (!state.loaded) return;

  // Reconcile invalid combinations while allowing any field to start the search.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const filterName of Object.keys(state.filters)) {
      const options = getOptionsFor(filterName);
      const current = state.filters[filterName];

      if (current && !options.some(value => valueKey(value) === valueKey(current))) {
        state.filters[filterName] = "";
      }
    }
  }

  setSelectOptions(
    selects.district,
    getOptionsFor("district"),
    "Tất cả quận",
    state.filters.district
  );
  setSelectOptions(
    selects.food,
    getOptionsFor("food"),
    "Tất cả món",
    state.filters.food
  );
  setSelectOptions(
    selects.type,
    getOptionsFor("type"),
    "Tất cả loại món",
    state.filters.type
  );

  selects.district.disabled = false;
  selects.food.disabled = false;
  selects.type.disabled = false;
}

function getFilteredRows() {
  return state.allData.filter(row =>
    Object.entries(state.filters).every(([filterName, selectedValue]) =>
      !selectedValue || rowMatchesValue(row, filterName, selectedValue)
    )
  );
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function getRowAddress(row) {
  const fullAddress = getField(row, [
    "Địa chỉ đầy đủ",
    "Dia chi day du",
    "Địa chỉ quán",
    "Dia chi quan",
    "Địa chỉ",
    "Dia chi"
  ]);

  if (fullAddress) {
    return fullAddress;
  }

  const street = getField(row, [
    "Tên đường",
    "Ten duong",
    "Đường",
    "Duong"
  ]);
  const district = getField(row, ["Quận", "Quan"]);

  return [street, district, "Hồ Chí Minh, Việt Nam"]
    .filter(Boolean)
    .join(", ");
}

function parseCoordinate(value, min, max) {
  const number = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function getRowCoordinates(row) {
  const latitude = parseCoordinate(getField(row, [
    "Vĩ độ", "Vi do", "Latitude", "Lat", "lat"
  ]), -90, 90);
  const longitude = parseCoordinate(getField(row, [
    "Kinh độ", "Kinh do", "Longitude", "Lng", "Lon", "lng", "lon"
  ]), -180, 180);

  return latitude !== null && longitude !== null
    ? { latitude, longitude }
    : null;
}

function getDirectMapUrl(row) {
  const directUrl = getField(row, [
    "Google Maps URL",
    "Google Map URL",
    "Google Maps",
    "Google Map",
    "Link Google Maps",
    "Link Google Map",
    "Đường dẫn Google Maps",
    "Duong dan Google Maps",
    "Maps URL",
    "Maps"
  ]);

  const safeUrl = safeExternalUrl(directUrl);
  if (!safeUrl) return "";

  const url = new URL(safeUrl);
  const hostname = url.hostname.toLowerCase();
  const isGoogleMaps =
    (hostname === "google.com" || hostname === "www.google.com") &&
    url.pathname.toLowerCase().startsWith("/maps");
  const isShortMapsLink =
    hostname === "maps.app.goo.gl" ||
    (hostname === "goo.gl" && url.pathname.toLowerCase().startsWith("/maps"));

  return isGoogleMaps || isShortMapsLink ? safeUrl : "";
}
function getMapSearchQuery(row) {
  const restaurant = getField(row, [
    "Tên quán",
    "Ten quan",
    "Quán",
    "Tên nhà hàng",
    "Ten nha hang"
  ]);
  const fullAddress = getField(row, [
    "Địa chỉ đầy đủ",
    "Dia chi day du",
    "Địa chỉ quán",
    "Dia chi quan"
  ]);
  const district = getField(row, ["Quận", "Quan"]);

  // A verified full address is useful; a street-only value can mislead Maps.
  return fullAddress
    ? [restaurant, fullAddress].filter(Boolean).join(", ")
    : [restaurant, district, "Hồ Chí Minh"].filter(Boolean).join(", ");
}

function getRowMapUrl(row) {
  const directUrl = getDirectMapUrl(row);
  if (directUrl) return directUrl;

  const coordinates = getRowCoordinates(row);
  if (coordinates) {
    return "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(coordinates.latitude + "," + coordinates.longitude);
  }

  const searchQuery = getMapSearchQuery(row);
  return searchQuery
    ? "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(searchQuery)
    : "";
}

function getMapLinkLabel(row) {
  if (getDirectMapUrl(row) || getRowCoordinates(row)) {
    return "Mở đúng vị trí trên Google Maps";
  }
  return "Tìm quán trên Google Maps";
}

function getRowImage(row) {
  return safeExternalUrl(getField(row, [
    "Ảnh quán",
    "Anh quan",
    "Photo URL",
    "Image URL",
    "Ảnh URL",
    "URL ảnh",
    "Ảnh",
    "Hình ảnh",
    "Hinh anh",
    "Image",
    "Photo"
  ]));
}

function getIllustrationProfile(row) {
  const category = valueKey(getField(row, [
    "Phân loại món",
    "Phan loai mon",
    "Loại món",
    "Loai mon"
  ]));
  const food = valueKey(getField(row, [
    "Tên món",
    "Ten mon",
    "Món ăn"
  ]));

  if (category.includes("bánh mì") || food.includes("bánh mì")) {
    return { label: "BÁNH MÌ", from: "#f97316", to: "#facc15" };
  }
  if (category.includes("cơm") || food.includes("cơm tấm")) {
    return { label: "CƠM TẤM", from: "#0f766e", to: "#22c55e" };
  }
  if (category.includes("lẩu")) {
    return { label: "LẨU", from: "#dc2626", to: "#fb923c" };
  }
  if (category.includes("món nước")) {
    return { label: "MÓN NƯỚC", from: "#7c3aed", to: "#ec4899" };
  }
  if (category.includes("ăn vặt")) {
    return { label: "ĂN VẶT", from: "#db2777", to: "#f97316" };
  }
  if (category.includes("quán nước")) {
    return { label: "ĐỒ UỐNG", from: "#0369a1", to: "#22d3ee" };
  }
  if (category.includes("món khô")) {
    return { label: "MÓN NGON", from: "#b45309", to: "#f59e0b" };
  }

  return { label: "ĂN NGON", from: "#ea580c", to: "#fbbf24" };
}

function escapeSvgText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  }[character]));
}

function getIllustratedImageUrl(row) {
  // Dùng minh hoạ SVG nội tuyến để ảnh luôn đúng nhóm món và vẫn hiển thị khi offline.
  return getFallbackIllustration(row);
}

function getFallbackIllustration(row) {
  const profile = getIllustrationProfile(row);
  const category = valueKey(getField(row, [
    "Phân loại món",
    "Phan loai mon",
    "Loại món",
    "Loai mon"
  ]));
  const food = valueKey(getField(row, [
    "Tên món",
    "Ten mon",
    "Món ăn"
  ]));

  let foodArt = "";

  if (category.includes("bánh mì") || food.includes("bánh mì")) {
    foodArt =
      '<ellipse cx="400" cy="350" rx="270" ry="54" fill="#fff" opacity=".95"/>' +
      '<path d="M190 292c0-43 35-78 78-78h264c43 0 78 35 78 78v22H190z" fill="#d97706"/>' +
      '<path d="M190 292c0-43 35-78 78-78h264c43 0 78 35 78 78v15H190z" fill="#f59e0b"/>' +
      '<path d="M205 307h590v31H205z" fill="#65a30d"/>' +
      '<path d="M205 338h590v22H205z" fill="#dc2626"/>' +
      '<path d="M212 360h576c-16 30-42 49-77 49H289c-35 0-61-19-77-49z" fill="#b45309"/>' +
      '<path d="M282 239l-9-17M352 233l-5-20M426 233l4-20M499 233l10-18M568 242l14-15" stroke="#fde68a" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="M250 323c21-12 38-12 59 0M382 323c21-12 38-12 59 0M514 323c21-12 38-12 59 0" fill="none" stroke="#bbf7d0" stroke-width="9" stroke-linecap="round"/>' +
      '<circle cx="680" cy="325" r="10" fill="#fef08a"/>' +
      '<circle cx="710" cy="348" r="8" fill="#fef08a"/>';
  } else if (category.includes("cơm") || food.includes("cơm tấm")) {
    foodArt =
      '<ellipse cx="400" cy="358" rx="270" ry="58" fill="#fff" opacity=".96"/>' +
      '<ellipse cx="400" cy="337" rx="226" ry="65" fill="#f8fafc"/>' +
      '<path d="M245 325c22-100 80-128 155-128s133 28 155 128c-44 27-93 40-155 40s-111-13-155-40z" fill="#fff7ed"/>' +
      '<path d="M278 302c23-31 48-42 71-51M316 330c18-35 45-55 68-68M365 337c11-44 31-70 49-87M424 337c4-42 20-69 38-88M480 327c-4-37-1-61 14-82M529 310c-13-31-14-49-6-68" stroke="#d6d3d1" stroke-width="8" stroke-linecap="round"/>' +
      '<path d="M293 294c-21-23-10-50 18-59 27-9 62 1 75 25 13 24-9 55-41 62-22 5-42-5-52-28z" fill="#f1f5f9"/>' +
      '<circle cx="350" cy="272" r="21" fill="#facc15"/>' +
      '<path d="M486 306c24-76 83-96 139-57 33 23 40 62 20 91-24 34-73 45-119 24z" fill="#7c2d12"/>' +
      '<path d="M493 294c33-12 77-4 129 20M501 319c35-11 72-5 111 16M524 346c29-8 57-4 84 10" fill="none" stroke="#f59e0b" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M580 242c19-20 38-18 55 4M602 258c19-18 37-16 52 5M621 277c17-14 32-12 45 5" fill="none" stroke="#22c55e" stroke-width="12" stroke-linecap="round"/>' +
      '<path d="M220 345c36-18 66-16 93 4M210 369c33-15 64-12 91 6" fill="none" stroke="#84cc16" stroke-width="13" stroke-linecap="round"/>';
  } else if (category.includes("lẩu")) {
    foodArt =
      '<ellipse cx="400" cy="360" rx="248" ry="52" fill="#fff" opacity=".95"/>' +
      '<path d="M210 270h380v75c0 64-82 92-190 92s-190-28-190-92z" fill="#991b1b"/>' +
      '<ellipse cx="400" cy="270" rx="190" ry="55" fill="#ef4444"/>' +
      '<path d="M285 263c44-30 83 17 119-13 40-34 74 22 113-6 31-23 54 5 69 19" fill="none" stroke="#fef3c7" stroke-width="18" stroke-linecap="round"/>' +
      '<path d="M310 190c-25-48 20-63-5-104M400 186c-18-54 27-70 1-113M489 191c-4-51 44-65 18-106" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".8"/>';
  } else if (category.includes("món nước")) {
    foodArt =
      '<ellipse cx="400" cy="360" rx="250" ry="54" fill="#fff" opacity=".95"/>' +
      '<path d="M220 270c14 120 71 151 180 151s166-31 180-151z" fill="#f8fafc"/>' +
      '<ellipse cx="400" cy="270" rx="180" ry="52" fill="#fbbf24"/>' +
      '<path d="M278 274c47-41 71 37 116-7 44-43 67 37 113-8 29-29 48 1 66 15" fill="none" stroke="#fef3c7" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M302 217l-52-98M362 212l-20-107M458 212l25-107M520 222l58-99" stroke="#fef3c7" stroke-width="12" stroke-linecap="round"/>';
  } else if (category.includes("quán nước")) {
    foodArt =
      '<ellipse cx="400" cy="390" rx="180" ry="35" fill="#fff" opacity=".9"/>' +
      '<path d="M294 170h212l-19 208c-3 30-26 48-87 48s-84-18-87-48z" fill="#e0f2fe"/>' +
      '<path d="M307 235h186l-7 143c-2 26-22 36-86 36s-84-10-86-36z" fill="#38bdf8"/>' +
      '<path d="M335 170l-28-75M430 170l38-81" stroke="#fff" stroke-width="14" stroke-linecap="round"/>' +
      '<circle cx="400" cy="285" r="27" fill="#fff" opacity=".65"/>';
  } else {
    foodArt =
      '<ellipse cx="400" cy="350" rx="230" ry="52" fill="#fff" opacity=".95"/>' +
      '<path d="M220 300c20 110 79 145 180 145s160-35 180-145z" fill="#fff"/>' +
      '<ellipse cx="400" cy="300" rx="180" ry="48" fill="#fde68a"/>' +
      '<path d="M285 296c35-58 67 15 110-27 39-38 67 32 109-12 26-26 48 4 64 19" fill="none" stroke="#f97316" stroke-width="22" stroke-linecap="round"/>';
  }

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">' +
      '<defs>' +
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + profile.from + '"/>' +
          '<stop offset="100%" stop-color="' + profile.to + '"/>' +
        '</linearGradient>' +
        '<filter id="shadow"><feDropShadow dx="0" dy="14" stdDeviation="12" flood-opacity=".22"/></filter>' +
      '</defs>' +
      '<rect width="800" height="500" fill="url(#bg)"/>' +
      '<circle cx="690" cy="70" r="150" fill="#ffffff" opacity=".13"/>' +
      '<circle cx="90" cy="440" r="180" fill="#ffffff" opacity=".1"/>' +
      '<g filter="url(#shadow)">' + foodArt + '</g>' +
      '<text x="400" y="92" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="34" font-weight="700" letter-spacing="4">' +
        escapeSvgText(profile.label) +
      '</text>' +
      '<text x="400" y="455" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="18" opacity=".86">' +
        'ẢNH MINH HOẠ • ĂN SẬP SÀI GÒN' +
      '</text>' +
    '</svg>';

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function haversineKm(from, to) {
  const toRadians = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distanceKm) {
  return distanceKm < 1
    ? Math.round(distanceKm * 1000) + " m"
    : distanceKm.toFixed(1) + " km";
}

function readGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function writeGeocodeCache(cache) {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("Không thể lưu vị trí quán:", error);
  }
}

async function geocodeAddress(address) {
  const key = valueKey(address);
  const cache = readGeocodeCache();

  if (cache[key]) return cache[key];

  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&q=" +
      encodeURIComponent(address);
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) return null;
    const results = await response.json();
    const first = results?.[0];
    const coordinates = first
      ? {
          latitude: Number.parseFloat(first.lat),
          longitude: Number.parseFloat(first.lon)
        }
      : null;

    if (!coordinates ||
        !Number.isFinite(coordinates.latitude) ||
        !Number.isFinite(coordinates.longitude)) {
      return null;
    }

    cache[key] = coordinates;
    writeGeocodeCache(cache);
    return coordinates;
  } catch (error) {
    console.warn("Không thể xác định vị trí quán:", error);
    return null;
  }
}

async function updateDistances() {
  if (!state.location) return;

  const runId = ++state.geocodeRun;
  const rows = getFilteredRows();
  const unresolved = [];
  let directCount = 0;

  rows.forEach(row => {
    const coordinates = getRowCoordinates(row);
    if (coordinates) {
      distanceByRow.set(row, haversineKm(state.location, coordinates));
      directCount += 1;
    } else if (getRowAddress(row)) {
      unresolved.push(row);
    }
  });

  // Render immediately. Geocoding must not block the location button or the UI.
  rows.sort((a, b) =>
    (distanceByRow.get(a) ?? Number.POSITIVE_INFINITY) -
    (distanceByRow.get(b) ?? Number.POSITIVE_INFINITY)
  );
  setStatus(
    directCount
      ? "Đã bật vị trí — đang hiển thị quán gần bạn."
      : "Đã bật vị trí — đang cập nhật khoảng cách ở nền.",
    directCount ? "success" : "loading"
  );
  render();

  if (unresolved.length) {
    void geocodeRowsInBackground(
      unresolved.slice(0, MAX_GEOCODES_PER_REQUEST),
      runId
    );
  }
}

async function geocodeRowsInBackground(rows, runId) {
  let geocodedCount = 0;

  for (const row of rows) {
    if (!state.location || runId !== state.geocodeRun) return;

    const coordinates = await geocodeAddress(getRowAddress(row));
    if (coordinates) {
      distanceByRow.set(row, haversineKm(state.location, coordinates));
      geocodedCount += 1;
      render();
    }

    // Keep the public geocoding service in the background and respect its rate limit.
    await new Promise(resolve => window.setTimeout(resolve, 1100));
  }

  if (geocodedCount && runId === state.geocodeRun) {
    setStatus("Đã cập nhật khoảng cách và ưu tiên quán gần bạn nhất.", "success");
    render();
  }
}

function renderCard(row) {
  const restaurant = getField(row, ["Tên quán", "Ten quan", "Quán"]) || "Quán ngon ẩn danh";
  const food = getField(row, ["Tên món", "Ten mon", "Món ăn"]);
  const type = getField(row, [
    "Phân loại món",
    "Phan loai mon",
    "Loại món",
    "Loai mon"
  ]);
  const address = getField(row, [
    "Địa chỉ", "Dia chi", "Tên đường", "Ten duong", "Đường"
  ]);
  const district = getField(row, ["Quận", "Quan"]);
  const hours = getField(row, ["Giờ mở cửa", "Gio mo cua"]);
  const price = getField(row, ["Khoảng giá", "Khoang gia", "Giá"]);
  const note = getField(row, ["Note", "Ghi chú", "Ghi chu"]);
  const actualImage = getRowImage(row);
  const image = actualImage || getIllustratedImageUrl(row);
  const isIllustration = !actualImage;
  const mapUrl = getRowMapUrl(row);
  const mapLinkLabel = getMapLinkLabel(row);
  const distance = distanceByRow.get(row);

  const imageHtml =
    '<img class="food-image" src="' + escapeHtml(image) +
    '" alt="' + escapeHtml(restaurant) + '" loading="lazy" />';

  const details = [
    food ? "<div><dt>Món</dt><dd>" + escapeHtml(food) + "</dd></div>" : "",
    hours ? "<div><dt>Giờ mở</dt><dd>" + escapeHtml(hours) + "</dd></div>" : "",
    price ? "<div><dt>Khoảng giá</dt><dd>" + escapeHtml(price) + "</dd></div>" : ""
  ].join("");

  return (
    '<article class="result-item">' +
      '<div class="food-visual">' + imageHtml +
        '<span class="category-pill">' + escapeHtml(type || "Địa điểm ăn uống") + "</span>" +
        (isIllustration
          ? '<span class="image-source-badge">Ảnh minh hoạ</span>'
          : "") +
        (typeof distance === "number"
          ? '<span class="distance-badge">⌖ ' + formatDistance(distance) + "</span>"
          : "") +
      "</div>" +
      '<div class="result-content">' +
        "<h3>" + escapeHtml(restaurant) + "</h3>" +
        (details ? '<dl class="meta-list">' + details + "</dl>" : "") +
        (mapUrl
          ? '<a class="map-link" href="' + escapeHtml(mapUrl) +
            '" target="_blank" rel="noopener noreferrer">⌖ ' +
            escapeHtml(mapLinkLabel) + "</a>"
          : "") +
        (note ? '<p class="card-note">' + escapeHtml(note) + "</p>" : "") +
      "</div>" +
    "</article>"
  );
}

function render() {
  const result = $("result");
  if (!state.loaded) return;

  const hasFilter = Object.values(state.filters).some(Boolean);
  if (!hasFilter && !state.location) {
    result.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon" aria-hidden="true">⌖</div>' +
        "<h3>Bắt đầu khám phá</h3>" +
        "<p>Chọn quận, món ăn hoặc phân loại để tìm quán phù hợp.</p>" +
      "</div>";
    return;
  }

  const rows = getFilteredRows();
  if (state.location) {
    rows.sort((a, b) =>
      (distanceByRow.get(a) ?? Number.POSITIVE_INFINITY) -
      (distanceByRow.get(b) ?? Number.POSITIVE_INFINITY)
    );
  }

  if (!rows.length) {
    result.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon" aria-hidden="true">⌕</div>' +
        "<h3>Chưa tìm thấy món phù hợp</h3>" +
        "<p>Hãy thử đổi quận, món ăn hoặc phân loại khác nhé.</p>" +
      "</div>";
    return;
  }

  result.innerHTML = rows.map(renderCard).join("");
}

function handleFilterChange(event) {
  const filterName = {
    districtSelect: "district",
    foodSelect: "food",
    typeSelect: "type"
  }[event.target.id];

  if (!filterName) return;
  state.filters[filterName] = normalise(event.target.value);
  updateFilterOptions();
  render();

  if (state.location) updateDistances();
}

function setLocationButtonState(isLocating) {
  const button = $("locationButton");
  if (!button) return;
  button.disabled = isLocating;
  button.classList.toggle("is-active", Boolean(state.location));
  button.innerHTML = isLocating
    ? '<span aria-hidden="true">⌖</span> Đang định vị…'
    : '<span aria-hidden="true">⌖</span> Quán gần tôi';
}

function requestLocation() {
  if (state.locating) return;

  if (!window.isSecureContext || !navigator.geolocation) {
    setStatus("Định vị cần được mở bằng HTTPS trên Safari hoặc màn hình chính.", "error");
    return;
  }

  if (!state.loaded) {
    setStatus("Đang tải dữ liệu, vui lòng thử lại sau một chút.", "loading");
    return;
  }

  state.locating = true;
  setLocationButtonState(true);
  setStatus("Đang xin quyền vị trí và tìm quán gần bạn…", "loading");

  navigator.geolocation.getCurrentPosition(
    async position => {
      state.location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      state.locating = false;
      setLocationButtonState(false);
      updateDistances();
    },
    error => {
      state.locating = false;
      setLocationButtonState(false);

      const message = error.code === error.PERMISSION_DENIED
        ? "Bạn chưa cho phép định vị. Hãy bật Location cho Safari trong Cài đặt iPhone."
        : "Không lấy được vị trí hiện tại. Vui lòng thử lại.";
      setStatus(message, "error");
    },
    {
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 600000
    }
  );
}

function showInstallGuide() {
  const status = $("status");
  status.dataset.tone = "info";
  status.innerHTML =
    "<strong>Để cài nhanh trên iPhone:</strong> chạm nút Chia sẻ " +
    "trong Safari → chọn <strong>Thêm vào Màn hình chính</strong> → bấm Thêm.";
}

async function handleInstallClick() {
  if (state.deferredPrompt) {
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    $("installButton").hidden = true;
    return;
  }

  if (isIos()) showInstallGuide();
}

function setupInstallExperience() {
  const button = $("installButton");
  if (!button || isStandalone()) return;

  if (isIos()) {
    button.hidden = false;
    button.addEventListener("click", handleInstallClick);
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredPrompt = event;
    button.hidden = false;
    button.addEventListener("click", handleInstallClick, { once: true });
  });

  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    state.deferredPrompt = null;
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
      updateViaCache: "none"
    });

    await registration.update();

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing || sessionStorage.getItem("pwa-updated")) return;
      refreshing = true;
      sessionStorage.setItem("pwa-updated", "1");
      window.location.reload();
    });
  } catch (error) {
    console.warn("PWA chưa thể khởi động:", error);
  }
}

function init() {
  $("districtSelect")?.addEventListener("change", handleFilterChange);
  $("foodSelect")?.addEventListener("change", handleFilterChange);
  $("typeSelect")?.addEventListener("change", handleFilterChange);
  $("locationButton")?.addEventListener("click", requestLocation);
  setupInstallExperience();
  registerServiceWorker();
  loadData();
}

window.addEventListener("online", () => {
  if (state.loaded) loadData();
});

document.addEventListener("DOMContentLoaded", init);
