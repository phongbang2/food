const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1LHQlScoOABMay4-faE4ECdX7LlcPaDQzlDJFYqKmiZ8/export?format=csv&gid=0";
const DATA_CACHE_KEY = "food-finder-data-v3";
const GEOCODE_CACHE_KEY = "food-finder-geocode-v1";
const REQUEST_TIMEOUT_MS = 12000;
const MAX_GEOCODES_PER_REQUEST = 3;
const MAX_VISIBLE_RESULTS = 12;

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
  geocodeRun: 0,
  showAll: false
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

function updateResultSummary(count, total = state.allData.length, isLimited = false) {
  const countElement = $("resultCount");
  const titleElement = $("resultsTitle");

  if (countElement) {
    countElement.textContent = isLimited
      ? count + "/" + total + " quán • hãy lọc thêm"
      : count + " quán";
  }

  if (titleElement) {
    titleElement.textContent = state.location
      ? "Quán gần bạn"
      : "Quán ngon gần đây";
  }
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
      '<g transform="translate(0 15) rotate(-5 400 290)">' +
        '<path d="M175 286c0-46 37-83 83-83h284c46 0 83 37 83 83v19H175z" fill="#f59e0b"/>' +
        '<path d="M174 297h452v25H174z" fill="#65a30d"/>' +
        '<path d="M174 322h452v19H174z" fill="#ef4444"/>' +
        '<path d="M188 341h424c-16 36-47 55-91 55H279c-44 0-75-19-91-55z" fill="#b45309"/>' +
        '<path d="M252 226l-8-18M326 218l-5-20M402 218l4-20M478 222l10-18M548 238l14-16" stroke="#fde68a" stroke-width="11" stroke-linecap="round"/>' +
        '<path d="M235 315c26-15 48-15 73 0M364 315c26-15 48-15 73 0M493 315c26-15 48-15 73 0" fill="none" stroke="#bbf7d0" stroke-width="10" stroke-linecap="round"/>' +
        '<circle cx="612" cy="317" r="11" fill="#fef08a"/><circle cx="642" cy="339" r="8" fill="#fef08a"/>' +
      '</g>';
  } else if (category.includes("cơm") || food.includes("cơm tấm")) {
    foodArt =
      '<g transform="translate(0 8)">' +
        '<ellipse cx="400" cy="356" rx="220" ry="42" fill="#e7e5e4"/>' +
        '<path d="M218 284c13 99 70 139 182 139s169-40 182-139z" fill="#fffaf3"/>' +
        '<ellipse cx="400" cy="284" rx="182" ry="56" fill="#fff7ed"/>' +
        '<path d="M286 287c19-42 46-60 73-73M337 306c16-57 40-86 62-104M397 310c6-60 24-91 42-112M456 308c0-50 17-79 37-103" stroke="#d6d3d1" stroke-width="10" stroke-linecap="round"/>' +
        '<path d="M478 293c27-60 89-71 132-34 34 29 30 82-7 109-44 31-104 17-125-18z" fill="#7c2d12"/>' +
        '<path d="M496 291c38-15 72-6 106 14M491 319c38-13 73-5 108 16M507 347c28-8 58-3 82 10" fill="none" stroke="#f59e0b" stroke-width="10" stroke-linecap="round"/>' +
        '<circle cx="316" cy="257" r="25" fill="#facc15"/>' +
        '<path d="M244 320c35-20 65-18 91 3M235 348c33-16 63-14 90 5" fill="none" stroke="#84cc16" stroke-width="14" stroke-linecap="round"/>' +
      '</g>';
  } else if (category.includes("lẩu")) {
    foodArt =
      '<g transform="translate(0 8)">' +
        '<path d="M213 282h374v61c0 70-80 107-187 107s-187-37-187-107z" fill="#991b1b"/>' +
        '<ellipse cx="400" cy="282" rx="187" ry="58" fill="#ef4444"/>' +
        '<path d="M288 276c36-35 69 18 106-17 38-35 72 24 111-8 31-26 57 6 76 20" fill="none" stroke="#fef3c7" stroke-width="17" stroke-linecap="round"/>' +
        '<path d="M310 216c-24-45 18-62-7-104M400 211c-18-50 26-68 2-112M490 218c-4-47 39-63 17-105" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".82"/>' +
        '<circle cx="284" cy="278" r="13" fill="#facc15"/><circle cx="532" cy="266" r="12" fill="#22c55e"/>' +
      '</g>';
  } else if (category.includes("quán nước") || category.includes("cà phê") || food.includes("trà") || food.includes("cà phê")) {
    foodArt =
      '<g transform="translate(0 4)">' +
        '<path d="M282 205h236l-18 177c-4 35-35 54-100 54s-96-19-100-54z" fill="#f8fafc"/>' +
        '<path d="M297 259h206l-9 119c-2 27-25 39-94 39s-92-12-94-39z" fill="#38bdf8"/>' +
        '<path d="M518 244h34c40 0 57 28 48 60-8 28-30 41-70 37" fill="none" stroke="#f8fafc" stroke-width="18"/>' +
        '<path d="M336 203l-31-82M430 203l-4-94M503 205l42-83" stroke="#fef3c7" stroke-width="12" stroke-linecap="round"/>' +
        '<circle cx="397" cy="313" r="29" fill="#fff" opacity=".66"/>' +
        '<circle cx="350" cy="355" r="8" fill="#075985"/><circle cx="397" cy="369" r="8" fill="#075985"/><circle cx="444" cy="355" r="8" fill="#075985"/>' +
      '</g>';
  } else if (category.includes("ăn vặt")) {
    foodArt =
      '<g transform="translate(0 6)">' +
        '<ellipse cx="400" cy="356" rx="210" ry="42" fill="#e7e5e4"/>' +
        '<path d="M252 336l116-125M348 350l117-148M443 346l103-116" stroke="#92400e" stroke-width="14" stroke-linecap="round"/>' +
        '<path d="M227 332c33-32 58-26 79 9 18 29 42 31 70 4 28-27 52-26 75 6 20 28 44 28 72 0 27-28 53-29 83-1" fill="none" stroke="#fb7185" stroke-width="38" stroke-linecap="round"/>' +
        '<circle cx="278" cy="284" r="18" fill="#facc15"/><circle cx="384" cy="260" r="18" fill="#22c55e"/><circle cx="491" cy="277" r="18" fill="#f97316"/>' +
      '</g>';
  } else {
    foodArt =
      '<g transform="translate(0 8)">' +
        '<ellipse cx="400" cy="356" rx="220" ry="42" fill="#e7e5e4"/>' +
        '<path d="M220 285c13 101 72 141 180 141s167-40 180-141z" fill="#fffaf3"/>' +
        '<ellipse cx="400" cy="285" rx="180" ry="54" fill="#fde68a"/>' +
        '<path d="M291 287c34-52 68 20 111-24 41-42 71 35 112-12 27-30 51 4 66 21" fill="none" stroke="#f97316" stroke-width="22" stroke-linecap="round"/>' +
        '<path d="M285 214l-37-91M356 207l-14-99M452 208l22-102M523 219l55-97" stroke="#fef3c7" stroke-width="12" stroke-linecap="round"/>' +
      '</g>';
  }

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">' +
      '<defs>' +
        '<linearGradient id="foodBg" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="' + profile.from + '"/>' +
          '<stop offset="100%" stop-color="' + profile.to + '"/>' +
        '</linearGradient>' +
        '<filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">' +
          '<feDropShadow dx="0" dy="15" stdDeviation="13" flood-color="#1f2937" flood-opacity=".22"/>' +
        '</filter>' +
      '</defs>' +
      '<rect width="800" height="500" rx="34" fill="url(#foodBg)"/>' +
      '<circle cx="690" cy="75" r="150" fill="#fff" opacity=".14"/>' +
      '<circle cx="80" cy="450" r="190" fill="#fff" opacity=".1"/>' +
      '<path d="M60 120c90-55 161-54 220 0M528 424c83-49 145-46 213 0" fill="none" stroke="#fff" stroke-width="3" opacity=".18"/>' +
      '<g filter="url(#softShadow)">' + foodArt + '</g>' +
      '<text x="400" y="82" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="3">' +
        escapeSvgText(profile.label) +
      '</text>' +
      '<text x="400" y="462" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="1.4" opacity=".82">' +
        'MINH HOẠ MÓN ĂN' +
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

