/**
 * @param {string} title
 * @param {string} message
 * @param {string} type
 */
function showToast(title, message, type = "success") {
  const toast = document.getElementById("toast-notification");
  const progress = toast.querySelector(".toast-progress");
  const icon = toast.querySelector(".toast-icon");

  toast.className = "toast active " + type;
  progress.style.animation = "none";
  void progress.offsetWidth;
  progress.style.animation = "progress 3s linear forwards";

  toast.querySelector(".toast-text-1").textContent = title;
  toast.querySelector(".toast-text-2").textContent = message;

  icon.textContent = type === "success" ? "✓" : "!";

  setTimeout(() => {
    toast.classList.remove("active");
  }, 3000);
}

let pondToDeleteId = null;
let pondToDeleteName = null;
let pondToEditId = null;
let actionToConfirm = null;

/**
 * @param {string} sequenceName
 * @param {number} timeout
 * @returns {Promise<void>}
 */
function waitForSequenceCompletion(sequenceName, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const startTime = Math.floor(Date.now() / 1000);
    const loopStartTime = Date.now();
    let hasLogCompleted = false;

    const intervalId = setInterval(async () => {
      if (Date.now() - loopStartTime > timeout) {
        clearInterval(intervalId);
        return reject(new Error(`Timeout: ${sequenceName} ยังทำงานไม่เสร็จ`));
      }

      try {
        const [logsRes, statusRes] = await Promise.all([
          fetch("/logs"),
          fetch("/api/mqtt_status"),
        ]);

        if (!logsRes.ok || !statusRes.ok) return;

        const logs = await logsRes.json();
        const status = await statusRes.json();

        if (!hasLogCompleted) {
          const successLog = logs.find(
            (log) =>
              log.message.includes(`Completed ${sequenceName}`) &&
              log.created_at >= startTime
          );
          if (successLog) {
            hasLogCompleted = true;
            if (
              document.getElementById("calibrate-status-modal").style
                .display === "flex"
            ) {
              updateCalibrateModal(`Log Completed... waiting For Idle`);
            }
          }
        }
        const axes = status.location_data?.axis_states;
        const isBotIdle =
          axes && axes.x === "idle" && axes.y === "idle" && axes.z === "idle";

        if (hasLogCompleted && isBotIdle) {
          clearInterval(intervalId);
          setTimeout(() => {
            resolve();
          }, 1500);
        }
      } catch (err) {
        console.warn("Could not fetch data, retrying...", err);
      }
    }, 2500);
  });
}

/**
 * @param {string} pondName
 * @returns {Promise<number|null>}
 */
async function getLatestPondTds(pondName) {
  try {
    const res = await fetch("/api/farmbot_data");
    const data = await res.json();
    const pondData = data.ponds.find((p) => p.name === pondName);
    return pondData ? pondData.tds : null;
  } catch (error) {
    console.error("Failed to get latest TDS:", error);
    return null;
  }
}

const calibrateModal = document.getElementById("calibrate-status-modal");
const calibrateModalTitle = document.getElementById("calibrate-modal-title");
const calibrateTargetTds = document.getElementById("calibrate-target-tds");
const calibrateRange = document.getElementById("calibrate-range");
const calibrateStatusText = document.getElementById("calibrate-status-text");
const calibrateLatestTds = document.getElementById("calibrate-latest-tds");
const calibrateSpinner = document.getElementById("calibrate-spinner");
function openCalibrateModal(pondName, targetTds, min, max) {
  calibrateModalTitle.textContent = ` Calibrate ${pondName}`;
  calibrateTargetTds.textContent = targetTds;
  calibrateRange.textContent = `${min} - ${max}`;
  calibrateStatusText.textContent = "Starting...";
  calibrateLatestTds.textContent = "N/A";
  calibrateSpinner.style.display = "block";
  calibrateModal.style.display = "flex";
}

function updateCalibrateModal(status, latestTds = null, showSpinner = true) {
  calibrateStatusText.textContent = status;
  if (latestTds !== null) {
    calibrateLatestTds.textContent = `${latestTds} ppm`;
  }
  calibrateSpinner.style.display = showSpinner ? "block" : "none";
}

function closeCalibrateModal() {
  calibrateModal.style.display = "none";
}

/**
 * @param {object} pond
 * @returns {Promise<number>}
 */
function getTdsFromModal(pond) {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById("tds-input-modal");
    const title = document.getElementById("tds-input-modal-title");
    const input = document.getElementById("tds-input-value");
    const confirmBtn = document.getElementById("start-calibrate-btn");
    const cancelBtn = document.getElementById("cancel-tds-input-btn");
    const cleanup = () => {
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modal.style.display = "none";
    };

    const onConfirm = () => {
      const value = parseFloat(input.value);
      if (isNaN(value) || value <= 0) {
        showToast(
          "ข้อมูลไม่ถูกต้อง",
          "กรุณาใส่ค่า TDS ที่เป็นตัวเลขบวก",
          "error"
        );
        return;
      }
      cleanup();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      reject(new Error("ผู้ใช้ยกเลิก"));
    };

    title.textContent = `Calibrate TDS For ${pond.name}`;
    input.value = "";
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modal.style.display = "flex";
    input.focus();
  });
}

