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
