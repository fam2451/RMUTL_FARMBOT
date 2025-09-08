function updateTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour12: false,
  });
  const timeElem = document.getElementById("currentTime");
  if (timeElem) timeElem.innerText = timeStr;
}

async function refreshFullLogs() {
  const target = document.getElementById("logs-full-content");
  if (!target) return;
  target.innerHTML = "Loading...";
  try {
    const res = await fetch("/logs/all");
    if (!res.ok) throw new Error("Cannot load logs");
    const logs = await res.json();
    target.innerHTML = "";
    if (!logs || logs.length === 0) {
      target.innerHTML = "<em>ไม่พบ log</em>";
      return;
    }
    logs.forEach((log) => {
      const entry = document.createElement("div");
      entry.className = "log-full-entry";
      const time = document.createElement("span");
      time.className = "log-time";
      time.textContent = log.created_at_thai;
      const message = document.createElement("span");
      message.className = "log-message";
      message.textContent = log.message;
      entry.appendChild(time);
      entry.appendChild(document.createTextNode("   |   "));
      entry.appendChild(message);
      target.appendChild(entry);
    });
  } catch (e) {
    target.innerHTML = `<span style="color:red">${e.message}</span>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("refresh-logs-btn");
  if (btn) btn.onclick = refreshFullLogs;

  refreshFullLogs();
  setInterval(updateTime, 1000);
  updateTime();
});
