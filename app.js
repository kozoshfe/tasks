const SUPABASE_URL = "https://qzcapeempzzdhicsweqz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nXxnpG6C_RO9mVqcYEt1mg_Z9Z-dpDr";
const SUPABASE_TABLE = "tasks_state";
const SUPABASE_ROW_ID = "simple-task-pwa-main";
const LEGACY_STORAGE_KEY = "simple-task-pwa-state";
const PENDING_STORAGE_KEY = "simple-task-pwa-pending-state";
const APP_VERSION = "36";
const APP_VERSION_KEY = "simple-task-pwa-version";
const DOUBLE_TAP_DELAY_MS = 280;
const PRIORITIES = {
  high: {
    label: "Високий",
    className: "priority-high",
  },
  medium: {
    label: "Середній",
    className: "priority-medium",
  },
  low: {
    label: "Лоу",
    className: "priority-low",
  },
};
const PRIORITY_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const els = {
  addButton: document.querySelector("#addButton"),
  closeTaskModalButton: document.querySelector("#closeTaskModalButton"),
  micButton: document.querySelector("#micButton"),
  navMicButton: document.querySelector("#navMicButton"),
  submitTaskButton: document.querySelector("#submitTaskButton"),
  taskCount: document.querySelector("#taskCount"),
  taskInput: document.querySelector("#taskInput"),
  taskModal: document.querySelector("#taskModal"),
  taskList: document.querySelector("#taskList"),
  taskFilterTabs: document.querySelectorAll("[data-task-filter]"),
  tasksPanel: document.querySelector("#tasksPanel"),
  tasksTab: document.querySelector("#tasksTab"),
  trashCount: document.querySelector("#trashCount"),
  trashList: document.querySelector("#trashList"),
  trashPanel: document.querySelector("#trashPanel"),
  trashTab: document.querySelector("#trashTab"),
  voiceStatus: document.querySelector("#voiceStatus"),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let supabaseClient = null;
let recognition = null;
let shouldAutoAddVoiceResult = false;
let dragState = null;
let navMicTapTimer = null;
let priorityPickerTaskId = null;
let activeTaskFilter = "all";
const state = {
  tasks: [],
  trash: [],
};

function ensureAppVersion() {
  const savedVersion = localStorage.getItem(APP_VERSION_KEY);
  const currentUrl = new URL(window.location.href);
  const currentVersionParam = currentUrl.searchParams.get("appv");

  if (savedVersion !== APP_VERSION && currentVersionParam !== APP_VERSION) {
    localStorage.setItem(APP_VERSION_KEY, APP_VERSION);
    currentUrl.searchParams.set("appv", APP_VERSION);
    window.location.replace(currentUrl.toString());
    return false;
  }

  localStorage.setItem(APP_VERSION_KEY, APP_VERSION);
  return true;
}

function normalizeState(value) {
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks.map(normalizeTask) : [],
    trash: Array.isArray(value?.trash) ? value.trash.map(normalizeTask) : [],
  };
}

function normalizeTask(task) {
  return {
    ...task,
    priority: hasPriority(task?.priority) ? task.priority : null,
  };
}

function hasPriority(priority) {
  return Object.prototype.hasOwnProperty.call(PRIORITIES, priority);
}

function getPriorityRank(task) {
  return hasPriority(task?.priority) ? PRIORITY_ORDER[task.priority] : PRIORITY_ORDER.none;
}

function sortTasksByPriority(tasks) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => getPriorityRank(a.task) - getPriorityRank(b.task) || a.index - b.index)
    .map(({ task }) => task);
}

function sortActiveTasks() {
  state.tasks = sortTasksByPriority(state.tasks);
}

function getFilteredTasks() {
  if (activeTaskFilter === "urgent") {
    return state.tasks.filter((task) => task.priority === "high");
  }

  if (activeTaskFilter === "buy") {
    return state.tasks.filter((task) => task.title.toLocaleLowerCase("uk-UA").includes("купити"));
  }

  return state.tasks;
}

