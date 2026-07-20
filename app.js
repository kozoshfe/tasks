const SUPABASE_URL = "https://qzcapeempzzdhicsweqz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nXxnpG6C_RO9mVqcYEt1mg_Z9Z-dpDr";
const SUPABASE_TABLE = "tasks_state";
const SUPABASE_ROW_ID = "simple-task-pwa-main";
const LEGACY_STORAGE_KEY = "simple-task-pwa-state";
const PENDING_STORAGE_KEY = "simple-task-pwa-pending-state";
const APP_VERSION = "63";
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
  taskReminder: document.querySelector("#taskReminder"),
  newReminderDay: document.querySelector("#newReminderDay"),
  newReminderMonth: document.querySelector("#newReminderMonth"),
  newReminderYear: document.querySelector("#newReminderYear"),
  newReminderHour: document.querySelector("#newReminderHour"),
  newReminderMinute: document.querySelector("#newReminderMinute"),
  taskRepeat: document.querySelector("#taskRepeat"),
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

function fillReminderSelect(select, values, selected) {
  select.replaceChildren(...values.map(([value, text]) => new Option(text, value, value === selected, value === selected)));
}

function setupNewReminderPicker() {
  const now = new Date(Date.now() + 3600000);
  fillReminderSelect(els.newReminderDay, Array.from({ length: 31 }, (_, i) => {
    const value = String(i + 1).padStart(2, "0"); return [value, value];
  }), String(now.getDate()).padStart(2, "0"));
  fillReminderSelect(els.newReminderMonth, ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"].map((text, i) => [String(i), text]), String(now.getMonth()));
  fillReminderSelect(els.newReminderYear, Array.from({ length: 6 }, (_, i) => {
    const year = String(now.getFullYear() + i); return [year, year];
  }), String(now.getFullYear()));
  fillReminderSelect(els.newReminderHour, Array.from({ length: 24 }, (_, i) => { const v = String(i).padStart(2, "0"); return [v, v]; }), String(now.getHours()).padStart(2, "0"));
  fillReminderSelect(els.newReminderMinute, Array.from({ length: 12 }, (_, i) => { const v = String(i * 5).padStart(2, "0"); return [v, v]; }), String(Math.round(now.getMinutes() / 5) * 5 % 60).padStart(2, "0"));
}

function getNewReminderValue() {
  return new Date(Number(els.newReminderYear.value), Number(els.newReminderMonth.value), Number(els.newReminderDay.value), Number(els.newReminderHour.value), Number(els.newReminderMinute.value)).toISOString();
}

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
  const priority = task?.priority === "priority-high" ? "high"
    : task?.priority === "priority-medium" ? "medium"
      : task?.priority === "priority-low" ? "low" : task?.priority;
  return {
    ...task,
    priority: hasPriority(priority) ? priority : null,
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
  const isBuyTask = (task) => task.title.toLocaleLowerCase("uk-UA").includes("купит");
  const isUrgentTask = (task) => task.priority === "high";
  const isReminderTask = (task) => Boolean(task.reminderAt);

  if (activeTaskFilter === "urgent") {
    return state.tasks.filter((task) => !isReminderTask(task) && isUrgentTask(task));
  }

  if (activeTaskFilter === "buy") {
    return state.tasks.filter((task) => !isReminderTask(task) && isBuyTask(task));
  }

  return state.tasks.filter((task) => !isReminderTask(task) && !isUrgentTask(task) && !isBuyTask(task));
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
    reminderAt: null,
    recurrence: null,
  };
}

function parseVoiceReminder(text) {
  const months = {
    січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5,
    липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
  };
  const match = text.match(/(?:на\s+)?(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|жовтня|листопада|грудня)(?:\s+(\d{4}))?\s*(?:о|в)\s*(\d{1,2})(?:\s*[:.,]\s*(\d{1,2}))?/i);
  if (!match) return { title: text, reminderAt: null };

  const now = new Date();
  const year = Number(match[3] || now.getFullYear());
  const hour = Number(match[4]);
  const minute = Number(match[5] || 0);
  const reminderDate = new Date(year, months[match[2].toLocaleLowerCase("uk-UA")], Number(match[1]), hour, minute);
  if (!match[3] && reminderDate.getTime() < Date.now()) reminderDate.setFullYear(year + 1);
  const title = text.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { title: title || text, reminderAt: reminderDate.toISOString() };
}

