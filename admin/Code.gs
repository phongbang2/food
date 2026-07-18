const CONFIG = Object.freeze({
  SPREADSHEET_ID: "1LHQlScoOABMay4-faE4ECdX7LlcPaDQzlDJFYqKmiZ8",
  DATA_SHEET: "HCM",
  REVIEW_SHEET: "Review"
});

const DATA_COLUMNS = [
  "Tên quán",
  "Tên món",
  "Phân loại món",
  "Tên đường",
  "Quận",
  "Giờ mở cửa",
  "Khoảng giá",
  "Note"
];

const REVIEW_HEADERS = [
  "ID",
  "Trạng thái",
  "Hành động",
  "Tên quán",
  "Tên món",
  "Phân loại món",
  "Tên đường",
  "Quận",
  "Giờ mở cửa",
  "Khoảng giá",
  "Note",
  "Dòng mục tiêu",
  "Nguồn review",
  "Ngày đề xuất",
  "Lý do",
  "Kết quả"
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Admin")
    .setTitle("Quản trị dữ liệu • Ăn Sập Sài Gòn")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getBootstrap() {
  setupReviewSheet();
  return {
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    pending: getReviewRows_().filter(row => row.status === "Chờ duyệt"),
    pendingCount: getReviewRows_().filter(row => row.status === "Chờ duyệt").length
  };
}

function setupReviewSheet() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(CONFIG.REVIEW_SHEET);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.REVIEW_SHEET);
  }

  const firstRow = sheet.getRange(1, 1, 1, REVIEW_HEADERS.length).getDisplayValues()[0];
  const hasHeader = firstRow.some(value => String(value).trim());

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, REVIEW_HEADERS.length).setValues([REVIEW_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, REVIEW_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#fff0e8")
      .setWrap(true);
    sheet.getRange(2, 2, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(["Chờ duyệt", "Đã thêm", "Đã cập nhật", "Từ chối", "Trùng dữ liệu"], true)
        .setAllowInvalid(false)
        .build());
    sheet.getRange(2, 3, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(["ADD", "UPDATE"], true)
        .setAllowInvalid(false)
        .build());
    sheet.autoResizeColumns(1, REVIEW_HEADERS.length);
  } else if (firstRow.join("|") !== REVIEW_HEADERS.join("|")) {
    throw new Error("Tab Review đã tồn tại nhưng không đúng cấu trúc. Không ghi đè dữ liệu hiện có.");
  }

  return {
    sheetName: sheet.getName(),
    headers: REVIEW_HEADERS,
    rowCount: Math.max(sheet.getLastRow() - 1, 0)
  };
}

function searchExisting(query) {
  const needle = normalize_(query);
  if (needle.length < 2) return [];

  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 9).getDisplayValues();
  const results = [];

  values.forEach((row, index) => {
    const haystack = normalize_(row.slice(1).join(" "));
    if (!haystack.includes(needle)) return;

    results.push({
      row: index + 2,
      name: row[1],
      food: row[2],
      type: row[3],
      street: row[4],
      district: row[5],
      hours: row[6],
      price: row[7],
      note: row[8]
    });
  });

  return results.slice(0, 25);
}

function saveReview(payload) {
  const clean = validatePayload_(payload);
  const reviewSheet = setupReviewSheet();
  const sheet = getSpreadsheet_().getSheetByName(reviewSheet.sheetName);
  const id = "R-" + Utilities.formatDate(new Date(), getTimezone_(), "yyyyMMdd-HHmmss") +
    "-" + Math.floor(Math.random() * 900 + 100);
  const row = sheet.getLastRow() + 1;

  sheet.getRange(row, 1, 1, REVIEW_HEADERS.length).setValues([[
    id,
    "Chờ duyệt",
    clean.action,
    clean.name,
    clean.food,
    clean.type,
    clean.street,
    clean.district,
    clean.hours,
    clean.price,
    clean.note,
    clean.targetRow ? Number(clean.targetRow) : "",
    clean.source,
    new Date(),
    clean.reason,
    ""
  ]]);

  return { id: id, row: row, status: "Chờ duyệt" };
}