function applyState(nextState) {
  const normalized = normalizeState(nextState);
  state.tasks = sortTasksByPriority(normalized.tasks);
  state.trash = normalized.trash;
}

function readLegacyState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)));
  } catch {
    return { tasks: [], trash: [] };
  }
}

function readPendingState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY)));
  } catch {
    return { tasks: [], trash: [] };
  }
}

function hasTasks(value) {
  return value.tasks.length > 0 || value.trash.length > 0;
}

function getStateSnapshot() {
  sortActiveTasks();
  return {
    tasks: state.tasks,
    trash: state.trash,
  };
}

function setSyncStatus() {
  // Sync messages stay silent in the UI.
}

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

async function parseSupabaseError(response) {
  try {
    const body = await response.json();
    return body.message || body.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function saveState() {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(getStateSnapshot()));
  setSyncStatus("Зберігаю...", "neutral");

  if (!supabaseClient) {
    console.error("Supabase client is not ready.");
    setSyncStatus("Не підключено до бази. Збережено тимчасово.", "error");
    return false;
  }

  let response = null;

  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`, {
      method: "POST",
      headers: getSupabaseHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify({
        id: SUPABASE_ROW_ID,
        state: getStateSnapshot(),
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("Failed to save tasks to Supabase:", error);
    setSyncStatus("Не збережено в базу: немає з'єднання", "error");
    return false;
  }

  if (!response.ok) {
    const message = await parseSupabaseError(response);
    console.error("Failed to save tasks to Supabase:", message);
    setSyncStatus(`Не збережено в базу: ${message}`, "error");
    return false;
  }

  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(PENDING_STORAGE_KEY);
  setSyncStatus("Збережено в базу", "success");
  return true;
}

async function loadState() {
  if (!supabaseClient) return;
  setSyncStatus("Читаю базу...", "neutral");

  const legacyState = readLegacyState();
  const pendingState = readPendingState();
  let data = null;

  let response = null;

  try {
    response = await fetch(
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(SUPABASE_ROW_ID)}&select=state`,
      {
        headers: getSupabaseHeaders(),
      },
    );
  } catch (error) {
    console.error("Failed to load tasks from Supabase:", error);
    setSyncStatus("Не прочитано з бази: немає з'єднання", "error");
    if (hasTasks(pendingState)) {
      applyState(pendingState);
    } else if (hasTasks(legacyState)) {
      applyState(legacyState);
    }
    render();
    return;
  }

  if (!response.ok) {
    const message = await parseSupabaseError(response);
    console.error("Failed to load tasks from Supabase:", message);
    setSyncStatus(`Не прочитано з бази: ${message}`, "error");
    if (hasTasks(pendingState)) {
      applyState(pendingState);
    } else if (hasTasks(legacyState)) {
      applyState(legacyState);
    }
    render();
    return;
  }

  data = (await response.json())[0] || null;

  if (hasTasks(pendingState)) {
    applyState(pendingState);
    await saveState();
  } else if (data?.state) {
    applyState(data.state);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } else if (hasTasks(legacyState)) {
    applyState(legacyState);
    await saveState();
  } else {
    await saveState();
  }

  render();
  if (!hasTasks(readPendingState())) setSyncStatus("База підключена", "success");
}

