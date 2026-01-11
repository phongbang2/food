// ================================
// GLOBAL STATE
// ================================
let allData = [];
let loaded = false;

// ================================
// GOOGLE SHEET CSV
// ================================
const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1LHQlScoOABMay4-faE4ECdX7LlcPaDQzlDJFYqKmiZ8/export?format=csv&gid=0";
// ================================
// LOAD DATA
// ================================
fetch(sheetUrl)
  .then(res => res.text())
  .then(csv => {
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true
    });

    allData = parsed.data;
    loaded = true;

    initDistrictDropdown();
    lockFoodAndType(true);
  });

// ================================
// INIT DISTRICT
// ================================
function initDistrictDropdown() {
  const set = new Set();

  allData.forEach(r => {
    if (r["Quận"]) set.add(r["Quận"].trim());
  });

  fillSelect("districtSelect", [...set]);
}

// ================================
// INIT FOOD & TYPE FROM DATA
// ================================
function initFoodAndTypeDropdown(data) {
  const foodSet = new Set();
  const typeSet = new Set();

  data.forEach(r => {
    if (r["Tên món"]) split(r["Tên món"]).forEach(v => foodSet.add(v));
    if (r["Phân loại món"]) split(r["Phân loại món"]).forEach(v => typeSet.add(v));
  });

  resetSelect("foodSelect", foodSet);
  resetSelect("typeSelect", typeSet);
}

// ================================
// HELPERS
// ================================
function split(text) {
  return text.split(/,|-|\n/).map(v => v.trim()).filter(Boolean);
}

function fillSelect(id, items) {
  const select = document.getElementById(id);
  items.sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

function resetSelect(id, values) {
  const select = document.getElementById(id);
  const first = select.options[0];

  select.innerHTML = "";
  select.appendChild(first);

  [...values].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

function lockFoodAndType(lock) {
  document.getElementById("foodSelect").disabled = lock;
  document.getElementById("typeSelect").disabled = lock;
}

// ================================
// EVENTS
// ================================
document.getElementById("districtSelect").addEventListener("change", filterData);
document.getElementById("foodSelect").addEventListener("change", filterData);
document.getElementById("typeSelect").addEventListener("change", filterData);

// ================================
// FILTER LOGIC (QUẬN → MÓN → LOẠI)
// ================================
function filterData() {
  if (!loaded) return;

  const district = document.getElementById("districtSelect").value;
  const food = document.getElementById("foodSelect").value;
  const type = document.getElementById("typeSelect").value;
  const result = document.getElementById("result");

  // 🔒 Chưa chọn quận
  if (!district) {
    lockFoodAndType(true);
    initFoodAndTypeDropdown(allData);
    result.innerHTML = `<div class="hint">Vui lòng chọn <b>Quận</b> trước</div>`;
    return;
  }

  // ✅ Đã chọn quận
  lockFoodAndType(false);

  let filtered = allData.filter(r => r["Quận"] === district);

  // Update dropdown theo quận
  initFoodAndTypeDropdown(filtered);

  if (type) {
    filtered = filtered.filter(r =>
      r["Phân loại món"]?.toLowerCase().includes(type.toLowerCase())
    );
  }

  if (food) {
    filtered = filtered.filter(r =>
      r["Tên món"]?.toLowerCase().includes(food.toLowerCase())
    );
  }

  render(filtered);
}

// ================================
// RENDER
// ================================
function render(data) {
  const result = document.getElementById("result");

  if (!data.length) {
    result.innerHTML = `<div class="hint">Không có kết quả phù hợp</div>`;
    return;
  }

  let html = `<div class="cards">`;

  data.forEach(r => {
    html += `
      <div class="card">
        <h3>${r["Tên quán"] || "Không tên"}</h3>
        <span class="tag">${r["Quận"]}</span>
        ${r["Tên món"] ? `<p><b>Món:</b> ${r["Tên món"]}</p>` : ""}
        ${r["Phân loại món"] ? `<p><b>Loại:</b> ${r["Phân loại món"]}</p>` : ""}
        ${row["Tên đường"] ? `
          <p class="address">
            📍 <a
                  href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  row["Tên đường"] + ", " + (row["Quận"] || "")
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                  >
                  ${row["Tên đường"]}
              </a>
          </p>
`       : ""}
        ${r["Giờ mở cửa"] ? `<p><b>Giờ:</b> ${r["Giờ mở cửa"]}</p>` : ""}
        ${r["Khoảng giá"] ? `<p><b>Giá:</b> ${r["Khoảng giá"]}</p>` : ""}
        ${r["Note"] ? `<p><b>Note:</b> ${r["Note"]}</p>` : ""}
      </div>
    `;
  });

  html += `</div>`;
  result.innerHTML = html;
}
function openMap(address) {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const url = isMobile
    ? `https://www.google.com/maps/search/?api=1&query=${address}`
    : `https://www.google.com/maps?q=${address}`;

  window.open(url, "_blank");
}
function onDistrictChange() {
  document.getElementById("foodSelect").disabled = false;
  document.getElementById("typeSelect").disabled = false;
  filterData();
}

document
  .getElementById("districtSelect")
  .addEventListener("change", onDistrictChange);