function applyReview(reviewId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const review = findReview_(reviewId);
    if (!review) throw new Error("Không tìm thấy đề xuất cần duyệt.");
    if (review.status !== "Chờ duyệt") {
      throw new Error("Đề xuất này đã được xử lý: " + review.status);
    }

    const payload = validatePayload_({
      action: review.action,
      name: review.name,
      food: review.food,
      type: review.type,
      street: review.street,
      district: review.district,
      hours: review.hours,
      price: review.price,
      note: review.note,
      targetRow: review.targetRow,
      source: review.source,
      reason: review.reason
    });

    const dataSheet = getDataSheet_();

    if (payload.action === "UPDATE") {
      const targetRow = Number(payload.targetRow) || findTargetRow_(payload.name);
      if (!targetRow || targetRow < 2 || targetRow > dataSheet.getLastRow()) {
        throw new Error("Không xác định được dòng quán cần cập nhật.");
      }

      dataSheet.getRange(targetRow, 2, 1, DATA_COLUMNS.length)
        .setValues([toDataRow_(payload)]);
      markReview_(review.row, "Đã cập nhật", "Đã cập nhật dòng " + targetRow + " trong tab HCM.");
      return { status: "Đã cập nhật", row: targetRow };
    }

    const duplicateRow = findDuplicateRow_(payload);
    if (duplicateRow) {
      markReview_(review.row, "Trùng dữ liệu", "Đã có quán tương tự ở dòng " + duplicateRow + ".");
      return { status: "Trùng dữ liệu", row: duplicateRow };
    }

    const nextRow = Math.max(dataSheet.getLastRow() + 1, 2);
    const sourceRow = Math.max(nextRow - 1, 2);
    dataSheet.getRange(sourceRow, 1, 1, 9)
      .copyTo(dataSheet.getRange(nextRow, 1, 1, 9), { contentsOnly: false });
    dataSheet.getRange(nextRow, 2, 1, DATA_COLUMNS.length)
      .setValues([toDataRow_(payload)]);
    markReview_(review.row, "Đã thêm", "Đã thêm dòng " + nextRow + " vào tab HCM.");
    SpreadsheetApp.flush();

    return { status: "Đã thêm", row: nextRow };
  } finally {
    lock.releaseLock();
  }
}

function rejectReview(reviewId, reason) {
  const review = findReview_(reviewId);
  if (!review) throw new Error("Không tìm thấy đề xuất cần từ chối.");
  if (review.status !== "Chờ duyệt") throw new Error("Đề xuất này đã được xử lý.");

  const message = String(reason || "Không đạt yêu cầu").trim();
  markReview_(review.row, "Từ chối", message);
  return { status: "Từ chối" };
}


function authorizeExternalSources() {
  const urls = [
    "https://services.arcgis.com/EaQ3hSM51DBnlwMq/ArcGIS/rest/services/Food_in_HCM/FeatureServer/0?f=json",
    "https://overpass.private.coffee/api/interpreter"
  ];

  const results = urls.map(url => {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: "get",
        muteHttpExceptions: true,
        followRedirects: true
      });
      return response.getResponseCode();
    } catch (error) {
      return String(error.message || error);
    }
  });

  return "Đã kiểm tra quyền nguồn ngoài: " + results.join(", ");
}

function discoverOsmPlaces(options) {
  const requestedDistrict = String(options && options.district || "").trim();
  const requestedCategory = String(options && options.category || "all").trim();
  const query = buildOverpassQuery_(requestedCategory, requestedDistrict);
  const endpoints = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
  ];

  let lastStatus = "";
  let payload = null;

  for (const endpoint of endpoints) {
    try {
      const response = UrlFetchApp.fetch(endpoint, {
        method: "post",
        payload: { data: query },
        contentType: "application/x-www-form-urlencoded",
        headers: { "User-Agent": "AnSapSaiGon-food-discovery/1.0" },
        muteHttpExceptions: true,
        followRedirects: true
      });

      lastStatus = String(response.getResponseCode());
      if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
        continue;
      }

      const text = response.getContentText() || "";
      if (!text.trim().startsWith("{")) continue;
      payload = JSON.parse(text);
      break;
    } catch (error) {
      lastStatus = String(error.message || error);
    }
  }

  if (!payload) {
    const fallback = discoverArcgisPlaces_(requestedDistrict, requestedCategory);
    if (fallback.candidates.length) return fallback;

    throw new Error("Các nguồn dữ liệu địa điểm đều không phản hồi (" +
      lastStatus + "). Vui lòng thử lại sau 1 phút.");
  }

  const knownKeys = getKnownRestaurantKeys_();
  const candidates = (payload.elements || [])
    .map(element => mapOsmElement_(element, requestedDistrict))
    .filter(Boolean)
    .filter(candidate => {
      if (!requestedDistrict) return true;
      return normalize_(candidate.district).includes(normalize_(requestedDistrict)) ||
        !candidate.district;
    })
    .map(candidate => {
      candidate.duplicate = knownKeys.has(restaurantKey_(candidate));
      return candidate;
    })
    .sort((first, second) =>
      Number(first.duplicate) - Number(second.duplicate) ||
      first.name.localeCompare(second.name, "vi")
    );

  return {
    source: "OpenStreetMap contributors",
    attribution: "Dữ liệu OpenStreetMap — cần kiểm tra lại trước khi duyệt.",
    candidates: candidates.slice(0, 60)
  };
}