async function initDatabase() {
  supabaseClient = true;
  await loadState();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTaskTitle(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return "";

  return cleanTitle.charAt(0).toLocaleUpperCase("uk-UA") + cleanTitle.slice(1);
}

function createTask(title) {
  return {
    id: crypto.randomUUID(),
    title: formatTaskTitle(title),
    done: false,
    createdAt: Date.now(),
    priority: null,
  };
}

async function addTask() {
  const title = els.taskInput.value.trim();
  if (!title) {
    els.taskInput.focus();
    return;
  }

  state.tasks.push(createTask(title));
  els.taskInput.value = "";
  closeTaskModal();
  render();
  await saveState();
}

async function addTaskFromTitle(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  state.tasks.push(createTask(cleanTitle));
  render();
  await saveState();
}

function openTaskModal() {
  els.taskModal.hidden = false;
  window.requestAnimationFrame(() => {
    els.taskModal.classList.add("open");
    els.taskInput.focus();
  });
}

function startVoiceInput({ autoAdd = false } = {}) {
  if (!recognition) {
    els.voiceStatus.textContent = "Голосове введення недоступне в цьому браузері.";
    return;
  }

  shouldAutoAddVoiceResult = autoAdd;

  try {
    recognition.start();
  } catch {
    els.voiceStatus.textContent = "Мікрофон уже слухає.";
  }
}

function addVoiceTask() {
  startVoiceInput({ autoAdd: true });
}

function handleNavMicTap(event) {
  event.preventDefault();

  if (navMicTapTimer) {
    window.clearTimeout(navMicTapTimer);
    navMicTapTimer = null;
    openTaskModal();
    return;
  }

  navMicTapTimer = window.setTimeout(() => {
    navMicTapTimer = null;
    addVoiceTask();
  }, DOUBLE_TAP_DELAY_MS);
}

function closeTaskModal() {
  els.taskModal.classList.remove("open");
  els.taskModal.hidden = true;
  els.voiceStatus.textContent = "";
}

async function moveToTrash(id, { openTrash = true } = {}) {
  const index = state.tasks.findIndex((task) => task.id === id);
  if (index === -1) return;

  const [task] = state.tasks.splice(index, 1);
  state.trash.unshift({ ...task, deletedAt: Date.now() });
  render();
  if (openTrash) switchTab("trash");
  await saveState();
}

function closePriorityPicker() {
  const picker = document.querySelector(".priority-picker");
  if (picker) picker.remove();
  priorityPickerTaskId = null;
}

async function setTaskPriority(id, priority) {
  const task = state.tasks.find((item) => item.id === id) || state.trash.find((item) => item.id === id);
  if (!task || !hasPriority(priority)) return;

  task.priority = priority;
  closePriorityPicker();
  sortActiveTasks();
  render();
  await saveState();
}

function openPriorityPicker(task, anchor) {
  closePriorityPicker();
  priorityPickerTaskId = task.id;

  const picker = document.createElement("div");
  picker.className = "priority-picker";
  picker.setAttribute("role", "menu");

  Object.entries(PRIORITIES).forEach(([priority, details]) => {
    const button = document.createElement("button");
    button.className = `priority-option ${details.className}`;
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(task.priority === priority));
    button.innerHTML = `<span class="priority-dot" aria-hidden="true"></span><span>${details.label}</span>`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setTaskPriority(task.id, priority);
    });
    picker.append(button);
  });

  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - pickerRect.width - 12);
  const top = Math.min(rect.bottom + 8, window.innerHeight - pickerRect.height - 12);
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
}

async function removeForever(id) {
  state.trash = state.trash.filter((task) => task.id !== id);
  render();
  await saveState();
}

function completeTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  task.done = true;
  moveToTrash(id, { openTrash: false });
}

function moveTaskToIndex(id, nextIndex) {
  const currentIndex = state.tasks.findIndex((task) => task.id === id);
  if (currentIndex === -1 || currentIndex === nextIndex) return false;

  const [task] = state.tasks.splice(currentIndex, 1);
  state.tasks.splice(nextIndex, 0, task);
  return true;
}

function getTaskDragIndex(pointerY, draggingItem) {
  const items = [...els.taskList.querySelectorAll(".task-item:not(.dragging)")];
  return items.reduce((index, item) => {
    const rect = item.getBoundingClientRect();
    return pointerY > rect.top + rect.height / 2 ? index + 1 : index;
  }, 0);
}

function syncDraggedTaskPosition(pointerY) {
  if (!dragState?.active) return;

  const nextIndex = getTaskDragIndex(pointerY, dragState.item);
  if (!moveTaskToIndex(dragState.id, nextIndex)) return;

  const siblings = [...els.taskList.querySelectorAll(".task-item:not(.dragging)")];
  els.taskList.insertBefore(dragState.item, siblings[nextIndex] || null);
  dragState.moved = true;
}

