let allData = [];
let loaded = false;

const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

// Load data (ẩn)
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

// Search event
document.getElementById("search").addEventListener("input", e => {
  const keyword = e.target.value.trim().toLowerCase();
  const result = document.getElementById("result");

  // ❌ chưa đủ điều kiện
  if (keyword.length < 2) {
    result.innerHTML = `
      <div class="hint">
        Nhập ít nhất 2 ký tự để tìm kiếm
      </div>`;
    return;
  }

  if (!loaded) {
    result.innerHTML = `<div class="hint">Đang tải dữ liệu...</div>`;
    return;
  }

  const filtered = allData.filter(row => {
    return (
      String(row["Món"] || "").toLowerCase().includes(keyword) ||
      String(row["Quận"] || "").toLowerCase().includes(keyword) ||
      String(row["Phân loại"] || "").toLowerCase().includes(keyword)
    );
  });

  render(filtered);
});

// Render cards
function render(data) {
  const result = document.getElementById("result");

  if (!data.length) {
    result.innerHTML = `
      <div class="hint">
        Không tìm thấy kết quả phù hợp
      </div>`;
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