function getBusinessStatus(row) {
  const raw = getField(row, [
    "Trạng thái",
    "Trang thai",
    "Status",
    "Business status",
    "Tình trạng"
  ]);
  const key = valueKey(raw);

  if (!raw) return null;
  if (/(đang mở|mở cửa|open|operational|hoạt động)/.test(key)) {
    return { label: "Đang mở", className: "open" };
  }
  if (/(đóng|closed|tạm nghỉ|temporarily)/.test(key)) {
    return { label: "Tạm đóng", className: "closed" };
  }
  return { label: raw, className: "unknown" };
}

function getRowSource(row) {
  return getField(row, [
    "Nguồn dữ liệu",
    "Nguon du lieu",
    "Nguồn",
    "Source"
  ]) || "Dữ liệu đã duyệt";
}

function getRowUpdatedAt(row) {
  return getField(row, [
    "Cập nhật",
    "Cap nhat",
    "Ngày cập nhật",
    "Ngay cap nhat",
    "Updated at",
    "Last updated"
  ]);
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
  const address = getRowAddress(row);
  const district = getField(row, ["Quận", "Quan"]);
  const hours = getField(row, ["Giờ mở cửa", "Gio mo cua"]);
  const price = getField(row, ["Khoảng giá", "Khoang gia", "Giá"]);
  const note = getField(row, ["Note", "Ghi chú", "Ghi chu"]);
  const businessStatus = getBusinessStatus(row);
  const source = getRowSource(row);
  const updatedAt = getRowUpdatedAt(row);
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

  const trust = '<div class="card-trust">' +
    '<span>✓ ' + escapeHtml(source) + "</span>" +
    (updatedAt ? "<span>↻ " + escapeHtml(updatedAt) + "</span>" : "") +
  "</div>";

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
        (businessStatus
          ? '<span class="business-status ' + escapeHtml(businessStatus.className) + '">' +
            escapeHtml(businessStatus.label) + "</span>"
          : "") +
        (address
          ? '<p class="address-line">⌖ ' + escapeHtml(address) + "</p>"
          : (district
            ? '<p class="address-line">⌖ ' + escapeHtml(district) + "</p>"
            : "")) +
        (details ? '<dl class="meta-list">' + details + "</dl>" : "") +
        (mapUrl
          ? '<a class="map-link" href="' + escapeHtml(mapUrl) +
            '" target="_blank" rel="noopener noreferrer">⌖ ' +
            escapeHtml(mapLinkLabel) + "</a>"
          : "") +
        (note ? '<p class="card-note">' + escapeHtml(note) + "</p>" : "") +
        trust +
      "</div>" +
    "</article>"
  );
}

