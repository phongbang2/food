let allData = [];
const sheetUrl = "https://docs.google.com/spreadsheets/d/1uJk8tFBuAJDHo8XD7J69vzjufjPwGyXqxsU5kzA2R-8/export?format=csv&gid=0";

async function fetchData(retries = 3) {
  const tableEl = document.getElementById("table");
  tableEl.classList.add("loading");
  tableEl.innerHTML = "Đang tải dữ liệu...";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(sheetUrl);
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const csvText = await res.text();
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false // Giữ string để tránh convert số
      });
      allData = parsed.data;
      render(allData);
      return;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === retries) {
        tableEl.classList.remove("loading");
        tableEl.innerHTML = '<p class="no-data">Không tải được dữ liệu. Vui lòng kiểm tra kết nối hoặc thử lại sau.</p>';
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay trước retry
    }
  }
}

fetchData();

let debounceTimer;
document.getElementById("search").addEventListener("input", e => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const keyword = e.target.value.trim().toLowerCase();
    if (!keyword) {
      render(allData);
      return;
    }
    const filtered = allData.filter(row =>
      Object.values(row).some(val => 
        val != null && String(val).toLowerCase().includes(keyword)
      )
    );
    render(filtered);
  }, 300); // Debounce 300ms
});

function render(data) {
  const tableEl = document.getElementById("table");
  tableEl.classList.remove("loading");

  if (!data || !data.length) {
    tableEl.innerHTML = '<p class="no-data">Không có dữ liệu phù hợp</p>';
    return;
  }

  let html = '<div class="cards">';
  data.forEach(row => {
    html += `
      <div class="card">
        <h3>${row["Tên quán"] || "Không tên"}</h3>
        ${row["Món"] ? `<p><b>Món:</b> ${row["Món"]}</p>` : ""}
        ${row["Địa chỉ"] ? `<p><b>Địa chỉ:</b> ${row["Địa chỉ"]}</p>` : ""}
        ${row["Quận"] ? `<p><b>Quận:</b> ${row["Quận"]}</p>` : ""}
        ${row["Giờ mở"] ? `<p><b>Giờ mở:</b> ${row["Giờ mở"]}</p>` : ""}
      </div>
    `;
  });
  html += "</div>";
  tableEl.innerHTML = html;
}