async function handleManualCalibrate(pond) {
  try {
    const targetTds = await getTdsFromModal(pond);
    const POND_NAME = pond.name;
    const ACCEPTABLE_MIN = targetTds - 5;
    const ACCEPTABLE_MAX = targetTds + 50;

    const runAndWait = async (step) => {
      const sequenceName = `Calibrate TDS STEP ${step} ${POND_NAME}`;
      const sequencesRes = await fetch("/api/sequences_all");
      const sequences = await sequencesRes.json();
      const targetSequence = sequences.find((seq) => seq.name === sequenceName);
      if (!targetSequence) throw new Error(`ไม่พบ Sequence: "${sequenceName}"`);

      const executeRes = await fetch(
        `/api/sequences/execute/${targetSequence.id}`,
        { method: "POST" }
      );
      if (!executeRes.ok)
        throw new Error(`ไม่สามารถรัน Sequence "${sequenceName}" ได้`);

      await waitForSequenceCompletion(sequenceName);
    };

    openCalibrateModal(POND_NAME, targetTds, ACCEPTABLE_MIN, ACCEPTABLE_MAX);
    try {
      await updateDashboard();
      updateCalibrateModal(`Step 1: Move To ${POND_NAME}...`);
      await runAndWait(1);

      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        attempts++;
        updateCalibrateModal(`Step 2 : Measure TDS (Time ${attempts})...`);
        await runAndWait(2);
        updateCalibrateModal(`Waiting for TDS Sensor... (Time${attempts})`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const measuredTds = await getLatestPondTds(POND_NAME);
        if (measuredTds === null)
          throw new Error("Can not get TDS From Sheet ");
        updateCalibrateModal(`Checking TDS Process...`, measuredTds);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (measuredTds >= ACCEPTABLE_MIN && measuredTds <= ACCEPTABLE_MAX) {
          updateCalibrateModal(`Success TDS is acceptable`, measuredTds, false);
          break;
        } else {
          updateCalibrateModal(
            `Step 3 : Unexceptable Push more Weed`,
            measuredTds
          );
          await runAndWait(3);
        }
      }
      if (attempts >= maxAttempts) {
        throw new Error("TDS is Time Out");
      }
      const finalTds = await getLatestPondTds(POND_NAME);
      updateCalibrateModal(`Step 4 : Back to point`, finalTds);
      await runAndWait(4);

      updateCalibrateModal(`Calibrate ${POND_NAME} Success!`, finalTds, false);
      await updateDashboard();
    } catch (error) {
      console.error("Manual Calibration Failed:", error);
      const lastKnownTds = await getLatestPondTds(POND_NAME);
      updateCalibrateModal(`Fail: ${error.message}`, lastKnownTds, false);
    }
  } catch (error) {
    console.log("Cancel Calibrate:", error.message);
  }
}

function showConfirmModal(title, text, onConfirmCallback) {
  document.getElementById("confirm-modal-title").textContent = title;
  document.getElementById("confirm-modal-text").textContent = text;
  actionToConfirm = onConfirmCallback;
  document.getElementById("confirm-action-modal").style.display = "flex";
}

function closeConfirmModal() {
  document.getElementById("confirm-action-modal").style.display = "none";
  actionToConfirm = null;
}

function deletePond(id, name) {
  pondToDeleteId = id;
  pondToDeleteName = name;
  const modal = document.getElementById("delete-pond-modal");
  const modalText = document.getElementById("delete-modal-text");
  modalText.innerHTML = `แน่ใจไหมว่าต้องการลบ <b>${pondToDeleteName}</b>
   และซีเควนซ์ที่เกี่ยวข้องทั้งหมด? <br><br>การกระทำนี้ไม่สามารถย้อนกลับได้!!!!!!!!!!<br>
   การกระทำนี้ไม่สามารถย้อนกลับได้!!!!!!!!!!<br>การกระทำนี้ไม่สามารถย้อนกลับได้!!!!!!!!!!<br>
   การกระทำนี้ไม่สามารถย้อนกลับได้!!!!!!!!!!`;
  document.getElementById("delete-loading").style.display = "none";
  document.getElementById("delete-modal-actions").style.display = "flex";
  modal.style.display = "flex";
}

function closeDeleteModal() {
  const modal = document.getElementById("delete-pond-modal");
  modal.style.display = "none";
  pondToDeleteId = null;
  pondToDeleteName = null;
}

