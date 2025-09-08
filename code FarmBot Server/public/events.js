let peripheralIdMap = {},
  sequenceIdMap = {},
  pointIdMap = {},
  toolIdMap = {};

document.addEventListener("DOMContentLoaded", async () => {
  await initializeMaps();
  loadAllEvents();
  renderCalendar();
  initializeNotes();

  const modal = document.getElementById("event-modal");
  document
    .getElementById("modal-close-btn")
    .addEventListener("click", () => (modal.style.display = "none"));
  modal.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay"))
      modal.style.display = "none";
  });

  setInterval(updateTime, 1000);
  updateTime();
});

async function initializeMaps() {
  try {
    const responses = await Promise.all([
      fetch("/api/peripherals_all"),
      fetch("/api/sequences_all"),
      fetch("/api/points_all"),
      fetch("/api/tools_all"),
    ]);
    for (const res of responses) {
      if (!res.ok) throw new Error("Failed to fetch initial data maps");
    }
    const [peripherals, sequences, points, tools] = await Promise.all(
      responses.map((res) => res.json())
    );
    peripherals.forEach((p) => {
      peripheralIdMap[p.id] = p.label;
    });
    sequences.forEach((s) => {
      sequenceIdMap[s.id] = { name: s.name, color: s.color };
    });
    points.forEach((p) => {
      pointIdMap[p.id] = p;
    });
    tools.forEach((t) => {
      toolIdMap[t.id] = t.name || `Tool Slot ${t.id}`;
    });
    console.log("✅ All data maps initialized.");
  } catch (error) {
    console.error("❌ Failed to initialize data maps:", error);
  }
}
function updateTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour12: false,
  });
  const timeEl = document.getElementById("currentTime");
  if (timeEl) timeEl.innerText = timeStr;
}
function expandAndSortEvents(rawEvents) {
  const expandedEvents = [];
  const now = new Date();
  rawEvents.forEach((event) => {
    if (!event.executable_id || !event.start_time) return;
    const startTime = new Date(event.start_time);
    const endTime = event.end_time
      ? new Date(event.end_time)
      : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    const repeat = event.repeat || 0;
    const timeUnit = event.time_unit;
    if (repeat === 0 || !timeUnit || timeUnit === "never") {
      expandedEvents.push({ ...event, instance_time: startTime.toISOString() });
      return;
    }
    let increment = 0;
    switch (timeUnit) {
      case "minutely":
        increment = repeat * 60 * 1000;
        break;
      case "hourly":
        increment = repeat * 60 * 60 * 1000;
        break;
      case "daily":
        increment = repeat * 24 * 60 * 60 * 1000;
        break;
      case "weekly":
        increment = repeat * 7 * 24 * 60 * 60 * 1000;
        break;
      case "monthly":
        increment = repeat * 30.44 * 24 * 60 * 60 * 1000;
        break;
      case "yearly":
        increment = repeat * 365.24 * 24 * 60 * 60 * 1000;
        break;
    }
    if (increment > 0) {
      let currentPointer = startTime.getTime();
      const endPointer = endTime.getTime();
      for (let i = 0; currentPointer <= endPointer && i < 500; i++) {
        expandedEvents.push({
          ...event,
          instance_time: new Date(currentPointer).toISOString(),
        });
        currentPointer += increment;
      }
    }
  });
  expandedEvents.sort(
    (a, b) => new Date(a.instance_time) - new Date(b.instance_time)
  );
  return expandedEvents;
}

async function loadAllEvents() {
  try {
    const response = await fetch("/api/events_full");
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const eventData = await response.json();

    const allEventInstances = expandAndSortEvents(eventData);
    populateUpcomingEventsList(allEventInstances);
    populateTodayJobsSummary(allEventInstances);
    populateOverallJobsSummary(allEventInstances);
  } catch (error) {
    console.error("Failed to load events:", error);
    document.getElementById(
      "events-list-container"
    ).innerHTML = `<div class="event-row-wrapper"><div class="no-events-badge" style="color: red;">Error loading events.</div></div>`;
  }
}