function startTaskDrag(item) {
  if (!dragState || dragState.active) return;

  dragState.active = true;
  dragState.moved = false;
  item.classList.remove("pressing");
  item.classList.add("dragging");
  document.body.classList.add("is-reordering");
}

function cancelPendingTaskDrag() {
  if (!dragState || dragState.active) return;

  clearTimeout(dragState.timer);
  dragState.item.classList.remove("pressing");
  dragState = null;
}

async function finishTaskDrag() {
  if (!dragState) return;

  clearTimeout(dragState.timer);
  const { item, moved, active } = dragState;
  item.classList.remove("pressing", "dragging");
  document.body.classList.remove("is-reordering");
  dragState = null;

  if (active && moved) {
    sortActiveTasks();
    render();
    await saveState();
  }
}

function setupTaskReorder(item, task, mode) {
  if (mode !== "tasks") return;

  item.dataset.taskId = task.id;
  item.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;

    dragState = {
      active: false,
      id: task.id,
      item,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => startTaskDrag(item), 420),
    };

    item.classList.add("pressing");
    item.setPointerCapture(event.pointerId);
  });

  item.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.item !== item || dragState.pointerId !== event.pointerId) return;

    const moveX = Math.abs(event.clientX - dragState.startX);
    const moveY = Math.abs(event.clientY - dragState.startY);
    if (!dragState.active && (moveX > 8 || moveY > 8)) {
      cancelPendingTaskDrag();
      return;
    }

    if (!dragState.active) return;

    event.preventDefault();
    if (event.clientY < 90) window.scrollBy({ top: -12, behavior: "auto" });
    if (event.clientY > window.innerHeight - 120) window.scrollBy({ top: 12, behavior: "auto" });
    syncDraggedTaskPosition(event.clientY);
  });

  item.addEventListener("pointerup", (event) => {
    if (!dragState || dragState.item !== item || dragState.pointerId !== event.pointerId) return;
    finishTaskDrag();
  });

  item.addEventListener("pointercancel", (event) => {
    if (!dragState || dragState.item !== item || dragState.pointerId !== event.pointerId) return;
    finishTaskDrag();
  });
}

function makeTaskItem(task, mode) {
  const item = document.createElement("li");
  item.className = `task-item${task.done ? " done" : ""}`;

  const checkButton = document.createElement("button");
  checkButton.className = "check-button";
  checkButton.type = "button";
  checkButton.textContent = task.done ? "✓" : "";
  checkButton.setAttribute("aria-label", task.done ? "Позначити активним" : "Позначити виконаним");
  checkButton.setAttribute("aria-pressed", String(task.done));
  checkButton.disabled = mode === "trash";
  checkButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    completeTask(task.id);
  });

  const text = document.createElement("div");
  text.className = "task-text";
  const titleRow = document.createElement("div");
  titleRow.className = "task-title-row";
  const priority = hasPriority(task.priority) ? PRIORITIES[task.priority] : null;
  const priorityDot = document.createElement("span");
  priorityDot.className = `priority-dot task-priority-dot${priority ? ` ${priority.className}` : ""}`;
  priorityDot.title = priority ? priority.label : "Без пріоритету";
  priorityDot.setAttribute("aria-label", priority ? `Пріоритет: ${priority.label}` : "Без пріоритету");
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  titleRow.append(priorityDot, title);
  const meta = document.createElement("span");
  meta.className = "task-meta";
  meta.textContent = mode === "trash" ? `Видалено ${formatDate(task.deletedAt)}` : `Створено ${formatDate(task.createdAt)}`;
  text.append(titleRow, meta);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  if (mode === "trash") {
    const deleteButton = document.createElement("button");
    deleteButton.className = "mini-button danger";
    deleteButton.type = "button";
    deleteButton.textContent = "×";
    deleteButton.title = "Видалити назавжди";
    deleteButton.setAttribute("aria-label", "Видалити назавжди");
    deleteButton.addEventListener("click", () => removeForever(task.id));
    actions.append(deleteButton);
  } else {
    actions.append(checkButton);
  }

  if (mode === "trash") {
    item.append(checkButton, text, actions);
  } else {
    item.append(text, actions);
  }

  item.addEventListener("click", (event) => {
    if (event.target.closest("button") || dragState?.active) return;
    if (event.detail === 3) {
      event.preventDefault();
      openPriorityPicker(task, item);
    }
  });

  setupTaskReorder(item, task, mode);
  return item;
}

