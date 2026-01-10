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
  });

// Listen input
["foodInput", "districtInput", "typeInput"].forEach(id => {
  document.getElementById(id).addEventListener("input", filterData);
});

function filterData() {
  const food = document.getElementById("foodInput").value.trim().toLowerCase();
  const district = document.getElementById("districtInput").value.trim().toLowerCase();
  const type = document.getElementById("typeInput").value.trim().toLowerCase();

  const result = document.getElementById("result");

  if (!food && !district && !type) {
    result.innerHTML = `
      <div class="hint">
        Nhập ít nhất <b>1 ô</b> để bắt đầu tìm
      </div>`;
    return;
  }

  if (!loaded) {
    result.innerHTML = `<div class="hint">Đang tải dữ liệu...</div>`;
    return;
  }

  const filtered = allData.filter(row => {
    if (food && !String(row["Món"] || "").toLowerCase().includes(food)) return false;
    if (district && !String(row["Quận"] || "").toLowerCase().includes(district)) return false;
    if (type && !String(row["Phân loại"] || "").toLowerCase().includes(type)) return false;
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

        ${row["Món"] ? `<p><b>Món:</b> ${row["Món"]}</p>` : ""}
        ${row["Phân loại"] ? `<p><b>Loại:</b> ${row["Phân loại"]}</p>` : ""}
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
