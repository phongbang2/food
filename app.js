let allData = [];

// link CSV public
const sheetUrl = "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

fetch(sheetUrl)
  .then(res => res.text())
  .then(csvText => {
    const data = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true
    });
    allData = data.data;
    render(allData);
  })
  .catch(err => {
    console.error("Lỗi đọc Google Sheets:", err);
    document.getElementById("table").innerText = "Không tải được dữ liệu Google Sheets!";
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
    document.getElementById("table").innerHTML = "Không có dữ liệu";
    return;
  }

  const headers = Object.keys(data[0]);

  let html = '<table border="1" cellpadding="6"><tr>';
  headers.forEach(h => html += `<th>${h}</th>`);
  html += "</tr>";

  data.forEach(row => {
    html += "<tr>";
    headers.forEach(h => html += `<td>${row[h] || ""}</td>`);
    html += "</tr>";
  });

  html += "</table>";
  document.getElementById("table").innerHTML = html;
}
