// ===================================
// GLOBAL STATE
// ===================================
let allData = [];
let currentData = [];
let loaded = false;

// ===================================
// GOOGLE SHEET CSV
// ===================================
const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

// ===================================
// LOAD DATA
// ===================================
fetch(sheetUrl)
  .then(res => res.text())
  .then(csv => {
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true
    });

    allData = parsed.data;
    currentData = [...allData];
    loaded = true;

    initDistrictDropdown();
    initFoodAndTypeDropdown(allData);
  })
  .catch(err => console.error(err));

// ===================================
// INIT DISTRICT (STATIC)
// ===================================
function initDistrictDropdown() {
  const districtSet = new Set();

  allData.forEach(row => {
    if (row["Quận"]) districtSet.add(row["Quận"].trim());
  });

  fillSelect("districtSelect", [...districtSet]);
}

// ===================================
// INIT FOOD + TYPE (FROM DATA)
// ===================================
function initFoodAndTypeDropdown(data) {
  const foodSet = new Set();
  const typeSet = new Set();

  data.forEach(row => {
    if (row["Tên món"]) {
      splitValues(row["Tên món"]).forEach(v => foodSet.add(v));
    }
    if (row["Phân loại món"]) {
      splitValues(row["Phân loại món"]).forEach(v => typeSet.add(v));
    }
  });

  resetSelect("foodSelect", foodSet);
  resetSelect("typeSelect", typeSet);
}

// ===================================
// SPLIT MULTI VALUES
// ===================================
function splitValues(text) {
  return text
    .split(/,|-|\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

// ===================================
// FILL SELECT (FIRST LOAD)
// ===================================
function fillSelect(id, items) {
  const select = document.getElementById(id);
  items.sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

// ===================================
// RESET SELECT (KEEP FIRST OPTION)
// ===================================
function resetSelect(id, values) {
  const select = document.getElementById(id);
  const firstOption = select.options[0];

  select.innerHTML = "";
  select.appendChild(firstOption);

  [...values].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

// ===================================
// EVENT LISTENERS
// ===================================
document.getElementById("districtSelect").addEventListener("change", filterData);
document.getElementById("typeSelect").addEventListener("change", filterData);
document.getElementById("foodSelect").addEventListener("change", filterData);

// ===================================
// MAIN FILTER LOGIC (PROGRESSIVE)
// ===================================
function filterData() {
  if (!loaded) return;

  const district = document.getElementById("districtSelect").value;
  const type = document.getElementById("typeSelect").value;
  const food = document.getElementById("foodSelect").value;

  const result = document.getElementById("result");

  let filtered = [...allData];

  // 1️⃣ QUẬN (BẮT BUỘC LÀ NỀN)
  if (district) {
    filtered = filtered.filter(r => r["Quận"] === district);
  }

  // 👉 Update dropdown theo data đã lọc
  initFoodAndTypeDropdown(filtered);

  // 2️⃣ PHÂN LOẠI
  if (type) {
    filtered = filtered.filter(r =>
      r["Phân loại món"] &&
      r["Phân loại món"].toLowerCase().includes(type.toLowerCase())
    );
  }

  // 3️⃣ TÊN MÓN
  if (food) {
    filtered = filtered.filter(r =>
      r["Tên món"] &&
      r["Tên món"].toLowerCase().includes(food.toLowerCase())
    );
  }

  currentData = filtered;

  if (!district && !type && !food) {
    result.innerHTML = `
      <div class="hint">
        Chọn ít nhất <b>1 điều kiện</b> để hiển thị kết quả
      </div>`;
    return;
  }

  render(filtered);
}

// ===================================
// RENDER RESULT
// ===================================
function render(data) {
  const result = document.getElementById("result");

  if (!data.length) {
    result.innerHTML = `
      <div class="hint">
        Không có kết quả phù hợp
      </div>`;
    return;
  }

  let html = `<div class="cards">`;

  data.forEach(row => {
    html += `
      <div class="card">
        <h3>${row["Tên quán"] || "Không tên"}</h3>
        ${row["Quận"] ? `<span class="tag">${row["Quận"]}</span>` : ""}

        ${row["Tên món"] ? `<p><b>Tên món:</b> ${row["Tên món"]}</p>` : ""}
        ${row["Phân loại món"] ? `<p><b>Phân loại:</b> ${row["Phân loại món"]}</p>` : ""}
        ${row["Tên đường"] ? `<p><b>Đường:</b> ${row["Tên đường"]}</p>` : ""}
        ${row["Giờ mở cửa"] ? `<p><b>Giờ:</b> ${row["Giờ mở cửa"]}</p>` : ""}
        ${row["Khoảng giá"] ? `<p><b>Giá:</b> ${row["Khoảng giá"]}</p>` : ""}
        ${row["noted"] ? `<div class="note">${row["noted"]}</div>` : ""}
      </div>
    `;
  });

  html += `</div>`;
  result.innerHTML = html;
}