async function executeDelete() {
  if (!pondToDeleteId) return;
  const deletedPondName = pondToDeleteName;
  document.getElementById("delete-loading").style.display = "block";
  document.getElementById("delete-modal-actions").style.display = "none";

  try {
    const res = await fetch(`/api/ponds/${pondToDeleteId}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) {
      const errorData = await res.json();
      throw new Error(errorData.error || "Server returned an error.");
    }
    await updateDashboard();
    closeDeleteModal();
    showToast("Success", `Deleted ${deletedPondName} success`, "success");
  } catch (error) {
    showToast("เกิดข้อผิดพลาด", error.message, "error");
    console.error("Error during pond deletion:", error);
    document.getElementById("delete-loading").style.display = "none";
    document.getElementById("delete-modal-actions").style.display = "flex";
  }
}

const uiElements = {
  farmbotX: null,
  farmbotY: null,
  farmbotZ: null,
  cpuTemp: null,
  cpuMemo: null,
  wifiStr: null,
  farmbotUptime: null,
  manualX: null,
  manualY: null,
  manualZ: null,
  peripheralToggles: {},
};

function updateTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour12: false,
  });
  document.getElementById("currentTime").innerText = timeStr;
  document.getElementById("time-stamp").innerText = timeStr;
}

function openEditPondModal(pond) {
  pondToEditId = pond.id;
  const modal = document.getElementById("edit-pond-modal");
  document.getElementById(
    "edit-modal-title"
  ).textContent = `Edit Pond ${pond.name}`;
  document.getElementById("edit-pond-x-input").value = pond.x;
  document.getElementById("edit-pond-y-input").value = pond.y;
  document.getElementById("edit-include-measure-all").checked =
    pond.includeInMeasureAll;
  document.getElementById("edit-pond-form-content").style.display = "block";
  document.getElementById("edit-loading").style.display = "none";
  document.getElementById("edit-modal-actions").style.display = "flex";
  modal.style.display = "flex";
}

function closeEditPondModal() {
  document.getElementById("edit-pond-modal").style.display = "none";
  pondToEditId = null;
}

async function handleEditFormSubmit(event) {
  event.preventDefault();
  if (!pondToEditId) return;
  const formContent = document.getElementById("edit-pond-form-content");
  const loadingIndicator = document.getElementById("edit-loading");
  const modalActions = document.getElementById("edit-modal-actions");
  formContent.style.display = "none";
  modalActions.style.display = "none";
  loadingIndicator.style.display = "block";

  const newX = document.getElementById("edit-pond-x-input").value;
  const newY = document.getElementById("edit-pond-y-input").value;
  const newInclude = document.getElementById(
    "edit-include-measure-all"
  ).checked;

  try {
    const res = await fetch(`/api/ponds/${pondToEditId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x: parseFloat(newX),
        y: parseFloat(newY),
        includeInMeasureAll: newInclude,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    await updateDashboard();
    closeEditPondModal();
    showToast("สำเร็จ", `บันทึกข้อมูลเรียบร้อยแล้ว`, "success");
  } catch (error) {
    showToast("เกิดข้อผิดพลาด", "ไม่สามารถบันทึกข้อมูลได้", "error");
    console.error(error);
    formContent.style.display = "block";
    modalActions.style.display = "flex";
    loadingIndicator.style.display = "none";
  }
}

async function handleRunMovePond(pond) {
  showConfirmModal(
    `Confirm "Move ${pond.name}"`,
    `Do you want to run the sequence Move ${pond.name}?`,
    async () => {
      try {
        showToast(
          "กำลังค้นหา",
          `Searching for sequence "Move ${pond.name}"...`
        );
        const sequencesRes = await fetch("/api/sequences_all");
        const sequences = await sequencesRes.json();
        const targetSequence = sequences.find(
          (seq) => seq.name === `Move ${pond.name}`
        );

        if (!targetSequence) {
          throw new Error(`Sequence "Move ${pond.name}" not found.`);
        }
        const executeRes = await fetch(
          `/api/sequences/execute/${targetSequence.id}`,
          { method: "POST" }
        );
        if (!executeRes.ok) {
          const errorData = await executeRes.json();
          throw new Error(errorData.error || "Failed to start the sequence.");
        }
        showToast(
          "สำเร็จ",
          `Sent command to run "Move ${pond.name}".`,
          "success"
        );
      } catch (error) {
        console.error("Error running move sequence:", error);
        showToast("เกิดข้อผิดพลาด", error.message, "error");
      }
    }
  );
}

async function loadEvents() {
  try {
    const [eventRes, sequencesRes] = await Promise.all([
      fetch("/api/farm_events"),
      fetch("/api/sequences"),
    ]);
    if (!eventRes.ok || !sequencesRes.ok) {
      throw new Error("Failed to fetch data for events.");
    }
    const eventData = await eventRes.json();
    const sequencesData = await sequencesRes.json();
    const sequenceMap = {};
    sequencesData.forEach((seq) => {
      sequenceMap[seq.id] = { name: seq.name, color: seq.color };
    });
    const expandedEvents = [];
    eventData.forEach((ev) => {
      if (!ev.executable_id || !ev.start_time) return;
      const start = new Date(ev.start_time);
      const end = ev.end_time
        ? new Date(ev.end_time)
        : new Date(start.getTime() + 86400000);
      const repeat = ev.repeat || 0;
      const timeUnit = ev.time_unit;
      let increment = 0;
      if (timeUnit === "minutely") increment = repeat * 60 * 1000;
      else if (timeUnit === "hourly") increment = repeat * 3600 * 1000;
      else if (timeUnit === "daily") increment = repeat * 86400 * 1000;
      else if (timeUnit === "weekly") increment = repeat * 7 * 86400 * 1000;
      if (repeat === 0 || increment === 0 || timeUnit === "never") {
        expandedEvents.push({ ...ev, instance_time: start.toISOString() });
      } else {
        let pointer = start.getTime();
        for (let i = 0; pointer <= end.getTime() && i < 100; i++) {
          expandedEvents.push({
            ...ev,
            instance_time: new Date(pointer).toISOString(),
          });
          pointer += increment;
        }
      }
    });
    const nowTime = new Date();
    const upcoming = expandedEvents
      .filter((ev) => new Date(ev.instance_time) >= nowTime)
      .sort((a, b) => new Date(a.instance_time) - new Date(b.instance_time))
      .slice(0, 2);
    const container = document.querySelector(".no-events");
    const template = document.getElementById("event-template");
    container.innerHTML = "";
    if (upcoming.length === 0) {
      container.innerHTML =
        '<div style="text-align: center; padding: 10px;">No upcoming events.</div>';
      return;
    }
    upcoming.forEach((ev) => {
      const clone = template.content.cloneNode(true);
      const d = new Date(ev.instance_time);
      const dateStr = d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const timeStr = d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const sequenceInfo = sequenceMap[ev.executable_id] || {};
      const eventName =
        ev.sequence_message ||
        ev.sequence_label ||
        sequenceInfo.name ||
        "Unnamed Event";
      clone.querySelector(
        ".event-datetime"
      ).innerHTML = `<b>${dateStr}</b> ${timeStr}`;
      clone.querySelector(".event-label").textContent = eventName;
      const eventWrapper = clone.querySelector(".event-row-wrapper");
      if (sequenceInfo.color) {
        eventWrapper.classList.add(`event-color-${sequenceInfo.color}`);
      }
      container.appendChild(clone);
    });
  } catch (err) {
    console.error("Failed to load events for dashboard:", err);
    const container = document.querySelector(".no-events");
    if (container)
      container.innerHTML =
        '<div style="text-align: center; padding: 10px; color: red;">Error loading events.</div>';
  }
}

let nextPondNameToCreate = "";
async function addPond() {
  const modal = document.getElementById("add-pond-modal");
  const nameDisplay = document.getElementById("auto-pond-name");
  document.getElementById("add-pond-form-content").style.display = "block";
  document.getElementById("add-loading").style.display = "none";
  document.getElementById("add-modal-actions").style.display = "flex";
  nameDisplay.textContent = "Loading Name........";
  modal.style.display = "flex";
  try {
    const pondsResponse = await fetch("/api/points");
    const points = await pondsResponse.json();
    const pondPoints = points.filter((p) => /^Pond \d+$/i.test(p.name));
    const nextPondNum = pondPoints.length + 1;
    nextPondNameToCreate = `Pond ${nextPondNum}`;
    nameDisplay.textContent = nextPondNameToCreate;
  } catch (error) {
    showToast("เกิดข้อผิดพลาด", "ไม่สามารถโหลดข้อมูลบ่อได้", "error");
    console.error("Failed to fetch points for next pond name:", error);
    closePondModal();
  }
}

async function handleRunMeasurePond(pond) {
  showConfirmModal(
    `Confirm Measure "${pond.name}"`,
    `Do you want to run the sequence Measure ${pond.name}?`,
    async () => {
      try {
        showToast(
          "Searching",
          `Searching for sequence "Measure ${pond.name}"...`
        );
        const sequencesRes = await fetch("/api/sequences_all");
        const sequences = await sequencesRes.json();
        const targetSequence = sequences.find(
          (seq) => seq.name === `Measure ${pond.name}`
        );
        if (!targetSequence) {
          throw new Error(`Sequence "Measure ${pond.name}" not found.`);
        }
        const executeRes = await fetch(
          `/api/sequences/execute/${targetSequence.id}`,
          { method: "POST" }
        );
        if (!executeRes.ok) {
          const errorData = await executeRes.json();
          throw new Error(errorData.error || "Failed to start the sequence.");
        }
        showToast(
          "success",
          `Sent command to run "Measure ${pond.name}".`,
          "success"
        );
      } catch (error) {
        console.error("Error running measure sequence:", error);
        showToast("เกิดข้อผิดพลาด", error.message, "error");
      }
    }
  );
}

/**
 * @param {object} pond
 * @returns {Promise<number>}
 */
function getWeedAmountFromModal(pond) {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById("weed-input-modal");
    const title = document.getElementById("weed-input-modal-title");
    const input = document.getElementById("weed-input-value");
    const confirmBtn = document.getElementById("start-weed-btn");
    const cancelBtn = document.getElementById("cancel-weed-input-btn");

    const cleanup = () => {
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modal.style.display = "none";
    };

    const onConfirm = () => {
      const value = parseFloat(input.value);
      if (isNaN(value) || value <= 0) {
        showToast("ข้อมูลไม่ถูกต้อง", "กรุณาใส่ปริมาณเป็นตัวเลขบวก", "error");
        return;
      }
      cleanup();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      reject(new Error("ผู้ใช้ยกเลิกการให้ปุ๋ย"));
    };

    title.textContent = `ให้ปุ๋ย ${pond.name}`;
    input.value = "";
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modal.style.display = "flex";
    input.focus();
  });
}