function discoverArcgisPlaces_(requestedDistrict, requestedCategory) {
  const baseUrl = "https://services.arcgis.com/EaQ3hSM51DBnlwMq/ArcGIS/rest/services/Food_in_HCM/FeatureServer/0/query";
  const params = [
    "where=" + encodeURIComponent("1=1"),
    "outFields=*",
    "returnGeometry=true",
    "resultRecordCount=200",
    "f=json"
  ].join("&");

  try {
    const response = UrlFetchApp.fetch(baseUrl + "?" + params, {
      method: "get",
      headers: { "User-Agent": "AnSapSaiGon-food-discovery/1.0" },
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      return { source: "ArcGIS Food_in_HCM", candidates: [] };
    }

    const payload = JSON.parse(response.getContentText() || "{}");
    const knownKeys = getKnownRestaurantKeys_();
    const candidates = (payload.features || [])
      .map(feature => mapArcgisFeature_(feature, requestedDistrict))
      .filter(Boolean)
      .filter(candidate => !requestedDistrict ||
        !candidate.district ||
        normalize_(candidate.district).includes(normalize_(requestedDistrict)))
      .filter(candidate => requestedCategory === "all" ||
        candidate.sourceCategory === requestedCategory)
      .map(candidate => {
        candidate.duplicate = knownKeys.has(restaurantKey_(candidate));
        delete candidate.sourceCategory;
        return candidate;
      })
      .sort((first, second) =>
        Number(first.duplicate) - Number(second.duplicate) ||
        first.name.localeCompare(second.name, "vi")
      );

    return {
      source: "ArcGIS Food_in_HCM",
      attribution: "Dữ liệu bản đồ công khai; cần kiểm tra lại trước khi duyệt.",
      candidates: candidates.slice(0, 60)
    };
  } catch (error) {
    return { source: "ArcGIS Food_in_HCM", candidates: [] };
  }
}

function mapArcgisFeature_(feature, requestedDistrict) {
  const attributes = feature && feature.attributes || {};
  const keys = Object.keys(attributes);
  if (!keys.length) return null;

  const read = aliases => {
    const exactKey = keys.find(key =>
      aliases.some(alias => normalize_(key) === normalize_(alias)));
    if (exactKey && attributes[exactKey] !== null && attributes[exactKey] !== undefined) {
      return String(attributes[exactKey]).trim();
    }

    const partialKey = keys.find(key => {
      const normalized = normalize_(key);
      return aliases.some(alias => normalized.includes(normalize_(alias)));
    });
    return partialKey && attributes[partialKey] !== null &&
      attributes[partialKey] !== undefined
      ? String(attributes[partialKey]).trim()
      : "";
  };

  const name = read(["name", "ten quan", "ten nha hang", "restaurant", "title"]);
  if (!name) return null;

  const street = read(["address", "dia chi", "street", "duong", "location"]);
  const district = read(["district", "quan", "huyen", "suburb"]) || requestedDistrict;
  const rawCategory = read(["category", "loai", "type", "cuisine", "food"]);
  const sourceCategory = mapArcgisCategory_(rawCategory, name);
  const food = rawCategory || "Món ăn đang cập nhật";
  const coordinates = webMercatorToWgs84_(feature.geometry);
  const objectId = read(["objectid", "fid", "id"]);
  const source = objectId
    ? "https://services.arcgis.com/EaQ3hSM51DBnlwMq/ArcGIS/rest/services/Food_in_HCM/FeatureServer/0/query?where=" +
      encodeURIComponent("OBJECTID=" + objectId) + "&outFields=*&f=pjson"
    : "https://services.arcgis.com/EaQ3hSM51DBnlwMq/ArcGIS/rest/services/Food_in_HCM/FeatureServer/0";

  return {
    id: "arcgis-" + (objectId || name),
    name: name,
    food: food,
    type: sourceCategory,
    sourceCategory: sourceCategory === "Bánh mì" ? "bakery" :
      sourceCategory === "Quán nước" ? "cafe" :
      sourceCategory === "Fastfood" ? "fastfood" :
      "restaurant",
    street: street,
    district: district,
    hours: read(["opening hours", "gio mo cua", "hours"]),
    note: "Nguồn ArcGIS Food_in_HCM; cần xác minh tên, địa chỉ và giờ mở cửa.",
    source: source,
    mapUrl: coordinates
      ? "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(coordinates.latitude + "," + coordinates.longitude)
      : "",
    duplicate: false
  };
}

function mapArcgisCategory_(rawCategory, name) {
  const text = normalize_(rawCategory + " " + name);
  if (text.includes("bakery") || text.includes("banh mi") || text.includes("bread")) {
    return "Bánh mì";
  }
  if (text.includes("cafe") || text.includes("coffee") || text.includes("drink")) {
    return "Quán nước";
  }
  if (text.includes("fast") || text.includes("burger") || text.includes("pizza")) {
    return "Fastfood";
  }
  if (text.includes("rice") || text.includes("com")) {
    return "Cơm";
  }
  return "Món khô";
}

function webMercatorToWgs84_(geometry) {
  if (!geometry || !Number.isFinite(Number(geometry.x)) ||
      !Number.isFinite(Number(geometry.y))) return null;

  const x = Number(geometry.x);
  const y = Number(geometry.y);
  const longitude = x / 20037508.34 * 180;
  let latitude = y / 20037508.34 * 180;
  latitude = 180 / Math.PI *
    (2 * Math.atan(Math.exp(latitude * Math.PI / 180)) - Math.PI / 2);

  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

function saveOsmCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    throw new Error("Chưa chọn quán nào.");
  }

  const selected = candidates.slice(0, 30).filter(candidate => !candidate.duplicate);
  if (!selected.length) {
    return { added: 0, skipped: candidates.length, message: "Các quán đã chọn đều trùng dữ liệu hiện có." };
  }

  let added = 0;
  let skipped = candidates.length - selected.length;

  selected.forEach(candidate => {
    try {
      saveReview({
        action: "ADD",
        name: candidate.name,
        food: candidate.food || "Món ăn đang cập nhật",
        type: candidate.type || "Món khô",
        street: candidate.street || "Chưa rõ địa chỉ",
        district: candidate.district,
        hours: candidate.hours || "",
        price: "",
        note: candidate.note || "",
        source: candidate.source,
        reason: "Đề xuất từ OpenStreetMap; cần kiểm tra thực tế."
      });
      added += 1;
    } catch (error) {
      skipped += 1;
    }
  });

  return {
    added: added,
    skipped: skipped,
    message: "Đã đưa " + added + " quán vào hàng chờ review."
  };
}

