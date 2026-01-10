function render(data) {
  const container = document.getElementById("table");

  if (!data.length) {
    container.innerHTML = "<p>Không có dữ liệu</p>";
    return;
  }

  let html = '<div class="cards">';

  data.forEach(row => {
    html += `<div class="card">`;

    // Tiêu đề
    html += `<h3>${row["Tên quán"] || "Không tên"}</h3>`;

    Object.keys(row).forEach(key => {
      if (key === "Tên quán") return;

      const value = row[key];
      if (!value) return;

      // ✅ Map tên hiển thị cho noted
      let label = key;
      if (key.trim().toLowerCase() === "noted") {
        label = "Note";
      }

      html += `<p><b>${label}:</b> ${value}</p>`;
    });

    html += `</div>`;
  });

  html += "</div>";
  container.innerHTML = html;
}
