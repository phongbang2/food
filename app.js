let allData = [];
const sheetUrl = "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

async function fetchData(retries = 3) {
  const tableEl = document.getElementById("table");
  tableEl.classList.add("loading");
  tableEl.innerHTML = "Đang tải dữ liệu... Vui lòng chờ...";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(sheetUrl, {
        headers: { 'Accept': 'text/csv; charset=utf-8' }
      });
      if (!res.ok) throw new Error(`Lỗi tải: ${res.status}`);

      const buffer = await res.arrayBuffer();
      const decoder = new TextDecoder('utf-8');
      const csvText = decoder.decode(buffer);

      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: h => h.trim().normalize("NFC"), // Normalize accents
        transform: val => (val || "").trim(),
        delimiter: ",", // Default nhưng đảm bảo
        quoteChar: '"'
      });

      allData = parsed.data.filter(row => row["Tên quán"] && row["Tên quán"].trim());
      render(allData);
      return;
    } catch (error) {
      console.error(`Thử ${attempt} thất bại:`, error);
      if (attempt === retries) {
        tableEl.classList.remove("loading");
        tableEl.innerHTML = '<p class="no-data">Không tải được dữ liệu. Kiểm tra mạng hoặc sheet có public (Anyone with link).</p>';
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

fetchData();

let debounceTimer;
document.getElementById("search").addEventListener("input", e => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const keyword = (e.target.value || "").trim().toLowerCase();
    if (!keyword) return render(allData);

    const filtered = allData.filter(row =>
      Object.values(row).some(val =>
        val && String(val).toLowerCase().includes(keyword)
      )
    );
    render(filtered);
  }, 300);
});

function render(data) {
  const tableEl = document.getElementById("table");
  tableEl.classList.remove("loading");

  if (!data.length) {
    tableEl.innerHTML = '<p class="no-data">Không tìm thấy quán phù hợp 😔</p>';
    return;
  }

  let html = '<div class="cards">';
  data.forEach(row => {
    const tenDuong = row["Tên đường"] || "";
    const quan = row["Quận"] || "";
    const diaChi = [tenDuong, quan].filter(Boolean).join(", ");

    html += `
      <div class="card">
        <h3>🍴 ${row["Tên quán"] || "Không tên"}</h3>
        
        ${row["Phân loại món"] ? `<span class="tag">${row["Phân loại món"]}</span>` : ""}
        
        ${row["Tên món"] ? `<p><strong>Món:</strong> ${row["Tên món"]}</p>` : ""}
        
        ${diaChi ? `<p><strong>Địa chỉ:</strong> ${diaChi}</p>` : ""}
        
        ${row["Giờ mở cửa"] ? `<p><strong>Giờ mở cửa:</strong> ${row["Giờ mở cửa"]}</p>` : ""}
        
        ${row["Khoảng giá"] ? `<p><strong>Khoảng giá:</strong> ${row["Khoảng giá"]}</p>` : ""}
        
        ${row["Note"] ? `<p class="note"><strong>Ghi chú:</strong> ${row["Note"]}</p>` : ""}
      </div>
    `;
  });
  html += "</div>";
  tableEl.innerHTML = html;
}