function buildOverpassQuery_(category, district) {
  const bbox = getOsmBbox_(district);
  const filters = {
    all: [
      'nwr["amenity"~"restaurant|cafe|fast_food|food_court|bar|pub"]["name"](' + bbox + ');',
      'nwr["shop"~"bakery|pastry|confectionery"]["name"](' + bbox + ');'
    ],
    restaurant: ['nwr["amenity"="restaurant"]["name"](' + bbox + ');'],
    cafe: ['nwr["amenity"="cafe"]["name"](' + bbox + ');'],
    fastfood: ['nwr["amenity"="fast_food"]["name"](' + bbox + ');'],
    bakery: ['nwr["shop"~"bakery|pastry|confectionery"]["name"](' + bbox + ');']
  };

  const statements = filters[category] || filters.all;
  return "[out:json][timeout:20];(" + statements.join("") + ");out center tags;";
}

function getOsmBbox_(district) {
  const key = normalize_(district);
  const bboxes = {
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
    "thu duc": "10.780,106.760,10.950,106.900"
  };

  return bboxes[key] || "10.33,106.35,11.15,107.05";
}

function mapOsmElement_(element, requestedDistrict) {
  const tags = element.tags || {};
  const name = String(tags["name:vi"] || tags.name || "").trim();
  if (!name) return null;

  const position = element.lat && element.lon
    ? { latitude: element.lat, longitude: element.lon }
    : element.center && element.center.lat && element.center.lon
      ? { latitude: element.center.lat, longitude: element.center.lon }
      : null;
  if (!position) return null;

  const street = [
    tags["addr:housenumber"] || "",
    tags["addr:street"] || ""
  ].join(" ").trim();
  const district = String(
    tags["addr:district"] ||
    tags["addr:city_district"] ||
    tags["addr:suburb"] ||
    requestedDistrict ||
    ""
  ).trim();

  const type = mapOsmCategory_(tags);
  const food = mapOsmCuisine_(tags);
  const objectPath = String(element.type || "node") + "/" + element.id;
  const source = "https://www.openstreetmap.org/" + objectPath;
  const mapUrl = "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(position.latitude + "," + position.longitude);

  return {
    id: objectPath,
    name: name,
    food: food,
    type: type,
    street: street,
    district: district,
    hours: String(tags.opening_hours || "").trim(),
    note: [
      tags.cuisine ? "Cuisine OSM: " + tags.cuisine : "",
      "Tọa độ: " + position.latitude + ", " + position.longitude,
      "Cần xác minh tên, địa chỉ và giờ mở cửa."
    ].filter(Boolean).join(" • "),
    source: source,
    mapUrl: mapUrl,
    duplicate: false
  };
}