function populateUpcomingEventsList(allEventInstances) {
  const container = document.getElementById("events-list-container");
  const template = document.getElementById("event-row-template");
  container.innerHTML = "";

  const now = new Date();
  const upcomingInstances = allEventInstances.filter(
    (ev) => new Date(ev.instance_time) >= now
  );

  if (upcomingInstances.length === 0) {
    container.innerHTML =
      '<div class="event-row-wrapper"><div class="no-events-badge">No upcoming events scheduled.</div></div>';
    return;
  }

  upcomingInstances.forEach((event) => {
    const clone = template.content.cloneNode(true);
    const d = new Date(event.instance_time);
    const dateStr = d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timeStr = d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const sequenceInfo = sequenceIdMap[event.executable_id] || {};
    const eventName =
      event.sequence_message ||
      event.sequence_label ||
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

    clone
      .querySelector(".event-detail-btn")
      .addEventListener("click", () => handleDetailClick(event));
    container.appendChild(clone);
  });
}

function populateTodayJobsSummary(allEventInstances) {
  const counterContainer = document.getElementById("today-jobs-counter");
  const lastCompletedContainer = document.getElementById("last-completed-list");
  const nextJobsContainer = document.getElementById("next-remaining-list");
  const now = new Date();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const todayJobs = allEventInstances.filter((ev) => {
    const eventTime = new Date(ev.instance_time);
    return eventTime >= todayStart && eventTime <= todayEnd;
  });

  const completedToday = todayJobs.filter(
    (job) => new Date(job.instance_time) < now
  );
  const remainingToday = todayJobs.filter(
    (job) => new Date(job.instance_time) >= now
  );

  counterContainer.innerHTML = `Total: <b>${todayJobs.length}</b> | Completed: <b style="color: #22c55e;">${completedToday.length}</b> | Remaining: <b style="color: #f97316;">${remainingToday.length}</b>`;

  lastCompletedContainer.innerHTML = "";
  const lastThreeCompleted = completedToday.slice(-3).reverse();
  if (lastThreeCompleted.length > 0) {
    lastThreeCompleted.forEach((job) =>
      renderJobItem(job, lastCompletedContainer, true)
    );
  } else {
    lastCompletedContainer.innerHTML = "<li>No jobs completed yet.</li>";
  }

  nextJobsContainer.innerHTML = "";
  const nextFiveJobs = remainingToday.slice(0, 5);
  if (nextFiveJobs.length > 0) {
    nextFiveJobs.forEach((job) => renderJobItem(job, nextJobsContainer, false));
  } else {
    nextJobsContainer.innerHTML = "<li>No more jobs for today.</li>";
  }
}