function render() {
  sortActiveTasks();
  const visibleTasks = getFilteredTasks();
  els.taskList.replaceChildren(...visibleTasks.map((task) => makeTaskItem(task, "tasks")));
  els.trashList.replaceChildren(...state.trash.map((task) => makeTaskItem(task, "trash")));
  els.taskCount.textContent = visibleTasks.length;
  els.trashCount.textContent = state.trash.length;
}

function setTaskFilter(filterName) {
  activeTaskFilter = filterName;
  els.taskFilterTabs.forEach((tab) => {
    const isActive = tab.dataset.taskFilter === activeTaskFilter;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  render();
}

function switchTab(tabName) {
  const showTasks = tabName === "tasks";
  els.tasksPanel.hidden = !showTasks;
  els.trashPanel.hidden = showTasks;
  els.tasksTab.classList.toggle("active", showTasks);
  els.trashTab.classList.toggle("active", !showTasks);
  els.tasksTab.setAttribute("aria-selected", String(showTasks));
  els.trashTab.setAttribute("aria-selected", String(!showTasks));
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    els.voiceStatus.textContent = "Голосове введення недоступне в цьому браузері.";
    els.micButton.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "uk-UA";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => {
    els.micButton.classList.add("listening");
    els.navMicButton.classList.add("listening");
    els.voiceStatus.textContent = "Слухаю...";
  });

  recognition.addEventListener("result", async (event) => {
    const transcript = event.results[0][0].transcript.trim();

    if (shouldAutoAddVoiceResult && transcript) {
      shouldAutoAddVoiceResult = false;
      setSyncStatus("Додаю голосову таску...", "neutral");
      await addTaskFromTitle(transcript);
      return;
    }

    els.taskInput.value = transcript;
    els.voiceStatus.textContent = "Готово. Можна додати або відредагувати текст.";
    els.taskInput.focus();
  });

  recognition.addEventListener("error", () => {
    shouldAutoAddVoiceResult = false;
    els.voiceStatus.textContent = "Не вдалося розпізнати голос. Спробуйте ще раз.";
  });

  recognition.addEventListener("end", () => {
    els.micButton.classList.remove("listening");
    els.navMicButton.classList.remove("listening");
    if (els.voiceStatus.textContent === "Слухаю...") {
      els.voiceStatus.textContent = "";
    }
  });
}

els.addButton?.addEventListener("click", openTaskModal);
els.submitTaskButton.addEventListener("click", addTask);
els.closeTaskModalButton.addEventListener("click", closeTaskModal);
els.taskModal.addEventListener("click", (event) => {
  if (event.target === els.taskModal) closeTaskModal();
});
els.taskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTask();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.taskModal.hidden) closeTaskModal();
  if (event.key === "Escape" && priorityPickerTaskId) closePriorityPicker();
});

document.addEventListener("click", (event) => {
  if (!priorityPickerTaskId) return;
  if (event.target.closest(".priority-picker") || event.target.closest(".task-item")) return;
  closePriorityPicker();
});

els.tasksTab.addEventListener("click", () => switchTab("tasks"));
els.trashTab.addEventListener("click", () => switchTab("trash"));
els.taskFilterTabs.forEach((tab) => {
  tab.addEventListener("click", () => setTaskFilter(tab.dataset.taskFilter));
});
els.navMicButton.addEventListener("contextmenu", (event) => event.preventDefault());
els.navMicButton.addEventListener("click", handleNavMicTap);

els.micButton.addEventListener("click", () => startVoiceInput());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

setupSpeechRecognition();
render();
if (ensureAppVersion()) initDatabase();