function mapOsmCategory_(tags) {
  const amenity = String(tags.amenity || "").toLowerCase();
  const shop = String(tags.shop || "").toLowerCase();
  const cuisine = String(tags.cuisine || "").toLowerCase();

  if (shop === "bakery" || shop === "pastry" || shop === "confectionery" ||
      cuisine.includes("banh_mi") || cuisine.includes("sandwich")) return "Bánh mì";
  if (amenity === "cafe") return "Quán nước";
  if (amenity === "fast_food") return "Fastfood";
  if (cuisine.includes("rice") || cuisine.includes("com")) return "Cơm";
  if (amenity === "bar" || amenity === "pub") return "Nhậu nhẹt";
  return "Món khô";
}

function mapOsmCuisine_(tags) {
  const cuisine = String(tags.cuisine || "").trim().toLowerCase();
  if (!cuisine) return "Món ăn đang cập nhật";
  if (cuisine.includes("coffee") || cuisine.includes("cafe")) return "Cà phê";
  if (cuisine.includes("vietnamese")) return "Món Việt";
  if (cuisine.includes("rice") || cuisine.includes("com")) return "Cơm";
  if (cuisine.includes("noodle") || cuisine.includes("pho")) return "Món nước";
  if (cuisine.includes("pizza")) return "Pizza";
  if (cuisine.includes("burger")) return "Burger";
  return cuisine.replace(/[_;]+/g, " ");
}

function getKnownRestaurantKeys_() {
  const keys = new Set();
  const dataSheet = getDataSheet_();
  const lastRow = dataSheet.getLastRow();

  if (lastRow >= 2) {
    dataSheet.getRange(2, 2, lastRow - 1, 5).getDisplayValues()
      .forEach(row => keys.add(restaurantKey_({
        name: row[0],
        street: row[3],
        district: row[4]
      })));
  }

  const reviewSheet = getSpreadsheet_().getSheetByName(CONFIG.REVIEW_SHEET);
  if (reviewSheet && reviewSheet.getLastRow() >= 2) {
    reviewSheet.getRange(2, 4, reviewSheet.getLastRow() - 1, 5).getDisplayValues()
      .forEach(row => keys.add(restaurantKey_({
        name: row[0],
        street: row[3],
        district: row[4]
      })));
  }

  return keys;
}

function restaurantKey_(restaurant) {
  return [
    normalize_(restaurant.name),
    normalize_(restaurant.street),
    normalize_(restaurant.district)
  ].join("|");
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getDataSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.DATA_SHEET);
  if (!sheet) throw new Error("Không tìm thấy tab " + CONFIG.DATA_SHEET + ".");
  return sheet;
}

function getReviewRows_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.REVIEW_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, REVIEW_HEADERS.length).getDisplayValues();
  return values.map((row, index) => ({
    row: index + 2,
    id: row[0],
    status: row[1],
    action: row[2],
    name: row[3],
    food: row[4],
    type: row[5],
    street: row[6],
    district: row[7],
    hours: row[8],
    price: row[9],
    note: row[10],
    targetRow: row[11],
    source: row[12],
    proposedAt: row[13],
    reason: row[14],
    result: row[15]
  }));
}

function findReview_(reviewId) {
  return getReviewRows_().find(row => row.id === String(reviewId));
}

function markReview_(rowNumber, status, result) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.REVIEW_SHEET);
  sheet.getRange(rowNumber, 2).setValue(status);
  sheet.getRange(rowNumber, 16).setValue(result);
}

