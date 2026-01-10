let allData = [];

const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

// Load Google Sheets
fetch(sheetUrl)
  .then(res => res.text())
  .then(csvText => {
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true
    });

    allData = parsed.data;
    render(allData);
  })
  .catch(err => {
    console.error(err);
    document.getElementById("table").innerText =
      "Không tải được dữ liệu";
  });

// Search
document.getElementById("search").addEventListener("input", e => {
  const keyword = e.target.value.toLowerCase();

  const filtered = allData.filter(row =>
    Object.values(row).some(val =>
      String(val).toLowerCase().includes(keyword)
    )
  );

  render(filtered);
});

// Render cards (DYNAMIC COLUMNS)
function render(data) {
  const container = document.getElementById("table");

  if (!data.length) {
    container.innerHTML = "<p>Không có dữ liệu</p>";
    return;
  }

  let html = '<div class="cards">';

  data.forEach(row => {
    html += `<div class="card">`;

    // 👉 Tên quán làm tiêu đề
    html += `<h3>${row["Tên quán"] || "Không tên"}</h3>`;

    // 👉 Render tất cả cột còn lại
    Object.keys(row).forEach(key => {
      if (key === "Tên quán") return;

      const value = row[key];
      if (!value) return;

      html += `<p><b>${key}:</b> ${value}</p>`;
    });

    html += `</div>`;
  });

  html += "</div>";
  container.innerHTML = html;
}
