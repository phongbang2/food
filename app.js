let allData = [];

const sheetUrl =
  "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

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
  .catch(() => {
    document.getElementById("table").innerText =
      "Không tải được dữ liệu";
  });

document.getElementById("search").addEventListener("input", e => {
  const keyword = e.target.value.toLowerCase();
  const filtered = allData.filter(row =>
    Object.values(row).some(val =>
      String(val).toLowerCase().includes(keyword)
    )
  );
  render(filtered);
});

function render(data) {
  if (!data.length) {
    document.getElementById("table").innerHTML =
      "<p>Không có dữ liệu</p>";
    return;
  }

  let html = '<div class="cards">';

  data.forEach(row => {
    html += `
      <div class="card">
        <h3>${row["Tên quán"] || "Không tên"}</h3>
        <p><b>Món:</b> ${row["Món"] || ""}</p>
        <p><b>Địa chỉ:</b> ${row["Địa chỉ"] || ""}</p>
        <p><b>Quận:</b> ${row["Quận"] || ""}</p>
        <p><b>Giờ mở:</b> ${row["Giờ mở"] || ""}</p>
      </div>
    `;
  });

  html += "</div>";
  document.getElementById("table").innerHTML = html;
}