function validatePayload_(payload) {
  const source = String(payload && payload.source || "").trim();
  const name = String(payload && payload.name || "").trim();
  const food = String(payload && payload.food || "").trim();
  const type = String(payload && payload.type || "").trim();
  const street = String(payload && payload.street || "").trim();
  const district = String(payload && payload.district || "").trim();
  const action = String(payload && payload.action || "").trim().toUpperCase();

  if (!["ADD", "UPDATE"].includes(action)) throw new Error("Hành động không hợp lệ.");
  if (!name || !food || !type || !street || !district) {
    throw new Error("Cần điền đủ tên quán, món, phân loại, địa chỉ và quận.");
  }
  if (!source) throw new Error("Cần ghi nguồn review hoặc đường dẫn tham khảo.");

  validateChoice_(getDataSheet_().getRange("D2"), type, "Phân loại món");
  validateChoice_(getDataSheet_().getRange("F2"), district, "Quận");

  return {
    action: action,
    name: protectText_(name),
    food: protectText_(food),
    type: protectText_(type),
    street: protectText_(street),
    district: protectText_(district),
    hours: protectText_(payload.hours),
    price: protectText_(payload.price),
    note: protectText_(payload.note),
    targetRow: String(payload.targetRow || "").trim(),
    source: protectText_(source),
    reason: protectText_(payload.reason)
  };
}

function validateChoice_(cell, value, label) {
  const rule = cell.getDataValidation();
  if (!rule) return;

  if (rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    const allowed = rule.getCriteriaValues()[0].map(item => String(item));
    if (!allowed.includes(value)) {
      throw new Error(label + " chưa có giá trị “" + value + "” trong danh sách của file gốc.");
    }
  }
}

function toDataRow_(payload) {
  return [
    payload.name,
    payload.food,
    payload.type,
    payload.street,
    payload.district,
    payload.hours,
    payload.price,
    payload.note
  ];
}

function findTargetRow_(name) {
  const normalized = normalize_(name);
  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const names = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
  const index = names.findIndex(row => normalize_(row[0]) === normalized);
  return index >= 0 ? index + 2 : 0;
}

function findDuplicateRow_(payload) {
  const sheet = getDataSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const values = sheet.getRange(2, 2, lastRow - 1, 5).getDisplayValues();
  const name = normalize_(payload.name);
  const street = normalize_(payload.street);
  const district = normalize_(payload.district);

  const index = values.findIndex(row =>
    normalize_(row[0]) === name &&
    normalize_(row[3]) === street &&
    normalize_(row[4]) === district
  );

  return index >= 0 ? index + 2 : 0;
}

function normalize_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function protectText_(value) {
  const text = String(value || "").trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function getTimezone_() {
  return Session.getScriptTimeZone() || "Asia/Bangkok";
}

function doPost(e) {
  try {
    const body = JSON.parse(e && e.postData && e.postData.contents || "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("IMPORT_TOKEN");

    if (!expectedToken) {
      return jsonResponse_({ ok: false, error: "IMPORT_TOKEN chưa được cấu hình trong Apps Script." });
    }
    if (!body.token || body.token !== expectedToken) {
      return jsonResponse_({ ok: false, error: "Token import không hợp lệ." });
    }

    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!candidates.length) {
      return jsonResponse_({ ok: false, error: "Không có dữ liệu quán để import." });
    }

    return jsonResponse_({ ok: true, result: saveImportedCandidates_(candidates) });
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error.message || error) });
  }
}

function setImportToken() {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty("IMPORT_TOKEN", token);
  Logger.log(token);
  return token;
}

function saveImportedCandidates_(candidates) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const selected = candidates.slice(0, 50);
    const knownKeys = getKnownRestaurantKeys_();
    let added = 0;
    let skipped = 0;

    selected.forEach(candidate => {
      try {
        const key = restaurantKey_(candidate);
        if (!key || knownKeys.has(key)) {
          skipped += 1;
          return;
        }

        saveReview({
          action: "ADD",
          name: candidate.name,
          food: candidate.food || "Món ăn đang cập nhật",
          type: candidate.type,
          street: candidate.street,
          district: candidate.district,
          hours: candidate.hours || "",
          price: candidate.price || "",
          note: candidate.note || "",
          source: candidate.source,
          reason: candidate.reason || "Đề xuất từ bộ thu thập Python; cần kiểm tra trước khi duyệt."
        });
        knownKeys.add(key);
        added += 1;
      } catch (error) {
        skipped += 1;
      }
    });

    return {
      added: added,
      skipped: skipped,
      message: "Đã đưa " + added + " quán vào hàng chờ Review."
    };
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