function populateOverallJobsSummary(allEventInstances) {
  const counterContainer = document.getElementById("overall-jobs-counter");
  const frequencyContainer = document.getElementById("job-frequency-list");
  const now = new Date();

  const completedAll = allEventInstances.filter(
    (job) => new Date(job.instance_time) < now
  );
  const remainingAll = allEventInstances.filter(
    (job) => new Date(job.instance_time) >= now
  );

  counterContainer.innerHTML = `Total (All Time): <b>${allEventInstances.length}</b> | Completed: <b style="color: #22c55e;">${completedAll.length}</b> | Remaining: <b style="color: #f97316;">${remainingAll.length}</b>`;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const todayJobs = allEventInstances.filter((ev) => {
    const eventTime = new Date(ev.instance_time);
    return eventTime >= todayStart && eventTime <= todayEnd;
  });

  const frequencyMap = {};
  todayJobs.forEach((job) => {
    const sequenceInfo = sequenceIdMap[job.executable_id] || {};
    const eventName =
      job.sequence_message ||
      job.sequence_label ||
      sequenceInfo.name ||
      "Unnamed Event";
    frequencyMap[eventName] = (frequencyMap[eventName] || 0) + 1;
  });

  frequencyContainer.innerHTML = "";
  if (Object.keys(frequencyMap).length > 0) {
    for (const eventName in frequencyMap) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="job-name">${eventName}</span> <span class="job-time"><b>${frequencyMap[eventName]}</b> times</span>`;
      frequencyContainer.appendChild(li);
    }
  } else {
    frequencyContainer.innerHTML = "<li>No jobs today.</li>";
  }
}

function renderJobItem(job, container, isCompleted) {
  const li = document.createElement("li");
  if (isCompleted) {
    li.classList.add("job-completed");
  }
  const time = new Date(job.instance_time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sequenceInfo = sequenceIdMap[job.executable_id] || {};
  const eventName =
    job.sequence_message ||
    job.sequence_label ||
    sequenceInfo.name ||
    "Unnamed Event";
  const colorSpan = sequenceInfo.color
    ? `<span class="color-dot" style="background-color: ${sequenceInfo.color};"></span>`
    : '<span class="color-dot"></span>';
  li.innerHTML = `${colorSpan} <span class="job-time">${time}</span> <span class="job-name">${eventName}</span>`;
  container.appendChild(li);
}

function initializeNotes() {
  const notesArea = document.getElementById("notes-area");
  const saveBtn = document.getElementById("save-notes-btn");
  const clearBtn = document.getElementById("clear-notes-btn");
  notesArea.value = localStorage.getItem("farmbotNotes") || "";
  saveBtn.addEventListener("click", () => {
    localStorage.setItem("farmbotNotes", notesArea.value);
    saveBtn.textContent = "Saved!";
    setTimeout(() => {
      saveBtn.textContent = "Save";
    }, 1500);
  });

  clearBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to clear all notes?")) {
      notesArea.value = "";
      localStorage.removeItem("farmbotNotes");
    }
  });
}

function handleDetailClick(event) {
  const { executable_id, executable_type } = event;
  const sequenceInfo = sequenceIdMap[executable_id] || {};
  const eventName =
    event.sequence_message ||
    event.sequence_label ||
    sequenceInfo.name ||
    "Sequence";
  if (executable_type !== "Sequence") {
    return alert(`Details for '${executable_type}' are not supported yet.`);
  }
  const modal = document.getElementById("event-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalBody = document.getElementById("modal-body");
  modalTitle.textContent = `Details for: ${eventName}`;
  modalBody.innerHTML = "";
  modal.style.display = "flex";
  fetchAndDisplaySequence(executable_id, modalBody, sequenceInfo.color);
}

async function fetchAndDisplaySequence(sequenceId, containerElement, color) {
  try {
    const res = await fetch(`/api/sequence/${sequenceId}`);
    if (!res.ok) throw new Error(`Failed to fetch sequence ${sequenceId}`);
    const sequence = await res.json();
    containerElement.innerHTML = "";
    if (!sequence.body || sequence.body.length === 0) {
      return (containerElement.innerHTML = "<p>This sequence is empty.</p>");
    }
    for (const step of sequence.body) {
      containerElement.appendChild(createStepCard(step, color));
      if (step.kind === "execute" && step.args.sequence_id) {
        const nestedContainer = document.createElement("div");
        nestedContainer.style.cssText =
          "margin-left: 40px; border-left: 3px solid #e0e0e0; padding-left: 15px; margin-top: -10px; margin-bottom: 10px;";
        containerElement.appendChild(nestedContainer);
        await fetchAndDisplaySequence(
          step.args.sequence_id,
          nestedContainer,
          color
        );
      }
    }
  } catch (error) {
    console.error("Error fetching sequence details:", error);
    containerElement.innerHTML = `<p style="color: red;">Could not load sequence details.</p>`;
  }
}
function createStepCard(step, color) {

  const template = document
    .getElementById("step-card-template")
    .content.cloneNode(true);
  const stepCard = template.querySelector(".step-card");
  if (color) {
    stepCard.classList.add(`event-color-${color}`);
  }

  const header = template.querySelector(".step-header");
  const bodyList = template.querySelector(".step-body ul");
  header.textContent = step.kind.replace(/_/g, " ").toUpperCase();
  let detailsHtml = "";

  switch (step.kind) {
    case "move_absolute":
    case "move":
      if (step.args.location) {
        const loc = step.args.location;
        switch (loc.kind) {
          case "coordinate":
            detailsHtml = `Move to Coordinates: <b>(X: ${loc.args.x}, Y: ${loc.args.y}, Z: ${loc.args.z})</b>`;
            break;
          case "point":
            const point = pointIdMap[loc.args.pointer_id];
            if (point) {
              detailsHtml = `Move to Point: <b>${point.name} (X: ${point.x}, Y: ${point.y}, Z: ${point.z})</b>`;
            } else {
              detailsHtml = `Move to Point: <b>ID ${loc.args.pointer_id}</b>`;
            }
            break;
          case "tool":
            detailsHtml = `Move to Tool: <b>${
              toolIdMap[loc.args.tool_id] || `ID ${loc.args.tool_id}`
            }</b>`;
            break;
          default:
            detailsHtml = `Move to unknown location: ${loc.kind}`;
            break;
        }
      } else if (step.body && step.body.length > 0) {
        let descriptions = [];
        step.body.forEach((op) => {
          if (op.kind === "axis_overwrite" || op.kind === "axis_addition") {
            const axis = op.args.axis.toUpperCase();
            const operand = op.args.axis_operand;
            let value_desc = "?";
            if (operand.kind === "numeric") {
              value_desc = operand.args.number;
            } else if (operand.kind === "point") {
              const point = pointIdMap[operand.args.pointer_id];
              if (point) {
                value_desc = `${point.name} (${axis}: ${
                  point[axis.toLowerCase()]
                })`;
              }
            } else if (
              operand.kind === "special_value" &&
              operand.args.label === "current_location"
            ) {
              value_desc = "Not Move";
            }
            if (op.kind === "axis_overwrite") {
              descriptions.push(`Set ${axis} to <b>${value_desc}</b>`);
            } else {
              descriptions.push(`Add <b>${value_desc}</b> to ${axis}`);
            }
          }
        });
        detailsHtml = descriptions.join("<br>");
      } else {
        detailsHtml = `(Could not determine move location)`;
      }
      break;
    case "write_pin":
      const pinInfo = step.args.pin_number;
      let pinName = "Unknown Pin";
      if (pinInfo && pinInfo.kind === "named_pin") {
        pinName =
          peripheralIdMap[pinInfo.args.pin_id] || `ID ${pinInfo.args.pin_id}`;
      } else if (typeof step.args.pin_number === "number") {
        pinName = `Pin ${step.args.pin_number}`;
      }
      const state =
        step.args.pin_value === 1
          ? '<span style="color: #4CAF50; font-weight: bold;">ON</span>'
          : '<span style="color: #ee4e43; font-weight: bold;">OFF</span>';
      detailsHtml = `Set <b>${pinName}</b> to ${state}`;
      break;
    case "execute":
      const seqInfo = sequenceIdMap[step.args.sequence_id] || {};
      detailsHtml = `Run Sequence: <b>${
        seqInfo.name || `ID ${step.args.sequence_id}`
      }</b>`;
      break;
    case "find_home":
      detailsHtml = `Find home for axis: <b>${step.args.axis}</b>`;
      break;
    case "wait":
      detailsHtml = `Wait for <b>${step.args.milliseconds}</b> milliseconds`;
      break;
    default:
      detailsHtml = `${JSON.stringify(step.args)}`;
      break;
  }
  bodyList.innerHTML = detailsHtml;
  return template;
}

async function fetchAndDisplaySequence(sequenceId, containerElement) {
  try {
    const res = await fetch(`/api/sequence/${sequenceId}`);
    if (!res.ok) throw new Error(`Failed to fetch sequence ${sequenceId}`);
    const sequence = await res.json();
    containerElement.innerHTML = "";
    if (!sequence.body || sequence.body.length === 0) {
      return (containerElement.innerHTML = "<p>This sequence is empty.</p>");
    }
    for (const step of sequence.body) {
      containerElement.appendChild(createStepCard(step));
      if (step.kind === "execute" && step.args.sequence_id) {
        const nestedContainer = document.createElement("div");
        nestedContainer.style.cssText =
          "margin-left: 40px; border-left: 3px solid #e0e0e0; padding-left: 15px; margin-top: -10px; margin-bottom: 10px;";
        containerElement.appendChild(nestedContainer);
        await fetchAndDisplaySequence(step.args.sequence_id, nestedContainer);
      }
    }
  } catch (error) {
    console.error("Error fetching sequence details:", error);
    containerElement.innerHTML = `<p style="color: red;">Could not load sequence details.</p>`;
  }
}
function createStepCard(step) {
  const template = document
    .getElementById("step-card-template")
    .content.cloneNode(true);
  const header = template.querySelector(".step-header");
  const bodyList = template.querySelector(".step-body ul");
  header.textContent = step.kind.replace(/_/g, " ").toUpperCase();
  let detailsHtml = "";
  switch (step.kind) {
    case "move_absolute":
    case "move":
      if (step.args.location) {
        const loc = step.args.location;
        switch (loc.kind) {
          case "coordinate":
            detailsHtml = `Move to Coordinates: <b>(X: ${loc.args.x}, Y: ${loc.args.y}, Z: ${loc.args.z})</b>`;
            break;
          case "point":
            const point = pointIdMap[loc.args.pointer_id];
            if (point) {
              detailsHtml = `Move to Point: <b>${point.name} (X: ${point.x}, Y: ${point.y}, Z: ${point.z})</b>`;
            } else {
              detailsHtml = `Move to Point: <b>ID ${loc.args.pointer_id}</b>`;
            }
            break;
          case "tool":
            detailsHtml = `Move to Tool: <b>${
              toolIdMap[loc.args.tool_id] || `ID ${loc.args.tool_id}`
            }</b>`;
            break;
          default:
            detailsHtml = `Move to unknown location: ${loc.kind}`;
            break;
        }
      } else if (step.body && step.body.length > 0) {
        let descriptions = [];
        step.body.forEach((op) => {
          if (op.kind === "axis_overwrite" || op.kind === "axis_addition") {
            const axis = op.args.axis.toUpperCase();
            const operand = op.args.axis_operand;
            let value_desc = "?";
            if (operand.kind === "numeric") {
              value_desc = operand.args.number;
            } else if (operand.kind === "point") {
              const point = pointIdMap[operand.args.pointer_id];
              if (point) {
                value_desc = `${point.name} (${axis}: ${
                  point[axis.toLowerCase()]
                })`;
              }
            } else if (
              operand.kind === "special_value" &&
              operand.args.label === "current_location"
            ) {
              value_desc = "Not Move";
            }
            if (op.kind === "axis_overwrite") {
              descriptions.push(`Set ${axis} to <b>${value_desc}</b>`);
            } else {
              descriptions.push(`Add <b>${value_desc}</b> to ${axis}`);
            }
          }
        });
        detailsHtml = descriptions.join("<br>");
      } else {
        detailsHtml = `(Could not determine move location)`;
      }
      break;
    case "write_pin":
      const pinInfo = step.args.pin_number;
      let pinName = "Unknown Pin";
      if (pinInfo && pinInfo.kind === "named_pin") {
        pinName =
          peripheralIdMap[pinInfo.args.pin_id] || `ID ${pinInfo.args.pin_id}`;
      } else if (typeof step.args.pin_number === "number") {
        pinName = `Pin ${step.args.pin_number}`;
      }
      const state =
        step.args.pin_value === 1
          ? '<span style="color: #4CAF50; font-weight: bold;">ON</span>'
          : '<span style="color: #ee4e43; font-weight: bold;">OFF</span>';
      detailsHtml = `Set <b>${pinName}</b> to ${state}`;
      break;
    case "execute":
      const seqInfo = sequenceIdMap[step.args.sequence_id] || {};
      detailsHtml = `Run Sequence: <b>${
        seqInfo.name || `ID ${step.args.sequence_id}`
      }</b>`;
      break;
    case "find_home":
      detailsHtml = `Find home for axis: <b>${step.args.axis}</b>`;
      break;
    case "wait":
      detailsHtml = `Wait for <b>${step.args.milliseconds}</b> milliseconds`;
      break;
    default:
      detailsHtml = `${JSON.stringify(step.args)}`;
      break;
  }
  bodyList.innerHTML = detailsHtml;
  return template;
}
function renderCalendar() {
  const container = document.getElementById("calendar-container");
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const today = now.getDate();
  const monthName = now.toLocaleString("en-US", { month: "long" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  let calendarHTML = ` <div class="calendar-header"> <div class="calendar-month-year">${monthName} ${year}</div> </div> <div class="calendar-grid"> <div class="day-name">Su</div><div class="day-name">Mo</div><div class="day-name">Tu</div> <div class="day-name">We</div><div class="day-name">Th</div><div class="day-name">Fr</div> <div class="day-name">Sa</div> `;
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarHTML += `<div class="date-cell empty"></div>`;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === today ? "current-day" : "";
    calendarHTML += `<div class="date-cell ${isToday}">${day}</div>`;
  }
  calendarHTML += `</div>`;
  container.innerHTML = calendarHTML;
}
