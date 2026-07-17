const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1LHQlScoOABMay4-faE4ECdX7LlcPaDQzlDJFYqKmiZ8/export?format=csv&gid=0";
const DATA_CACHE_KEY = "food-finder-data-v2";
const REQUEST_TIMEOUT_MS = 12000;

const state = {
  allData: [],
  loaded: false,
  filters: {
    district: "",
    food: "",
    type: ""
  },
  deferredPrompt: null
};

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
  return String(value ?? "").trim().replace(/\\s+/g, " ");
}

function getField(row, keys) {
  for (const key of keys) {
    const value = normalise(row?.[key]);
    if (value) return value;
  }
  return "";
}

function splitValues(value) {
  return normalise(value)
    .split(/[,;|\\n]/)
    .map(item => normalise(item))
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
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
    getField(row, ["Quận", "Quan"]) || getField(row, ["Tên quán", "Ten quan"])
  );

  if (!rows.length) {
    throw new Error("Chưa có dữ liệu món ăn hợp lệ.");
  }

  state.allData = rows;
  state.loaded = true;
  populateDistricts();
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

function setSelectOptions(select, values, placeholder, selectedValue = "") {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(new Option(placeholder, ""));

  const sortedValues = uniqueSorted(values);
  for (const value of sortedValues) {
    fragment.appendChild(new Option(value, value));
  }

  select.replaceChildren(fragment);
  select.value = sortedValues.includes(selectedValue) ? selectedValue : "";
  return select.value;
}

function populateDistricts() {
  const districts = state.allData.map(row =>
    getField(row, ["Quận", "Quan"])
  );

  state.filters.district = setSelectOptions(
    $("districtSelect"),
    districts,
    "Chọn quận",
    state.filters.district
  );
}

function updateFilterOptions() {
  const districtSelect = $("districtSelect");
  const foodSelect = $("foodSelect");
  const typeSelect = $("typeSelect");

  if (!state.filters.district) {
    state.filters.food = "";
    state.filters.type = "";
    foodSelect.disabled = true;
    typeSelect.disabled = true;
    setSelectOptions(foodSelect, [], "Chọn món");
    setSelectOptions(typeSelect, [], "Chọn loại món");
    return;
  }

  const districtRows = state.allData.filter(row =>
    getField(row, ["Quận", "Quan"]) === state.filters.district
  );

  const foods = districtRows.flatMap(row =>
    splitValues(getField(row, ["Tên món", "Ten mon"]))
  );
  const types = districtRows.flatMap(row =>
    splitValues(getField(row, ["Phân loại món", "Phan loai mon", "Loại món"]))
  );

  foodSelect.disabled = false;
  typeSelect.disabled = false;
  state.filters.food = setSelectOptions(
    foodSelect,
    foods,
    "Tất cả món",
    state.filters.food
  );
  state.filters.type = setSelectOptions(
    typeSelect,
    types,
    "Tất cả loại món",
    state.filters.type
  );
}

function getFilteredRows() {
  let rows = state.allData.filter(row =>
    getField(row, ["Quận", "Quan"]) === state.filters.district
  );

  if (state.filters.food) {
    rows = rows.filter(row =>
      splitValues(getField(row, ["Tên món", "Ten mon"]))
        .some(value => value.toLocaleLowerCase("vi").includes(
          state.filters.food.toLocaleLowerCase("vi")
        ))
    );
  }

  if (state.filters.type) {
    rows = rows.filter(row =>
      splitValues(getField(row, ["Phân loại món", "Phan loai mon", "Loại món"]))
        .some(value => value.toLocaleLowerCase("vi").includes(
          state.filters.type.toLocaleLowerCase("vi")
        ))
    );
  }

  return rows;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function renderCard(row) {
  const restaurant = getField(row, ["Tên quán", "Ten quan"]) || "Quán ngon ẩn danh";
  const food = getField(row, ["Tên món", "Ten mon"]);
  const type = getField(row, ["Phân loại món", "Phan loai mon", "Loại món"]);
  const address = getField(row, ["Tên đường", "Dia chi", "Địa chỉ"]);
  const district = getField(row, ["Quận", "Quan"]);
  const hours = getField(row, ["Giờ mở cửa", "Gio mo cua"]);
  const price = getField(row, ["Khoảng giá", "Khoang gia", "Giá"]);
  const note = getField(row, ["Note", "Ghi chú", "Ghi chu"]);
  const image = safeExternalUrl(getField(row, ["Ảnh", "Hình ảnh", "Image", "URL ảnh"]));
  const mapQuery = [address, district].filter(Boolean).join(", ");
  const mapUrl = mapQuery
    ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapQuery)
    : "";

  const imageHtml = image
    ? '<img class="food-image" src="' + escapeHtml(image) +
      '" alt="' + escapeHtml(restaurant) + '" loading="lazy" />'
    : '<div class="food-image-placeholder" aria-hidden="true">🍜</div>';

  const details = [
    food ? "<div><dt>Món</dt><dd>" + escapeHtml(food) + "</dd></div>" : "",
    hours ? "<div><dt>Giờ mở</dt><dd>" + escapeHtml(hours) + "</dd></div>" : "",
    price ? "<div><dt>Khoảng giá</dt><dd>" + escapeHtml(price) + "</dd></div>" : ""
  ].join("");

  return (
    '<article class="result-item">' +
      '<div class="food-visual">' + imageHtml +
        '<span class="category-pill">' + escapeHtml(type || "Địa điểm ăn uống") + "</span>" +
      "</div>" +
      '<div class="result-content">' +
        "<h3>" + escapeHtml(restaurant) + "</h3>" +
        (details ? '<dl class="meta-list">' + details + "</dl>" : "") +
        (address
          ? '<a class="map-link" href="' + escapeHtml(mapUrl) +
            '" target="_blank" rel="noopener noreferrer">⌖ ' +
            escapeHtml(address) + "</a>"
          : "") +
        (note ? '<p class="card-note">' + escapeHtml(note) + "</p>" : "") +
      "</div>" +
    "</article>"
  );
}

function render() {
  const result = $("result");
  if (!state.loaded) return;

  if (!state.filters.district) {
    result.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon" aria-hidden="true">⌖</div>' +
        "<h3>Bắt đầu khám phá</h3>" +
        "<p>Chọn một quận để xem những quán ngon đang được gợi ý.</p>" +
      "</div>";
    return;
  }

  const rows = getFilteredRows();
  if (!rows.length) {
    result.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon" aria-hidden="true">⌕</div>' +
        "<h3>Chưa tìm thấy món phù hợp</h3>" +
        "<p>Hãy thử đổi món ăn hoặc phân loại khác nhé.</p>" +
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
  state.filters[filterName] = event.target.value;

  if (filterName === "district") {
    state.filters.food = "";
    state.filters.type = "";
  }

  updateFilterOptions();
  render();
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
  setupInstallExperience();
  registerServiceWorker();
  loadData();
}

window.addEventListener("online", () => {
  if (state.loaded) loadData();
});

document.addEventListener("DOMContentLoaded", init);