/**
 * @param {object} pond
 */
async function handleWeedPond(pond) {
  try {
    const amountMl = await getWeedAmountFromModal(pond);
    const delayMs = amountMl * 100;
    showToast("กำลังดำเนินการ", `เตรียมให้ปุ๋ย ${pond.name}`, "success");
    const res = await fetch("/api/sequences/weed-pond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pondName: pond.name,
        delay: delayMs,
      }),
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || "ไม่สามารถสั่งให้ปุ๋ยได้");
    }
    const result = await res.json();
    showToast("สำเร็จ", result.message, "success");
  } catch (error) {
    if (error.message !== "ผู้ใช้ยกเลิกการให้ปุ๋ย") {
      showToast("เกิดข้อผิดพลาด", error.message, "error");
    }
    console.error("Fertilizer process failed:", error);
  }
}

function closePondModal() {
  const modal = document.getElementById("add-pond-modal");
  const form = document.getElementById("add-pond-form");
  form.reset();
  modal.style.display = "none";
}

async function runAllSequence() {
  const selectedPonds = [];
  document.querySelectorAll(".measure-checkbox:checked").forEach((checkbox) => {
    const pondName = checkbox.closest(".pond-card").dataset.name;
    selectedPonds.push(pondName);
  });
  if (selectedPonds.length === 0)
    return alert("Please select at least one pond to measure.");
  if (
    !confirm(
      `This will run the measure sequence for:\n\n- ${selectedPonds.join(
        "\n- "
      )}\n\nContinue?`
    )
  )
    return;
  try {
    const response = await fetch("/api/sequences/execute-measure-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_pond_names: selectedPonds }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to start the sequence.");
    }
    const result = await response.json();
    alert(result.message);
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

async function updateDashboard() {
  try {
    const [farmbotDataRes, logsRes, farmbotStatusRes, greenhouseRes] =
      await Promise.all([
        fetch("/api/farmbot_data"),
        fetch("/logs"),
        fetch("/api/mqtt_status"),
        fetch("/api/greenhouse"),
      ]);

    if (greenhouseRes.ok) {
      const greenhouse = await greenhouseRes.json();
      document.getElementById("greenhouse-temp").textContent =
        greenhouse.tempDht !== null ? greenhouse.tempDht + " °C" : "--";
      document.getElementById("greenhouse-humidity").textContent =
        greenhouse.humidity !== null ? greenhouse.humidity + " %" : "--";
      document.getElementById("greenhouse-lux").textContent =
        greenhouse.lux !== null ? greenhouse.lux + " lux" : "--";
    }

    if (farmbotStatusRes.ok) {
      const data = await farmbotStatusRes.json();
      const pos = data.location_data?.position;
      document.getElementById("farmbot-x").textContent =
        pos?.x !== null ? pos.x.toFixed(1) + " mm" : "--";
      document.getElementById("farmbot-y").textContent =
        pos?.y !== null ? pos.y.toFixed(1) + " mm" : "--";
      document.getElementById("farmbot-z").textContent =
        pos?.z !== null ? pos.z.toFixed(1) + " mm" : "--";
      document.getElementById("cpu-temp").textContent =
        data.informational_settings?.soc_temp !== null
          ? data.informational_settings.soc_temp + " °C"
          : "--";
      document.getElementById("cpu-memo").textContent =
        data.informational_settings?.memory_usage !== null
          ? data.informational_settings.memory_usage + " %"
          : "--";
      document.getElementById("wifi-str").textContent =
        data.informational_settings?.wifi_level_percent !== null
          ? data.informational_settings.wifi_level +
            " dBm " +
            "  " +
            data.informational_settings.wifi_level_percent +
            " %"
          : "--";
      document.getElementById("farmbot-uptime").textContent =
        data.informational_settings?.uptime != null
          ? `${Math.floor(
              data.informational_settings.uptime / 86400
            )}D : ${Math.floor(
              (data.informational_settings.uptime % 86400) / 3600
            )}H : ${Math.floor(
              (data.informational_settings.uptime % 3600) / 60
            )}M`
          : "--";
      document.getElementById("manual-x").placeholder =
        pos?.x !== null ? `${pos.x.toFixed(0)}` : "X coordinate";
      document.getElementById("manual-y").placeholder =
        pos?.y !== null ? `${pos.y.toFixed(0)}` : "Y coordinate";
      document.getElementById("manual-z").placeholder =
        pos?.z !== null ? `${pos.z.toFixed(0)}` : "Z coordinate";
    }

    if (logsRes.ok) {
      const logsData = await logsRes.json();
      const logsContent = document.getElementById("logs-content");
      logsContent.innerHTML = "";
      logsData.slice(0, 5).forEach((log) => {
        const coords = `(${log.x || 0}, ${log.y || 0}, ${log.z || 0})`;
        const time = new Date(log.created_at * 1000).toLocaleTimeString(
          "en-GB",
          { hour: "2-digit", minute: "2-digit" }
        );
        logsContent.innerHTML += `<div class="log-entry">${time} ${coords} ${log.message}</div>`;
      });
    }

    if (farmbotDataRes.ok) {
      const { ponds } = await farmbotDataRes.json();
      const pondsGrid = document.getElementById("ponds-grid");
      const pondTemplate = document.getElementById("pond-card-template");
      pondsGrid.innerHTML = "";
      ponds.forEach((pond) => {
        const clone = pondTemplate.content.cloneNode(true);
        const pondCard = clone.querySelector(".pond-card");
        pondCard.dataset.pointId = pond.id;
        pondCard.dataset.name = pond.name;
        clone.querySelector(".card-title").textContent = pond.name;
        const lastCheckedEl = clone.querySelector(".last-checked-time");
        if (pond.lastChecked) {
          const date = new Date(pond.lastChecked);
          const timeString = date.toLocaleTimeString("en-GB", {
            hour12: false,
          });
          lastCheckedEl.textContent = `Last Measure ${timeString}`;
        } else {
          lastCheckedEl.textContent = "";
        }
        clone.querySelector(".pond-x").textContent = `${pond.x ?? "--"} mm`;
        clone.querySelector(".pond-y").textContent = `${pond.y ?? "--"} mm`;
        clone.querySelector(".pond-temp").textContent = `${
          pond.temp ?? "--"
        } °C`;
        clone.querySelector(".pond-tds").textContent = `${
          pond.tds ?? "--"
        } ppm`;
        clone.querySelector(".pond-ph").textContent = `${pond.ph ?? "--"}`;
        clone
          .querySelector(".edit")
          .addEventListener("click", () => openEditPondModal(pond));
        clone
          .querySelector(".delete")
          .addEventListener("click", () => deletePond(pond.id, pond.name));
        clone
          .querySelector(".run-sequence-btn")
          .addEventListener("click", () => handleRunMeasurePond(pond));
        clone
          .querySelector(".run-move-btn")
          .addEventListener("click", () => handleRunMovePond(pond));
        const calibBtn = clone.querySelector(".run-calibrate-btn");
        if (calibBtn) {
          calibBtn.addEventListener("click", () => handleManualCalibrate(pond));
        }
        clone
          .querySelector(".run-weed-btn")
          .addEventListener("click", () => handleWeedPond(pond));
        pondsGrid.appendChild(clone);
      });
    }
  } catch (err) {
    console.error("Failed to update dashboard:", err);
  }
}

async function findHome() {
  showConfirmModal(
    'Confirm "Find Home"',
    "Do you want to run Find Home on all axes?",
    async () => {
      try {
        await fetch("/api/find_home", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ axis: "all", speed: 100 }),
        });
        showToast(
          "สำเร็จ",
          "ส่งคำสั่ง Find Home ไปยัง FarmBot แล้ว",
          "success"
        );
      } catch (error) {
        showToast(
          "เกิดข้อผิดพลาด",
          "ไม่สามารถส่งคำสั่ง Find Home ได้",
          "error"
        );
      }
    }
  );
}

