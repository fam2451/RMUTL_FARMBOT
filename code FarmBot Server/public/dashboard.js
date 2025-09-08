// analytics.js (เวอร์ชันแก้ไขสมบูรณ์)

document.addEventListener("DOMContentLoaded", () => {
  // ============================
  //  CONFIGURATION
  // ============================
  let pondChart, greenhouseChart, modalChart;
  const sheetIds = {
    "Pond 1": "Pond 1 Archive",
    "Pond 2": "Pond 2 Archive",
    "Pond 3": "Pond 3 Archive",
    "Pond 4": "Pond 4 Archive",
    Greenhouse: "Greenhouse_archive",
    Pond_Analytics: "Pond_Analytics",
  };
  const spreadsheetId = "1cSpQsGjlJJZijkK1B_woHoOUcFnphU5GgdfggE4-zLc";
  const baseUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=`;

  // ============================
  //  DATA FETCHING
  // ============================
  async function fetchSheetData(sheetName) {
    if (!sheetName) {
      console.error("Sheet name is undefined. Cannot fetch data.");
      return [];
    }
    try {
      const url = `${baseUrl}${encodeURIComponent(sheetName)}`;
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(`Fetch failed for ${sheetName}: ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text.substr(47).slice(0, -2));
      return json.table.rows;
    } catch (error) {
      console.error(`Error fetching or parsing sheet "${sheetName}":`, error);
      return [];
    }
  }

  // ============================
  //  CHARTING LOGIC
  // ============================
  function createChart(canvasId, datasets, options = {}) {
    const ctx = document.getElementById(canvasId).getContext("2d");
    return new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "time",
            time: {
              tooltipFormat: "dd/MM/yyyy HH:mm",
              unit: options.timeUnit || "day",
            },
            title: { display: true, text: "Date" },
            grid: { display: false },
          },
          y: {
            grid: { display: true },
          },
          ...options.scales,
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              usePointStyle: true,
              pointStyle: "circle",
              fill: false,
              boxWidth: 8,
              padding: 20,
            },
          },
          tooltip: { mode: "index", intersect: false, ...options.tooltip },
        },
        interaction: { mode: "nearest", axis: "x", intersect: false },
      },
    });
  }

  async function updatePondChart() {
    const metric = document.querySelector("#pond-metric-controls .active")
      .dataset.metric;
    const range = parseInt(
      document.querySelector("#pond-time-controls .active").dataset.range
    );
    const selectedPonds = Array.from(
      document.querySelectorAll("#pond-selector-controls input:checked")
    ).map((cb) => cb.value);

    if (pondChart) pondChart.destroy();
    if (selectedPonds.length === 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - range);

    const datasets = [];
    const colorMap = {
      "Pond 1": "#A7226E",
      "Pond 2": "#F26B38",
      "Pond 3": "#F7DB4F",
      "Pond 4": "#2F9599",
    };

    for (const pondName of selectedPonds) {
      const rows = await fetchSheetData(sheetIds[pondName]);
      const chartData = rows
        .map((row) => {
          try {
            const dateParts = row.c[0]?.f.split("/");
            const timeParts = row.c[1]?.v.split("-")[0].trim().split(":");
            if (!dateParts || !timeParts || dateParts.length < 3) return null;
            const recordDate = new Date(
              parseInt(dateParts[2]),
              parseInt(dateParts[1]) - 1,
              parseInt(dateParts[0]),
              parseInt(timeParts[0]),
              parseInt(timeParts[1])
            );
            if (isNaN(recordDate.getTime()) || recordDate < cutoffDate)
              return null;
            const value = parseFloat(
              row.c[{ temp: 3, ph: 4, tds: 5 }[metric]]?.v
            );
            return { x: recordDate, y: isNaN(value) ? null : value };
          } catch {
            return null;
          }
        })
        .filter((p) => p && p.y !== null);

      datasets.push({
        label: ` ${pondName} ${metric.toUpperCase()}`,
        data: chartData,
        borderColor: colorMap[pondName] || "#cccccc",
        tension: 0.2,
        pointRadius: 2,
        pointBackgroundColor: colorMap[pondName],
        fill: false, 
      });
    }

    // 🇹🇭 บรรทัดที่แก้ไขแล้ว
    let timeUnit;
    if (range === 1) {
      timeUnit = "hour";
    } else if (range <= 7) {
      timeUnit = "day";
    } else {
      timeUnit = "week";
    }

    pondChart = createChart("pondChartCanvas", datasets, { timeUnit });
  }

  async function updateGreenhouseChart() {
    const metric = document.querySelector("#greenhouse-metric-controls .active")
      .dataset.metric;
    const range = parseInt(
      document.querySelector("#greenhouse-time-controls .active").dataset.range
    );

    if (greenhouseChart) greenhouseChart.destroy();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - range);

    const rows = await fetchSheetData(sheetIds["Greenhouse"]);
    const chartData = rows
      .map((row) => {
        try {
          const recordDate = new Date(
            `${row.c[0]?.f}T${row.c[1]?.v.split("–")[0].trim()}:00`
          );
          if (isNaN(recordDate.getTime()) || recordDate < cutoffDate)
            return null;
          const value = parseFloat(
            row.c[{ temp: 2, humidity: 3, lux: 4 }[metric]]?.v
          );
          return { x: recordDate, y: isNaN(value) ? null : value };
        } catch {
          return null;
        }
      })
      .filter((p) => p && p.y !== null);

    const datasets = [
      {
        label: ` Local ${metric.toUpperCase()}`,
        data: chartData,
        borderColor: "#FC913A",
        tension: 0.3,
        pointRadius: 2,
        fill: false,
        pointBackgroundColor: "#FC913A",
      },
    ];

    
    let timeUnit;
    if (range === 1) {
      timeUnit = "hour";
    } else if (range <= 7) {
      timeUnit = "day";
    } else {
      timeUnit = "week";
    }

    greenhouseChart = createChart("greenhouseChartCanvas", datasets, {
      timeUnit,
    });
  }

  // ============================
  //  EXPERIMENTS LIST & MODAL
  // ============================
  async function loadExperimentsList() {
    const container = document.getElementById("experiments-list-container");
    const template = document.getElementById("experiment-item-template");
    container.innerHTML = "<p>Loading experiments...</p>";

    const rows = await fetchSheetData(sheetIds["Pond_Analytics"]);

    const experiments = rows
      .map((r) => ({
        no: r.c[0]?.v, // Column A
        startDate: r.c[1]?.f, // Column B
        startTime: r.c[2]?.v, // Column C
        endDate: r.c[3]?.f, // Column D
        endTime: r.c[4]?.v, // Column E
        pond: r.c[5]?.v, // Column F

        tempMin: r.c[6]?.v,
        tempMax: r.c[7]?.v,
        tempAvg: r.c[8]?.v,
        tempMed: r.c[9]?.v,
        tempSd: r.c[10]?.v,
        tempCv: r.c[11]?.v,

        tdsMin: r.c[12]?.v,
        tdsMax: r.c[13]?.v,
        tdsAvg: r.c[14]?.v,
        tdsMed: r.c[15]?.v,
        tdsSd: r.c[16]?.v,
        tdsCv: r.c[17]?.v,

        phMin: r.c[18]?.v,
        phMax: r.c[19]?.v,
        phAvg: r.c[20]?.v,
        phMed: r.c[21]?.v,
        phSd: r.c[22]?.v,
        phCv: r.c[23]?.v,

        qsgm: r.c[24]?.v,
        qpgm: r.c[25]?.v,
        grora: r.c[26]?.v,
        duration: r.c[27]?.v,
        remark: r.c[28]?.v,
      }))
      .filter((exp) => exp.no != null && exp.no !== "");

    container.innerHTML = "";
    if (experiments.length === 0) {
      container.innerHTML = "<p>No experiments found.</p>";
      return;
    }

    for (const exp of experiments.reverse()) {
      const clone = template.content.cloneNode(true);
      clone
        .querySelector(".event-detail-btn")
        .addEventListener("click", () => showExperimentDetails(exp));
      clone.querySelector('[data-field="remark"]').textContent =
        exp.remark || `Experiment #${exp.no}`;
      clone.querySelector('[data-field="pond"]').textContent =
        exp.pond || "N/A";
      clone.querySelector('[data-field="startDate"]').textContent =
        exp.startDate || "N/A";
      clone.querySelector('[data-field="startTime"]').textContent =
        exp.startTime || "N/A";
      clone.querySelector('[data-field="endDate"]').textContent =
        exp.endDate || "N/A";
      clone.querySelector('[data-field="endTime"]').textContent =
        exp.endTime || "N/A";
      container.appendChild(clone);
    }
  }

  async function showExperimentDetails(exp) {
    const modal = document.getElementById("details-modal-overlay");
    document.getElementById("modal-title").textContent =
      exp.remark || `Details for ${exp.batch}`;
    document.getElementById("modal-text-content").innerHTML = `
            <p><strong>Pond :</strong> ${exp.pond || "N/A"}</p>
            <p><strong>Start Date :</strong> ${
              exp.startDate || "N/A"
            }   <strong>Time :</strong> ${exp.startTime || "N/A"}</p>
            <p><strong>End Date :</strong> ${
              exp.endDate || "N/A"
            }     <strong>Time :</strong> ${exp.endTime || "N/A"}</p>
            <p><strong>Quantity Start   :</strong> ${
              exp.qsgm != null ? parseFloat(exp.qsgm).toFixed(2) + " G" : "N/A"
            }</p>
            <p><strong>Quantity Product :</strong> ${
              exp.qpgm != null ? parseFloat(exp.qpgm).toFixed(2) + " G" : "N/A"
            }</p>
            <p><strong>Growth Rate :</strong> ${
              exp.grora != null
                ? parseFloat(exp.grora).toFixed(2) + " %"
                : "N/A"
            }</p>


            <p><strong>-------------------- Temp --------------------</strong></p>
            <p><strong>Min :</strong> ${
              exp.tempMin != null
                ? parseFloat(exp.tempMin).toFixed(2) + " °C"
                : "N/A"
            } <strong>Max:</strong> ${
      exp.tempMax != null ? parseFloat(exp.tempMax).toFixed(2) + " °C" : "N/A"
    }</p>
            <p><strong>Avgrage :</strong> ${
              exp.tempAvg != null
                ? parseFloat(exp.tempAvg).toFixed(2) + " °C"
                : "N/A"
            } <strong>Median :</strong> ${
      exp.tempMed != null ? parseFloat(exp.tempMed).toFixed(2) + " °C" : "N/A"
    }</p>
            <p><strong>Standard Deviation :</strong> ${
              exp.tempSd != null
                ? parseFloat(exp.tempSd).toFixed(2) + ""
                : "N/A"
            }</p>
            <p><strong>Coefficient of Variation :</strong> ${
              exp.tempSd != null
                ? parseFloat(exp.tempCv).toFixed(2) + "%"
                : "N/A"
            }</p>   
            
            <p><strong>-------------------- TDS --------------------</strong></p>
            <p><strong>Min :</strong> ${
              exp.tdsMin != null
                ? parseFloat(exp.tdsMin).toFixed(2) + " ppm"
                : "N/A"
            } <strong>Max:</strong> ${
      exp.tdsMax != null ? parseFloat(exp.tdsMax).toFixed(2) + " ppm" : "N/A"
    }</p>
            <p><strong>Avgrage :</strong> ${
              exp.tdsAvg != null
                ? parseFloat(exp.tdsAvg).toFixed(2) + " ppm"
                : "N/A"
            } <strong>Median :</strong> ${
      exp.tdsMed != null ? parseFloat(exp.tdsMed).toFixed(2) + " ppm" : "N/A"
    }</p>
            <p><strong>Standard Deviation :</strong> ${
              exp.tdsSd != null ? parseFloat(exp.tdsSd).toFixed(2) + "" : "N/A"
            }</p>
            <p><strong>Coefficient of Variation :</strong> ${
              exp.tdsSd != null ? parseFloat(exp.tdsCv).toFixed(2) + "%" : "N/A"
            }</p>   

            <p><strong>-------------------- pH --------------------</strong></p>
            <p><strong>Min :</strong> ${
              exp.phMin != null ? parseFloat(exp.phMin).toFixed(2) + "" : "N/A"
            } <strong>Max:</strong> ${
      exp.phMax != null ? parseFloat(exp.phMax).toFixed(2) + "" : "N/A"
    }</p>
            <p><strong>Avgrage :</strong> ${
              exp.phAvg != null ? parseFloat(exp.phAvg).toFixed(2) + "" : "N/A"
            } <strong>Median :</strong> ${
      exp.phMed != null ? parseFloat(exp.phMed).toFixed(2) + "" : "N/A"
    }</p>
            <p><strong>Standard Deviation :</strong> ${
              exp.phSd != null ? parseFloat(exp.phSd).toFixed(2) + "" : "N/A"
            }</p>
            <p><strong>Coefficient of Variation :</strong> ${
              exp.phSd != null ? parseFloat(exp.phCv).toFixed(2) + "%" : "N/A"
            }</p> 
        `;

    if (modalChart) modalChart.destroy();
    const pondArchiveSheet = sheetIds[exp.pond];
    if (
      !pondArchiveSheet ||
      !exp.startDate ||
      !exp.startTime ||
      !exp.endDate ||
      !exp.endTime
    ) {
      console.error(
        "Experiment data is incomplete. Cannot generate chart.",
        exp
      );
      modal.style.display = "flex";
      return;
    }

    try {
      const rows = await fetchSheetData(pondArchiveSheet);

      // 🇹🇭 แก้ไข: เปลี่ยนวิธีอ่านวันที่ให้รองรับ YYYY-MM-DD
      const start_d_parts = exp.startDate.split("-"); // ใช้ - เป็นตัวแบ่ง
      const start_t_str = String(exp.startTime).split("-")[0].trim();
      const start_t_parts = start_t_str.split(":");
      // 🇹🇭 แก้ไข: เปลี่ยนลำดับเป็น (ปี, เดือน-1, วัน)
      const startDate = new Date(
        parseInt(start_d_parts[0]),
        parseInt(start_d_parts[1]) - 1,
        parseInt(start_d_parts[2]),
        parseInt(start_t_parts[0]),
        parseInt(start_t_parts[1])
      );

      const end_d_parts = exp.endDate.split("-"); // ใช้ - เป็นตัวแบ่ง
      const end_t_str = String(exp.endTime).split("-")[0].trim();
      const end_t_parts = end_t_str.split(":");
      // 🇹🇭 แก้ไข: เปลี่ยนลำดับเป็น (ปี, เดือน-1, วัน)
      const endDate = new Date(
        parseInt(end_d_parts[0]),
        parseInt(end_d_parts[1]) - 1,
        parseInt(end_d_parts[2]),
        parseInt(end_t_parts[0]),
        parseInt(end_t_parts[1])
      );

      const timeSeriesData = rows
        .map((r) => {
          try {
            // รูปแบบวันที่ในชีต Archive คือ DD/MM/YYYY จึงยังใช้ split('/') เหมือนเดิม
            const dateParts = r.c[0]?.f.split("/");
            const timeParts = r.c[1]?.v.split("-")[0].trim().split(":");
            if (!dateParts || !timeParts || dateParts.length < 3) return null;
            const pDate = new Date(
              parseInt(dateParts[2]),
              parseInt(dateParts[1]) - 1,
              parseInt(dateParts[0]),
              parseInt(timeParts[0]),
              parseInt(timeParts[1])
            );

            if (isNaN(pDate.getTime()) || pDate < startDate || pDate > endDate)
              return null;

            return {
              x: pDate,
              temp: parseFloat(r.c[3]?.v),
              ph: parseFloat(r.c[4]?.v),
              tds: parseFloat(r.c[5]?.v),
            };
          } catch {
            return null;
          }
        })
        .filter((p) => p);

      const datasets = [
        {
          label: " Temp",
          data: timeSeriesData.map((p) => ({ x: p.x, y: p.temp })),
          borderColor: "#A7226E",
          yAxisID: "yTemp",
          tension: 0.1,
          fill: false,
          pointBackgroundColor: "#A7226E",
        },

        {
          label: " pH",
          data: timeSeriesData.map((p) => ({ x: p.x, y: p.ph })),
          borderColor: "#F26B38",
          yAxisID: "yPh",
          tension: 0.1,
          fill: false,
          pointBackgroundColor: "#F26B38",
        },
        {
          label: " TDS",
          data: timeSeriesData.map((p) => ({ x: p.x, y: p.tds })),
          borderColor: "#F7DB4F",
          yAxisID: "yTds",
          tension: 0.1,
          fill: false,
          pointBackgroundColor: "#F7DB4F",
        },
      ];

      const options = {
        scales: {
          x: {
            // เพิ่มการตั้งค่าแกน X ให้ละเอียดขึ้น
            type: "time",
            time: {
              unit: "hour", // แสดงผลเป็นรายชั่วโมงเมื่อช่วงเวลาสั้น
              displayFormats: {
                hour: "MMM d, HH:mm",
              },
            },
          },
          yTemp: {
            type: "linear",
            position: "left",
            title: { display: true, text: "Temp (°C)" },
            ticks: { color: "#ef4444" },
            grid: { display: false },
          },
          yPh: {
            type: "linear",
            position: "right",
            title: { display: true, text: "pH" },
            ticks: { color: "#3b82f6" },
            grid: { display: false },
          },
          yTds: {
            type: "linear",
            position: "right",
            title: { display: true, text: "TDS (ppm)" },
            ticks: { color: "#f97316" },
            grid: { display: false },
          },
        },
      };
      modalChart = createChart("modalChartCanvas", datasets, options);
    } catch (error) {
      console.error("Error creating detail chart:", error);
      const canvas = document.getElementById("modalChartCanvas");
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    modal.style.display = "flex";
  }
  function closeModal() {
    document.getElementById("details-modal-overlay").style.display = "none";
  }

  // ============================
  //  INITIALIZATION
  // ============================
  function initialize() {
    function setupControlListeners(controlsId, updateFn) {
      document
        .querySelectorAll(`#${controlsId} .control-btn`)
        .forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const group = e.target.closest(".control-group");
            if (group) {
              group.querySelector(".active")?.classList.remove("active");
            }
            e.target.classList.add("active");
            updateFn();
          });
        });
    }

    setupControlListeners("pond-metric-controls", updatePondChart);
    setupControlListeners("pond-time-controls", updatePondChart);
    document.querySelectorAll("#pond-selector-controls input").forEach((cb) => {
      cb.addEventListener("change", updatePondChart);
    });

    setupControlListeners("greenhouse-metric-controls", updateGreenhouseChart);
    setupControlListeners("greenhouse-time-controls", updateGreenhouseChart);

    document
      .getElementById("modal-close-btn")
      .addEventListener("click", closeModal);
    document
      .getElementById("details-modal-overlay")
      .addEventListener("click", (e) => {
        if (e.target.id === "details-modal-overlay") {
          closeModal();
        }
      });

    updatePondChart();
    updateGreenhouseChart();
    loadExperimentsList();

    setInterval(() => {
      const clock = document.getElementById("currentTime");
      if (clock)
        clock.innerText = new Date().toLocaleTimeString("en-GB", {
          timeZone: "Asia/Bangkok",
        });
    }, 1000);
  }

  initialize();
});