function scheduleNativeReminder(task) {
  if (!task.reminderAt || !window.AndroidNotifications?.schedule) return;
  window.AndroidNotifications.schedule(String(task.id), task.title, new Date(task.reminderAt).getTime());
}

function cancelNativeReminder(taskId) {
  window.AndroidNotifications?.cancel?.(String(taskId));
}

function rescheduleNativeReminders() {
  state.tasks.forEach((task) => scheduleNativeReminder(task));
}

async function addTask() {
  const title = els.taskInput.value.trim();
  if (!title) {
    els.taskInput.focus();
    return;
  }

  const parsedTitle = parseVoiceReminder(title);
  const task = createTask(parsedTitle.title);
  task.reminderAt = parsedTitle.reminderAt || getNewReminderValue();
  task.recurrence = els.taskRepeat.value === "none" ? null : els.taskRepeat.value;
  state.tasks.push(task);
  scheduleNativeReminder(task);
  els.taskInput.value = "";
  els.taskRepeat.value = "none";
  closeTaskModal();
  render();
  await saveState();
}

async function addTaskFromTitle(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  const parsed = parseVoiceReminder(cleanTitle);
  const task = createTask(parsed.title);
  task.reminderAt = parsed.reminderAt;
  state.tasks.push(task);
  scheduleNativeReminder(task);
  render();
  await saveState();
}

function openTaskTitleEditor(task) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop title-editor-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "Редагувати назву таски");

  const card = document.createElement("section");
  card.className = "composer modal-card";
  const heading = document.createElement("div");
  heading.className = "modal-heading";
  heading.innerHTML = "<h2>Редагувати таску</h2>";
  const closeButton = document.createElement("button");
  closeButton.className = "modal-close-button";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Скасувати");
  heading.append(closeButton);

  const label = document.createElement("label");
  label.className = "input-label";
  label.textContent = "Назва таски";
  const input = document.createElement("input");
  input.type = "text";
  input.value = task.title;
  input.maxLength = 160;
  label.append(input);

  const saveButton = document.createElement("button");
  saveButton.className = "modal-submit-button";
  saveButton.type = "button";
  saveButton.textContent = "Зберегти";
  const close = () => backdrop.remove();
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  const save = async () => {
    const title = formatTaskTitle(input.value);
    if (!title) {
      input.focus();
      return;
    }
    task.title = title;
    close();
    render();
    await saveState();
  };
  saveButton.addEventListener("click", save);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") save(); });
  card.append(heading, label, saveButton);
  backdrop.append(card);
  document.body.append(backdrop);
  window.requestAnimationFrame(() => {
    backdrop.classList.add("open");
    input.focus();
    input.select();
  });
}

function openTaskModal() {
  els.taskModal.hidden = false;
  window.requestAnimationFrame(() => {
    els.taskModal.classList.add("open");
    els.taskInput.focus();
  });
}