async function manualGo() {
  const xInput = document.getElementById("manual-x");
  const yInput = document.getElementById("manual-y");
  const zInput = document.getElementById("manual-z");
  const payload = {};
  if (xInput.value !== "") payload.x = parseFloat(xInput.value);
  if (yInput.value !== "") payload.y = parseFloat(yInput.value);
  if (zInput.value !== "") payload.z = parseFloat(zInput.value);
  if (Object.keys(payload).length === 0) {
    return showToast(
      "ข้อมูลไม่ครบ",
      "กรุณาใส่ค่าตำแหน่งอย่างน้อย 1 แกน",
      "error"
    );
  }
  try {
    await fetch("/api/move_absolute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    xInput.value = "";
    yInput.value = "";
    zInput.value = "";
  } catch (error) {
    showToast("เกิดข้อผิดพลาด", "ไม่สามารถส่งคำสั่ง Move ได้", "error");
  }
}
async function updatePeripherals() {
  try {
    const pinsToShow = [10, 65, 44]; // < ใส่เลข Pin ของคุณในวงเล็บนี้
    const res = await fetch("/api/peripherals");
    if (!res.ok) return;
    const allPeripherals = await res.json();
    const container = document.getElementById("peripherals-container");
    const template = document.getElementById("peripheral-row-template");
    if (!container || !template) return;
    container.innerHTML = "";
    const filteredPeripherals = allPeripherals.filter((p) =>
      pinsToShow.includes(p.pin)
    );
    filteredPeripherals.forEach((p) => {
      if (p) {
        const clone = template.content.cloneNode(true);
        clone.querySelector(".semi-label").textContent = p.label;
        const toggleInput = clone.querySelector(".peripheral-toggle");
        toggleInput.checked = p.value === 1;
        toggleInput.dataset.pin = p.pin;
        container.appendChild(clone);
      }
    });

    document
      .querySelectorAll(".peripheral-toggle:not([data-listener-attached])")
      .forEach((toggle) => {
        toggle.addEventListener("change", handlePeripheralToggle);
        toggle.setAttribute("data-listener-attached", "true");
      });
  } catch (err) {
    console.error("Failed to update peripherals:", err);
  }
}

async function handlePeripheralToggle(e) {
  const toggleInput = e.target;
  const switchLabel = toggleInput.closest(".switch");
  const pin = toggleInput.dataset.pin;
  const value = toggleInput.checked ? 1 : 0;
  switchLabel.classList.add("is-loading");
  toggleInput.disabled = true;
  try {
    await fetch("/api/peripheral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: parseInt(pin), value }),
    });
  } catch (err) {
    console.error(`Failed to toggle pin ${pin}:`, err);
    toggleInput.checked = !toggleInput.checked;
  } finally {
    setTimeout(() => {
      switchLabel.classList.remove("is-loading");
      toggleInput.disabled = false;
    }, 3000);
  }
}

