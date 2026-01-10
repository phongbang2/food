let allData = [];
let loaded = false;

const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

// Load data ẩn
fetch(sheetUrl)
  .then(res => res.text())
  .then(csv => {
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true
    });

    allData = parsed.data;
    loaded = true;

    initDropdowns();
  });

// Init dropdown từ data
function initDropdowns() {
  const foodSet = new Set();
  const districtSet = new Set();
  const typeSet = new Set();

  allData.forEach(row => {
    // QUẬN (đơn)
    if (row["Quận"]) {
      districtSet.add(row["Quận"].trim());
    }

    // MÓN (có thể nhiều)
    if (row["Tên món"]) {
      row["Tên món"]
        .split(/,|-|\n/)   // tách theo , - hoặc xuống dòng
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(v => foodSet.add(v));
    }

    // PHÂN LOẠI (có thể nhiều)
    if (row["Phân loại món"]) {
      row["Phân loại món"]
        .split(/,|-|\n/)
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(v => typeSet.add(v));
    }
  });

  fillSelect("foodSelect", [...foodSet]);
  fillSelect("districtSelect", [...districtSet]);
  fillSelect("typeSelect", [...typeSet]);
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

// Listen change
["foodSelect", "districtSelect", "typeSelect"].forEach(id => {
  document.getElementById(id).addEventListener("change", filterData);
});

// Filter logic
function filterData() {
  if (!loaded) return;

  const food = document.getElementById("foodSelect").value;
  const district = document.getElementById("districtSelect").value;
  const type = document.getElementById("typeSelect").value;

  const result = document.getElementById("result");

  if (!food && !district && !type) {
    result.innerHTML = `
      <div class="hint">
        Chọn ít nhất <b>1 điều kiện</b> để hiển thị kết quả
      </div>`;
    return;
  }

  const filtered = allData.filter(row => {
    if (food && row["Món"] !== food) return false;
    if (district && row["Quận"] !== district) return false;
    if (type && row["Phân loại"] !== type) return false;
    return true;
  });

  render(filtered);
}

// Render card
function render(data) {
  const result = document.getElementById("result");

  if (!data.length) {
    result.innerHTML = `<div class="hint">Không có kết quả phù hợp</div>`;
    return;
  }

  let html = `<div class="cards">`;

  data.forEach(row => {
    html += `
      <div class="card">
        <h3>${row["Tên quán"] || "Không tên"}</h3>
        ${row["Quận"] ? `<span class="tag">${row["Quận"]}</span>` : ""}

        ${row["Tên món"] ? `<p><b>Món:</b> ${row["Tên món"]}</p>` : ""}
        ${row["Phân loại món"] ? `<p><b>Loại:</b> ${row["Phân loại món"]}</p>` : ""}
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