function startVoiceInput({ autoAdd = false } = {}) {
  if (window.AndroidSpeech?.start) {
    shouldAutoAddVoiceResult = autoAdd;
    els.voiceStatus.textContent = "Слухаю...";
    window.AndroidSpeech.start();
    return;
  }
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

window.onAndroidSpeechResult = async (text) => {
  const transcript = String(text || "").trim();
  if (!transcript) return;
  if (shouldAutoAddVoiceResult) {
    shouldAutoAddVoiceResult = false;
    await addTaskFromTitle(transcript);
  } else {
    els.taskInput.value = transcript;
    els.taskInput.focus();
  }
  els.voiceStatus.textContent = "Готово.";
};

window.onAndroidSpeechError = (message) => {
  shouldAutoAddVoiceResult = false;
  els.voiceStatus.textContent = message || "Не вдалося розпізнати голос.";
};

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

function getNextReminderAt(task) {
  const now = new Date();
  const next = new Date(task.reminderAt || now);

  if (task.recurrence === "daily") {
    do next.setDate(next.getDate() + 1); while (next <= now);
  } else if (task.recurrence === "weekly-monday") {
    do next.setDate(next.getDate() + 1); while (next.getDay() !== 1 || next <= now);
  } else if (task.recurrence === "monthly-20") {
    do {
      next.setMonth(next.getMonth() + 1, 20);
    } while (next <= now);
  } else {
    return null;
  }

  return next.toISOString();
}

async function moveToTrash(id, { openTrash = true } = {}) {
  const index = state.tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  cancelNativeReminder(id);

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
  if (!task || (priority !== null && !hasPriority(priority))) return;

  task.priority = priority;
  closePriorityPicker();
  sortActiveTasks();
  render();
  await saveState();
}

function openPriorityPicker(task, anchor, showReminder = false) {
  closePriorityPicker();
  priorityPickerTaskId = task.id;

  const picker = document.createElement("div");
  picker.className = "priority-picker";
  picker.setAttribute("role", "menu");

  const closePickerButton = document.createElement("button");
  closePickerButton.className = "picker-close-button";
  closePickerButton.type = "button";
  closePickerButton.setAttribute("aria-label", "Закрити меню");
  closePickerButton.textContent = "×";
  closePickerButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closePriorityPicker();
  });
  picker.append(closePickerButton);

  if (!showReminder) Object.entries(PRIORITIES).forEach(([priority, details]) => {
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

  if (!showReminder) {
    const clearPriorityButton = document.createElement("button");
    clearPriorityButton.className = "priority-option priority-clear";
    clearPriorityButton.type = "button";
    clearPriorityButton.setAttribute("role", "menuitemradio");
    clearPriorityButton.setAttribute("aria-checked", String(!task.priority));
    clearPriorityButton.innerHTML = '<span class="priority-clear-icon" aria-hidden="true">—</span><span>Без пріоритету</span>';
    clearPriorityButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setTaskPriority(task.id, null);
    });
    picker.append(clearPriorityButton);
  }

  if (showReminder) {
  const currentReminder = task.reminderAt ? new Date(task.reminderAt) : new Date(Date.now() + 3600000);
  const pickerFields = document.createElement("div");
  pickerFields.className = "reminder-picker-fields";
  const makeSelect = (label, values, selected) => {
    const wrapper = document.createElement("label");
    wrapper.className = "reminder-field";
    wrapper.innerHTML = `<span>${label}</span>`;
    const select = document.createElement("select");
    values.forEach(([value, text]) => {
      const option = new Option(text, value, value === selected, value === selected);
      select.append(option);
    });
    wrapper.append(select);
    pickerFields.append(wrapper);
    return select;
  };
  const days = Array.from({ length: 31 }, (_, index) => {
    const value = String(index + 1).padStart(2, "0");
    return [value, value];
  });
  const months = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"]
    .map((text, index) => [String(index), text]);
  const years = Array.from({ length: 7 }, (_, index) => {
    const year = String(new Date().getFullYear() - 1 + index); return [year, year];
  });
  const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
  const minutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
  const daySelect = makeSelect("День", days, String(currentReminder.getDate()).padStart(2, "0"));
  const monthSelect = makeSelect("Місяць", months, String(currentReminder.getMonth()));
  const yearSelect = makeSelect("Рік", years, String(currentReminder.getFullYear()));
  const hourSelect = makeSelect("Година", hours.map((value) => [value, value]), String(currentReminder.getHours()).padStart(2, "0"));
  const minuteSelect = makeSelect("Хвилини", minutes.map((value) => [value, value]), String(Math.round(currentReminder.getMinutes() / 5) * 5 % 60).padStart(2, "0"));

  const reminderActions = document.createElement("div");
  reminderActions.className = "reminder-picker-actions";
  const saveReminderButton = document.createElement("button");
  saveReminderButton.className = "priority-option reminder-action";
  saveReminderButton.type = "button";
  saveReminderButton.textContent = "Зберегти дату";
  saveReminderButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    const selectedDate = new Date(Number(yearSelect.value), Number(monthSelect.value), Number(daySelect.value), Number(hourSelect.value), Number(minuteSelect.value));
    task.reminderAt = selectedDate.toISOString();
    cancelNativeReminder(task.id);
    scheduleNativeReminder(task);
    closePriorityPicker();
    render();
    await saveState();
  });
  const removeReminderButton = document.createElement("button");
  removeReminderButton.className = "priority-option reminder-action reminder-remove-action";
  removeReminderButton.type = "button";
  removeReminderButton.textContent = "Прибрати нагадування";
  removeReminderButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    task.reminderAt = null;
    cancelNativeReminder(task.id);
    closePriorityPicker();
    render();
    await saveState();
  });
  reminderActions.append(saveReminderButton, removeReminderButton);
  picker.append(pickerFields, reminderActions);
  }

  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - pickerRect.width - 12);
  const top = Math.min(rect.bottom + 8, window.innerHeight - pickerRect.height - 12);
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
}