function cacheDOMElements() {
  uiElements.farmbotX = document.getElementById("farmbot-x");
  uiElements.farmbotY = document.getElementById("farmbot-y");
  uiElements.farmbotZ = document.getElementById("farmbot-z");
  uiElements.cpuTemp = document.getElementById("cpu-temp");
  uiElements.cpuMemo = document.getElementById("cpu-memo");
  uiElements.wifiStr = document.getElementById("wifi-str");
  uiElements.farmbotUptime = document.getElementById("farmbot-uptime");
  uiElements.manualX = document.getElementById("manual-x");
  uiElements.manualY = document.getElementById("manual-y");
  uiElements.manualZ = document.getElementById("manual-z");
  document.querySelectorAll(".peripheral-toggle").forEach((toggle) => {
    const pin = toggle.dataset.pin;
    if (pin) uiElements.peripheralToggles[pin] = toggle;
  });
}

function updateStatusData(data) {
  const pos = data.location_data?.position;
  const info = data.informational_settings;
  const pins = data.pins || {};

  if (uiElements.farmbotX)
    uiElements.farmbotX.textContent =
      pos?.x !== null ? pos.x.toFixed(1) + " mm" : "--";
  if (uiElements.farmbotY)
    uiElements.farmbotY.textContent =
      pos?.y !== null ? pos.y.toFixed(1) + " mm" : "--";
  if (uiElements.farmbotZ)
    uiElements.farmbotZ.textContent =
      pos?.z !== null ? pos.z.toFixed(1) + " mm" : "--";
  if (uiElements.cpuTemp)
    uiElements.cpuTemp.textContent =
      info?.soc_temp !== null ? info.soc_temp + " °C" : "--";
  if (uiElements.cpuMemo)
    uiElements.cpuMemo.textContent =
      info?.memory_usage !== null ? info.memory_usage + " %" : "--";
  if (uiElements.wifiStr)
    uiElements.wifiStr.textContent =
      info?.wifi_level_percent !== null
        ? info.wifi_level + " dBm" + "  " + info.wifi_level_percent + " %"
        : "--";
  if (uiElements.farmbotUptime)
    uiElements.farmbotUptime.textContent =
      info?.uptime != null
        ? `${Math.floor(info.uptime / 86400)}D : ${Math.floor(
            (info.uptime % 86400) / 3600
          )}H : ${Math.floor((info.uptime % 3600) / 60)}M  `
        : "--";
  if (uiElements.manualX)
    uiElements.manualX.placeholder =
      pos?.x !== null ? `${pos.x.toFixed(0)}` : "X coordinate";
  if (uiElements.manualY)
    uiElements.manualY.placeholder =
      pos?.y !== null ? `${pos.y.toFixed(0)}` : "Y coordinate";
  if (uiElements.manualZ)
    uiElements.manualZ.placeholder =
      pos?.z !== null ? `${pos.z.toFixed(0)}` : "Z coordinate";

  for (const pin in uiElements.peripheralToggles) {
    const toggleElement = uiElements.peripheralToggles[pin];
    if (pins[pin]) {
      const newState = pins[pin].value === 1;
      if (toggleElement.checked !== newState) {
        toggleElement.checked = newState;
      }
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const addPondModal = document.getElementById("add-pond-modal");
  const addPondForm = document.getElementById("add-pond-form");
  const cancelAddPondBtn = document.getElementById("cancel-pond-btn");

  document
    .getElementById("close-calibrate-modal")
    .addEventListener("click", closeCalibrateModal);
  document
    .getElementById("force-close-calibrate-btn")
    .addEventListener("click", closeCalibrateModal);

  document.getElementById("add-pond-btn")?.addEventListener("click", addPond);
  cancelAddPondBtn.addEventListener("click", closePondModal);
  addPondModal.addEventListener("click", (e) => {
    if (e.target === addPondModal) closePondModal();
  });

  addPondForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formContent = document.getElementById("add-pond-form-content");
    const loadingIndicator = document.getElementById("add-loading");
    const modalActions = document.getElementById("add-modal-actions");
    formContent.style.display = "none";
    modalActions.style.display = "none";
    loadingIndicator.style.display = "block";
    const x = document.getElementById("pond-x-input").value;
    const y = document.getElementById("pond-y-input").value;
    const pondNameToCreate = nextPondNameToCreate;
    if (pondNameToCreate === "" || x === "" || y === "") {
      showToast("ข้อมูลไม่ครบถ้วน", "กรุณากรอกข้อมูลให้ครบ", "error");
      formContent.style.display = "block";
      modalActions.style.display = "flex";
      loadingIndicator.style.display = "none";
      return;
    }
    try {
      const res = await fetch("/api/ponds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pondNameToCreate,
          x: parseFloat(x),
          y: parseFloat(y),
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Server returned an error.");
      }
      loadEvents();
      await updateDashboard();
      closePondModal();
      showToast(
        "สำเร็จ",
        `สร้าง '${pondNameToCreate}' เรียบร้อยแล้ว`,
        "success"
      );
    } catch (error) {
      showToast("เกิดข้อผิดพลาด", error.message, "error");
      console.error(error);
      formContent.style.display = "block";
      modalActions.style.display = "flex";
      loadingIndicator.style.display = "none";
    }
  });

  const deletePondModal = document.getElementById("delete-pond-modal");
  document
    .getElementById("cancel-delete-btn")
    .addEventListener("click", closeDeleteModal);
  document
    .getElementById("confirm-delete-btn")
    .addEventListener("click", executeDelete);
  deletePondModal.addEventListener("click", (e) => {
    if (e.target === deletePondModal) closeDeleteModal();
  });

  document.getElementById("find-home-btn")?.addEventListener("click", findHome);
  document.getElementById("manual-go-btn")?.addEventListener("click", manualGo);

  updateTime();
  loadEvents();
  updateDashboard();
  updatePeripherals().then(() => {
    cacheDOMElements();
  });

  const eventSource = new EventSource("/api/stream-status");
  eventSource.onmessage = function (event) {
    const newStatusData = JSON.parse(event.data);
    updateStatusData(newStatusData);
  };
  eventSource.onerror = function (err) {
    console.error("EventSource failed:", err);
  };

  const editPondModal = document.getElementById("edit-pond-modal");
  const editPondForm = document.getElementById("edit-pond-form");
  document
    .getElementById("cancel-edit-btn")
    .addEventListener("click", closeEditPondModal);
  editPondForm.addEventListener("submit", handleEditFormSubmit);
  editPondModal.addEventListener("click", (e) => {
    if (e.target === editPondModal) closeEditPondModal();
  });

  const confirmModal = document.getElementById("confirm-action-modal");
  document
    .getElementById("cancel-confirm-btn")
    .addEventListener("click", closeConfirmModal);
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) closeConfirmModal();
  });
  document
    .getElementById("confirm-action-btn")
    .addEventListener("click", () => {
      if (typeof actionToConfirm === "function") {
        actionToConfirm();
      }
      closeConfirmModal();
    });

  setInterval(updateTime, 1000);
  setInterval(loadEvents, 60000);
  setInterval(updateDashboard, 15000);
});
