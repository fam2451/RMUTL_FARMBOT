// chart.js

const sheetIds = {
  'Pond 1': 'Pond 1 Archive',
  'Pond 2': 'Pond 2 Archive',
  'Pond 3': 'Pond 3 Archive',
  'Pond 4': 'Pond 4 Archive',
  'Greenhouse': 'Greenhouse_Archive'
};

const spreadsheetId = '1cSpQsGjlJJZijkK1B_woHoOUcFnphU5GgdfggE4-zLc';
const baseUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=`;

const chartRefs = {
  'Pond 1': { temp: null, pH: null, tds: null },
  'Pond 2': { temp: null, pH: null, tds: null },
  'Pond 3': { temp: null, pH: null, tds: null },
  'Pond 4': { temp: null, pH: null, tds: null },
  'Greenhouse': { temp: null, humidity: null, lux: null }
};

async function fetchSheet(sheetName) {
  const url = baseUrl + encodeURIComponent(sheetName);
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.substr(47).slice(0, -2));
  return json.table.rows.map(row => {
    const date = row.c[0]?.f || row.c[0]?.v;
    const period = row.c[1]?.v;

    if (sheetName === 'Greenhouse_Archive') {
      return {
        date,
        period,
        temp: parseFloat(row.c[2]?.v),
        humidity: parseFloat(row.c[3]?.v),
        lux: parseFloat(row.c[4]?.v),
      };
    } else {
      return {
        date,
        period,
        temp: parseFloat(row.c[3]?.v),
        pH: parseFloat(row.c[4]?.v),
        tds: parseFloat(row.c[5]?.v),
      };
    }
  });
}

function formatDateDDMMYYYY(rawDate) {
  // รองรับ "YYYY-MM-DD" → แปลงเป็น DD/MM/YYYY
  if (typeof rawDate === "string" && rawDate.includes("-")) {
    const [y, m, d] = rawDate.split("-");
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // ถ้าเป็น DD/MM/YYYY อยู่แล้ว → return เลย
  if (typeof rawDate === "string" && rawDate.includes("/")) return rawDate;

  // ถ้าเป็น Date object หรือ timestamp
  const date = new Date(rawDate);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

async function init() {
  const allData = {};
  const dateSet = new Set();

  const pondKeys = Object.keys(sheetIds).filter(k => k.startsWith('Pond'));

  for (let pond of pondKeys) {
    const data = await fetchSheet(sheetIds[pond]);
    allData[pond] = data;
    data.forEach(row => row.date && dateSet.add(row.date));
  }

  const dates = Array.from(dateSet).sort((a, b) => {
    const da = new Date(a.split('/').reverse().join('-'));
    const db = new Date(b.split('/').reverse().join('-'));
    return db - da; // เรียงจากล่าสุด → เก่าสุด
  });   

  const dateSelect = document.getElementById('dateSelect');
  dateSelect.innerHTML = "";

  const defaultOpt = document.createElement('option');
  defaultOpt.value = "";
  defaultOpt.text = "-- ไม่เลือกวันที่ --";
  dateSelect.appendChild(defaultOpt);

  dates.forEach(d => {
    const opt = document.createElement('option');
    opt.value = formatDateDDMMYYYY(d);     
    opt.text = formatDateDDMMYYYY(d);
    dateSelect.appendChild(opt);
  });

  createAllCharts();
  updateAllCharts();
}

function createChart(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: label,
        data: [],
        borderColor: color,
        borderWidth: 2,
        fill: false,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: false
        }
      }
    }
  });
}

function createAllCharts() {
  for (let i = 1; i <= 4; i++) {
    const pond = `Pond ${i}`;
    chartRefs[pond].temp = createChart(`pond${i}TempChart`, `${pond} Temp`, 'blue');
    chartRefs[pond].pH   = createChart(`pond${i}PhChart`, `${pond} pH`, 'green');
    chartRefs[pond].tds  = createChart(`pond${i}TdsChart`, `${pond} TDS`, 'orange');
  }

  // ✅ เพิ่ม Greenhouse
  chartRefs['Greenhouse'].temp     = createChart('greenhouseTempChart', 'Greenhouse Temp', 'red');
  chartRefs['Greenhouse'].humidity = createChart('greenhouseHumidityChart', 'Humidity', 'blue');
  chartRefs['Greenhouse'].lux      = createChart('greenhouseLuxChart', 'Lux', 'goldenrod');
}

async function updateAllCharts() {
  const selectedDate = document.getElementById('dateSelect').value;

  for (let key in sheetIds) {
    const data = await fetchSheet(sheetIds[key]);
    const filtered = data.filter(row => formatDateDDMMYYYY(row.date) === selectedDate);
    const periods = filtered.map(r => r.period);

    const charts = chartRefs[key];
    if (!charts) continue;

    if (key === 'Greenhouse') {
      const temps = filtered.map(r => r.temp);
      const hums  = filtered.map(r => r.humidity);
      const luxs  = filtered.map(r => r.lux);

      charts.temp.data.labels = periods;
      charts.temp.data.datasets[0].data = temps;
      charts.temp.update();

      charts.humidity.data.labels = periods;
      charts.humidity.data.datasets[0].data = hums;
      charts.humidity.update();

      charts.lux.data.labels = periods;
      charts.lux.data.datasets[0].data = luxs;
      charts.lux.update();
    } else {
      const temps = filtered.map(r => r.temp);
      const phs   = filtered.map(r => r.pH);
      const tdss  = filtered.map(r => r.tds);

      charts.temp.data.labels = periods;
      charts.temp.data.datasets[0].data = temps;
      charts.temp.update();

      charts.pH.data.labels = periods;
      charts.pH.data.datasets[0].data = phs;
      charts.pH.update();

      charts.tds.data.labels = periods;
      charts.tds.data.datasets[0].data = tdss;
      charts.tds.update();
    }
  }
}

window.onload = async () => {
  document.getElementById('compareMetric').selectedIndex = 0;
  await init(); // สำหรับ pond
  await loadGreenhouseDates(); // สำหรับ greenhouse
};

async function loadGreenhouseDates() {
  const data = await fetchSheet(sheetIds['Greenhouse']);
  const dateSet = new Set(data.map(row => row.date));
  const dates = Array.from(dateSet).sort((a, b) => {
    const da = new Date(a.split('/').reverse().join('-'));
    const db = new Date(b.split('/').reverse().join('-'));
    return db - da;
  });

  const select = document.getElementById('greenhouseDateSelect');
  dates.forEach(rawDate => {
    const formatted = formatDateDDMMYYYY(rawDate);
    const opt = document.createElement('option');
    opt.value = formatted;
    opt.text = formatted;
    select.appendChild(opt);
  });

  updateGreenhouseCharts(); // โหลดทันทีรอบแรก
}

async function updateGreenhouseCharts() {
  const selectedDate = document.getElementById('greenhouseDateSelect').value;
  const data = await fetchSheet(sheetIds['Greenhouse']);
  const filtered = data.filter(row => formatDateDDMMYYYY(row.date) === selectedDate);
  const periods = filtered.map(r => r.period);
  const temps = filtered.map(r => r.temp);
  const hums  = filtered.map(r => r.humidity);
  const luxs  = filtered.map(r => r.lux);

  const charts = chartRefs['Greenhouse'];
  if (!charts) return;

  charts.temp.data.labels = periods;
  charts.temp.data.datasets[0].data = temps;
  charts.temp.update();

  charts.humidity.data.labels = periods;
  charts.humidity.data.datasets[0].data = hums;
  charts.humidity.update();

  charts.lux.data.labels = periods;
  charts.lux.data.datasets[0].data = luxs;
  charts.lux.update();
}

function formatToDayAndDate(dmyStr) {
  const [d, m, y] = dmyStr.split('/');
  const date = new Date(`${y}-${m}-${d}`);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit'
  }); // เช่น "Mon 01/07"
}

async function updateRangeCharts() {
  const range = document.getElementById('rangeSelect').value;
  if (!range) return;

  const n = parseInt(range);
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - (n - 1));

  const pondKeys = Object.keys(sheetIds).filter(k => k.startsWith('Pond'));

  for (let pond of pondKeys) {
    const data = await fetchSheet(sheetIds[pond]);

    const filtered = data.filter(row => {
      const [d, m, y] = row.date.split('/');
      const rowDate = new Date(`${y}-${m}-${d}`);
      return rowDate >= cutoff && rowDate <= now;
    });

    const periods = filtered.map(r => formatToDayAndDate(r.date));
    const temps = filtered.map(r => r.temp);
    const phs   = filtered.map(r => r.pH);
    const tdss  = filtered.map(r => r.tds);

    const charts = chartRefs[pond];
    if (!charts) continue;

    charts.temp.data.labels = periods;
    charts.temp.data.datasets[0].data = temps;
    charts.temp.update();

    charts.pH.data.labels = periods;
    charts.pH.data.datasets[0].data = phs;
    charts.pH.update();

    charts.tds.data.labels = periods;
    charts.tds.data.datasets[0].data = tdss;
    charts.tds.update();
  }
}

function formatToDayAndDate(dmyStr) {
  const [d, m, y] = dmyStr.split('/');
  const date = new Date(`${y}-${m}-${d}`);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit'
  }); // เช่น "Tue 02/07"
}

async function updateGreenhouseRangeCharts() {
  const range = document.getElementById('greenhouseRangeSelect').value;
  if (!range) return;

  const n = parseInt(range);
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - (n - 1)); // หรือ -n ถ้าไม่ต้องการรวมวันนี้

  const data = await fetchSheet(sheetIds['Greenhouse']);
  const filtered = data.filter(row => {
    const [d, m, y] = row.date.split('/');
    const rowDate = new Date(`${y}-${m}-${d}`);
    return rowDate >= cutoff && rowDate <= now;
  });

  const periods = filtered.map(r => formatToDayAndDate(r.date));
  const temps = filtered.map(r => r.temp);
  const hums  = filtered.map(r => r.humidity);
  const luxs  = filtered.map(r => r.lux);

  const charts = chartRefs['Greenhouse'];
  if (!charts) return;

  charts.temp.data.labels = periods;
  charts.temp.data.datasets[0].data = temps;
  charts.temp.update();

  charts.humidity.data.labels = periods;
  charts.humidity.data.datasets[0].data = hums;
  charts.humidity.update();

  charts.lux.data.labels = periods;
  charts.lux.data.datasets[0].data = luxs;
  charts.lux.update();
}