async function removeForever(id) {
  cancelNativeReminder(id);
  state.trash = state.trash.filter((task) => task.id !== id);
  render();
  await saveState();
}

async function completeTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  const nextReminderAt = getNextReminderAt(task);
  if (nextReminderAt) {
    cancelNativeReminder(id);
    task.reminderAt = nextReminderAt;
    task.done = false;
    scheduleNativeReminder(task);
    render();
    await saveState();
    return;
  }

  task.done = true;
  await moveToTrash(id, { openTrash: false });
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
  item.classList.remove("pressing", "dragging", "swiping");
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
      menuOpened: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: window.setTimeout(() => {
        if (!dragState || dragState.item !== item || dragState.active) return;
        dragState.menuOpened = true;
        item.classList.remove("pressing");
        openPriorityPicker(task, item, true);
      }, 560),
    };

    item.classList.add("pressing");
    item.setPointerCapture(event.pointerId);
  });

  item.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.item !== item || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const moveX = Math.abs(deltaX);
    const moveY = Math.abs(event.clientY - dragState.startY);
    if (!dragState.active && (moveX > 8 || moveY > 8)) {
      clearTimeout(dragState.timer);
      item.classList.remove("pressing");
      item.classList.toggle("swiping", moveX > 44 && moveY < 34);
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
    const isHorizontalSwipe = Math.abs(event.clientX - dragState.startX) > 64 && Math.abs(event.clientY - dragState.startY) < 34;
    if (isHorizontalSwipe && !dragState.active) {
      clearTimeout(dragState.timer);
      item.classList.remove("pressing", "swiping");
      dragState = null;
      openTaskTitleEditor(task);
      return;
    }
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
  if (task.reminderAt && mode !== "trash") {
    meta.classList.add("task-reminder-meta");
    meta.textContent = `Нагадати ${formatDate(task.reminderAt)}`;
  } else if (mode === "trash") {
    meta.textContent = `Видалено ${formatDate(task.deletedAt)}`;
  } else {
    meta.hidden = true;
  }
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
  const reminderTasks = state.tasks.filter((task) => task.reminderAt);
  els.taskList.replaceChildren(...visibleTasks.map((task) => makeTaskItem(task, "tasks")));
  els.trashList.replaceChildren(...reminderTasks.map((task) => makeTaskItem(task, "tasks")));
  els.taskCount.textContent = visibleTasks.length;
  els.trashCount.textContent = reminderTasks.length;
  rescheduleNativeReminders();
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
setupNewReminderPicker();
render();
if (ensureAppVersion()) initDatabase();
