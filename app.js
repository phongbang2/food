let allData = [];

document.getElementById('file').addEventListener('change', e => {
  const file = e.target.files[0];
  const reader = new FileReader();

  reader.onload = evt => {
    const wb = XLSX.read(evt.target.result, { type: 'binary' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    allData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    render(allData);
  };

  reader.readAsBinaryString(file);
});

document.getElementById('search').addEventListener('input', e => {
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
    document.getElementById('table').innerHTML = 'Không có dữ liệu';
    return;
  }

  const headers = Object.keys(data[0]);

  let html = '<table border="1" cellpadding="6"><tr>';
  headers.forEach(h => html += `<th>${h}</th>`);
  html += '</tr>';

  data.forEach(row => {
    html += '<tr>';
    headers.forEach(h => html += `<td>${row[h]}</td>`);
    html += '</tr>';
  });

  html += '</table>';
  document.getElementById('table').innerHTML = html;
}