function render() {
  const result = $("result");
  if (!state.loaded) return;

  const rows = getFilteredRows();
  const visibleRows = rows.slice(0, MAX_VISIBLE_RESULTS);
  const isLimited = rows.length > visibleRows.length;

  updateResultSummary(visibleRows.length, rows.length, isLimited);
  refreshQuickChipState();

  if (!rows.length) {
    result.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon" aria-hidden="true">⌕</div>' +
        "<h3>Chưa tìm thấy món phù hợp</h3>" +
        "<p>Hãy thử đổi quận, món ăn hoặc phân loại khác nhé.</p>" +
      "</div>";
    return;
  }

  if (state.location) {
    visibleRows.sort((a, b) =>
      (distanceByRow.get(a) ?? Number.POSITIVE_INFINITY) -
      (distanceByRow.get(b) ?? Number.POSITIVE_INFINITY)
    );
  }

  result.innerHTML = visibleRows.map(renderCard).join("");
}

function clearFilters() {
  state.filters = {
    district: "",
    food: "",
    type: ""
  };
  state.showAll = false;
  updateFilterOptions();
  render();

  if (state.location) {
    updateDistances();
  } else {
    setStatus("Đã xoá bộ lọc. Chọn quận hoặc món để bắt đầu.", "success");
  }
}

function findQuickValue(filterName, query) {
  const needle = valueKey(query);
  return getOptionsFor(filterName).find(value =>
    valueKey(value).includes(needle)
  ) || "";
}

function refreshQuickChipState() {
  document.querySelectorAll(".quick-chip").forEach(button => {
    const isNearby = button.dataset.quick === "nearby" && Boolean(state.location);
    const isReset = button.dataset.quickReset === "true" &&
      !Object.values(state.filters).some(Boolean) &&
      !state.location;
    const isFood = button.dataset.quickFood &&
      valueKey(state.filters.food).includes(valueKey(button.dataset.quickFood));
    const isType = button.dataset.quickType &&
      valueKey(state.filters.type).includes(valueKey(button.dataset.quickType));
    button.classList.toggle("is-active", Boolean(isNearby || isReset || isFood || isType));
  });
}

function handleQuickFilter(button) {
  if (button.dataset.quick === "nearby") {
    requestLocation();
    return;
  }

  if (button.dataset.quickReset === "true") {
    clearFilters();
    return;
  }

  const filterName = button.dataset.quickFood ? "food" : "type";
  const query = button.dataset.quickFood || button.dataset.quickType;
  const value = findQuickValue(filterName, query);

  if (!value) {
    setStatus("Chưa có dữ liệu " + query + " trong danh sách hiện tại.", "info");
    return;
  }

  state.filters[filterName] = value;
  state.showAll = false;
  updateFilterOptions();
  render();

  if (state.location) {
    updateDistances();
  }
  setStatus("Đang gợi ý theo " + value + ".", "success");
}

function handleFilterChange(event) {
  const filterName = {
    districtSelect: "district",
    foodSelect: "food",
    typeSelect: "type"
  }[event.target.id];

  if (!filterName) return;
  state.filters[filterName] = normalise(event.target.value);
  state.showAll = false;
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
  $("clearFilters")?.addEventListener("click", clearFilters);
  $("showAllButton")?.addEventListener("click", () => {
    state.showAll = !state.showAll;
    render();
  });
  document.querySelectorAll(".quick-chip").forEach(button => {
    button.addEventListener("click", () => handleQuickFilter(button));
  });
  setupInstallExperience();
  registerServiceWorker();
  loadData();
}

window.addEventListener("online", () => {
  if (state.loaded) loadData();
});

document.addEventListener("DOMContentLoaded", init);
