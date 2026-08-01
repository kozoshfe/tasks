const SUPABASE_URL = "https://qzcapeempzzdhicsweqz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nXxnpG6C_RO9mVqcYEt1mg_Z9Z-dpDr";
const SUPABASE_TABLE = "tasks";
const LEGACY_STORAGE_KEY = "simple-task-pwa-state";
const PENDING_STORAGE_KEY = "simple-task-pwa-pending-state";
const APP_VERSION = "107";
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
  taskInput: document.querySelector("#taskInput"),
  taskReminder: document.querySelector("#taskReminder"),
  newReminderEnabled: document.querySelector("#newReminderEnabled"),
  newReminderDay: document.querySelector("#newReminderDay"),
  newReminderMonth: document.querySelector("#newReminderMonth"),
  newReminderYear: document.querySelector("#newReminderYear"),
  newReminderHour: document.querySelector("#newReminderHour"),
  newReminderMinute: document.querySelector("#newReminderMinute"),
  taskRepeat: document.querySelector("#taskRepeat"),
  taskModal: document.querySelector("#taskModal"),
  taskList: document.querySelector("#taskList"),
  taskFilterTabs: document.querySelectorAll("[data-task-filter]"),
  taskFilterCounts: document.querySelectorAll("[data-task-filter-count]"),
  mandatoryFilterTabs: document.querySelectorAll("[data-mandatory-filter]"),
  mandatoryFilterCounts: document.querySelectorAll("[data-mandatory-filter-count]"),
  appShell: document.querySelector(".app-shell"),
  tasksPanel: document.querySelector("#tasksPanel"),
  tasksTab: document.querySelector("#tasksTab"),
  trashList: document.querySelector("#trashList"),
  trashPanel: document.querySelector("#trashPanel"),
  trashTab: document.querySelector("#trashTab"),
  voiceStatus: document.querySelector("#voiceStatus"),
  accessScreen: document.querySelector("#accessScreen"),
  accessForm: document.querySelector("#accessForm"),
  accessEmail: document.querySelector("#accessEmail"),
  accessPassword: document.querySelector("#accessPassword"),
  accessError: document.querySelector("#accessError"),
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let supabaseClient = null;
let recognition = null;
let shouldAutoAddVoiceResult = false;
let dragState = null;
let navMicTapTimer = null;
let priorityPickerTaskId = null;
let activeTaskFilter = "all";
let activeMandatoryFilter = "one-time";
let taskFilterSwipe = null;
let mandatoryFilterSwipe = null;
let syncedTaskIds = new Set();
let appDataReady = false;
const earlyRecurringCompletionIds = new Set();
let earlyRecurringTapState = null;
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

function updateNewReminderVisibility() {
  els.taskReminder.hidden = !els.newReminderEnabled.checked;
  if (!els.newReminderEnabled.checked) els.taskRepeat.value = "none";
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

async function openApp() {
  if (appDataReady) return;
  if (!ensureAppVersion()) return;
  await initDatabase();
  appDataReady = true;
  document.body.classList.remove("access-locked");
  document.body.classList.remove("auth-pending");
  els.accessScreen.hidden = true;
  await processNativeNotificationAction();
}

function showAccessScreen() {
  appDataReady = false;
  document.body.classList.add("access-locked");
  document.body.classList.remove("auth-pending");
  els.accessScreen.hidden = false;
}

async function setupAccessGate() {
  if (!window.supabase) {
    showAccessScreen();
    els.accessError.textContent = "Не вдалося завантажити модуль входу. Перевірте інтернет.";
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await openApp(); else showAccessScreen();
  } catch (error) {
    console.error("Failed to restore the Supabase session:", error);
    showAccessScreen();
    els.accessError.textContent = "Не вдалося перевірити вхід. Спробуйте ще раз.";
  }

  els.accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = els.accessEmail.value.trim();
    const password = els.accessPassword.value;
    if (!email || !password) {
      els.accessError.textContent = "Введіть email і пароль.";
      return;
    }
    els.accessError.textContent = "";
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) els.accessError.textContent = "Не вдалося увійти: " + error.message;
  });
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session) await openApp(); else showAccessScreen();
  });
  els.accessEmail.focus();
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
    category: task?.category === "bookmarks" ? "bookmarks" : null,
    priority: isUrgentTaskTitle(task?.title || "") ? "high" : (hasPriority(priority) ? priority : null),
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

function getTaskCategory(task) {
  if (task.category === "bookmarks") return "bookmarks";
  const title = task.title.toLocaleLowerCase("uk-UA");
  const matches = [
    ["bookmarks", title.indexOf("заклад")],
    ["buy", title.indexOf("купит")],
    ["laptops", title.indexOf("ноутбук")],
  ].filter(([, index]) => index !== -1);

  if (matches.length) {
    matches.sort(([, firstIndex], [, secondIndex]) => firstIndex - secondIndex);
    return matches[0][0];
  }

  return null;
}

function getFilteredTasks() {
  const isReminderTask = (task) => Boolean(task.reminderAt);
  return state.tasks.filter((task) => {
    if (isReminderTask(task)) return false;
    const category = getTaskCategory(task);
    return activeTaskFilter === "all" ? category === null : category === activeTaskFilter;
  });
}

function getMandatoryTasks() {
  if (activeMandatoryFilter === "daily") {
    // Keep today's completed occurrences below the tasks that still need attention,
    // then show each group in the actual reminder-time order.
    return state.tasks
      .filter((task) => task.recurrence === "daily")
      .sort((first, second) => (
        Number(isRecurringTaskCompletedToday(first)) - Number(isRecurringTaskCompletedToday(second))
        || new Date(first.reminderAt).getTime() - new Date(second.reminderAt).getTime()
      ));
  }

  if (activeMandatoryFilter === "other") {
    return state.tasks
      .filter((task) => Boolean(task.recurrence) && task.recurrence !== "daily")
      .sort((first, second) => new Date(first.reminderAt).getTime() - new Date(second.reminderAt).getTime());
  }

  // Reminder tasks must be listed by their scheduled time, not by the order
  // in which they were created or by their priority.
  return state.tasks
    .filter((task) => Boolean(task.reminderAt) && !task.recurrence && !task.done)
    .sort((first, second) => new Date(first.reminderAt).getTime() - new Date(second.reminderAt).getTime());
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

function toDatabaseTask(task, isDeleted) {
  return {
    id: task.id,
    value: task.title,
    done: Boolean(task.done),
    priority: task.priority || null,
    category: task.category || null,
    created_at: new Date(task.createdAt || Date.now()).toISOString(),
    reminder_at: task.reminderAt || null,
    recurrence: task.recurrence || null,
    last_completed_at: task.lastCompletedAt ? new Date(task.lastCompletedAt).toISOString() : null,
    deleted_at: isDeleted ? new Date(task.deletedAt || Date.now()).toISOString() : null,
  };
}

function fromDatabaseTask(row) {
  return normalizeTask({
    id: row.id,
    title: row.value,
    done: row.done,
    priority: row.priority,
    category: row.category,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    reminderAt: row.reminder_at,
    recurrence: row.recurrence,
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).getTime() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  });
}

function setSyncStatus() {
  // Sync messages stay silent in the UI.
}

async function getSupabaseHeaders(extra = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("Потрібно увійти в акаунт.");
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
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

  const snapshot = getStateSnapshot();
  const rows = [
    ...snapshot.tasks.map((task) => toDatabaseTask(task, false)),
    ...snapshot.trash.map((task) => toDatabaseTask(task, true)),
  ];
  const currentIds = new Set(rows.map((task) => task.id));

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`, {
      method: "POST",
      headers: await getSupabaseHeaders({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(rows),
    });

    if (!response.ok) throw new Error(await parseSupabaseError(response));

    const removedIds = [...syncedTaskIds].filter((id) => !currentIds.has(id));
    if (removedIds.length) {
      const deleteResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=in.(${removedIds.join(",")})`,
        { method: "DELETE", headers: await getSupabaseHeaders() },
      );
      if (!deleteResponse.ok) throw new Error(await parseSupabaseError(deleteResponse));
    }

    syncedTaskIds = currentIds;
  } catch (error) {
    console.error("Failed to save tasks to Supabase:", error);
    setSyncStatus("Не збережено в базу: немає з'єднання", "error");
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
  let rows = null;
  let recoveredPending = false;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=*&order=created_at.asc`,
      {
        headers: await getSupabaseHeaders(),
      },
    );
    if (!response.ok) throw new Error(await parseSupabaseError(response));
    rows = await response.json();

    // Completed one-off tasks are not kept as history in the shared table.
    const completedOneOffIds = rows
      .filter((row) => row.done && !row.recurrence)
      .map((row) => row.id);
    if (completedOneOffIds.length) {
      const deleteResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=in.(${completedOneOffIds.join(",")})`,
        { method: "DELETE", headers: await getSupabaseHeaders() },
      );
      if (!deleteResponse.ok) throw new Error(await parseSupabaseError(deleteResponse));
      rows = rows.filter((row) => !completedOneOffIds.includes(row.id));
    }
  } catch (error) {
    console.error("Failed to load tasks from Supabase:", error);
    setSyncStatus("Не прочитано з бази", "error");
    if (hasTasks(pendingState)) applyState(pendingState);
    else if (hasTasks(legacyState)) applyState(legacyState);
    render();
    return;
  }

  // The shared database is the source of truth. A stale offline copy from a
  // different browser must never overwrite the current shared task list. Keep
  // only records missing from the database when a previous save was rejected
  // (for example, by an outdated database constraint).
  if (rows.length) {
    const databaseState = {
      tasks: rows.filter((row) => !row.deleted_at).map(fromDatabaseTask),
      trash: rows.filter((row) => row.deleted_at).map(fromDatabaseTask),
    };
    if (hasTasks(pendingState)) {
      const storedIds = new Set([...databaseState.tasks, ...databaseState.trash].map((task) => task.id));
      const missingTasks = pendingState.tasks.filter((task) => !storedIds.has(task.id));
      const missingTrash = pendingState.trash.filter((task) => !storedIds.has(task.id));
      recoveredPending = missingTasks.length > 0 || missingTrash.length > 0;
      databaseState.tasks.push(...missingTasks);
      databaseState.trash.push(...missingTrash);
    }
    applyState(databaseState);
    syncedTaskIds = new Set(rows.map((row) => row.id));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(PENDING_STORAGE_KEY);
  } else if (hasTasks(legacyState)) {
    applyState(legacyState);
    setSyncStatus("Локальні таски готові до збереження", "neutral");
  } else if (hasTasks(pendingState)) {
    applyState(pendingState);
    setSyncStatus("Локальні таски готові до збереження", "neutral");
  } else {
    applyState({ tasks: [], trash: [] });
    setSyncStatus("База підключена", "success");
  }

  render();
  if (recoveredPending) await saveState();
  if (!hasTasks(readPendingState())) setSyncStatus("База підключена", "success");
}

async function initDatabase() {
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

function parseTaskCategory(title) {
  const bookmarkCommand = /(?:^|\s)закладк[аи](?=\s|$)/iu;
  if (!bookmarkCommand.test(title)) return { title, category: null };

  const cleanTitle = title.replace(bookmarkCommand, " ").replace(/\s+/g, " ").trim();
  return { title: cleanTitle, category: "bookmarks" };
}

function isUrgentTaskTitle(title) {
  return title.toLocaleLowerCase("uk-UA").includes("терміново");
}

function createTask(title) {
  const parsedCategory = parseTaskCategory(title);
  const formattedTitle = formatTaskTitle(parsedCategory.title);
  return {
    id: crypto.randomUUID(),
    title: formattedTitle,
    done: false,
    createdAt: Date.now(),
    priority: isUrgentTaskTitle(formattedTitle) ? "high" : null,
    category: parsedCategory.category,
    reminderAt: null,
    recurrence: null,
  };
}

function parseVoiceReminder(text) {
  const months = {
    січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5,
    липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
  };
  const now = new Date();
  const weekdays = {
    понеділок: 1, понеділка: 1,
    вівторок: 2, вівторка: 2,
    середа: 3, середу: 3,
    четвер: 4, четверга: 4,
    "п’ятниця": 5, "п'ятниця": 5, пятниця: 5, "п’ятницю": 5, "п'ятницю": 5, пятницю: 5,
    субота: 6, суботу: 6,
    неділя: 0, неділю: 0,
  };
  const weekdayMatch = text.match(/(?:^|\s)(понеділок|понеділка|вівторок|вівторка|середа|середу|четвер|четверга|п[’']?ятниця|п[’']?ятницю|субота|суботу|неділя|неділю)(?=\s|$)(?:\s*(?:о|в))?\s*(\d{1,2})(?:\s*[:.,]\s*(\d{1,2}))?(?:\s*(?:та\s+)?год(?:ина|ині|ин)?\.?)?/i);
  if (weekdayMatch) {
    const targetDay = weekdays[weekdayMatch[1].toLocaleLowerCase("uk-UA")];
    const reminderDate = new Date(now);
    let daysUntil = (targetDay - now.getDay() + 7) % 7;
    if (daysUntil === 0) daysUntil = 7;
    reminderDate.setDate(reminderDate.getDate() + daysUntil);
    reminderDate.setHours(Number(weekdayMatch[2]), Number(weekdayMatch[3] || 0), 0, 0);

    const title = text.replace(weekdayMatch[0], " ").replace(/^\s*(?:на|для)\s+/i, "").replace(/\s+/g, " ").trim();
    return { title: title || text, reminderAt: reminderDate.toISOString() };
  }
  const relativeMatch = text.match(/(?:^|\s)(сьогодні|завтра)(?=\s|$)(?:\s*(?:о|в))?\s*(\d{1,2})?(?:\s*[:.,]\s*(\d{1,2}))?/i);
  if (relativeMatch) {
    const reminderDate = new Date(now);
    if (relativeMatch[1].toLocaleLowerCase("uk-UA") === "завтра") {
      reminderDate.setDate(reminderDate.getDate() + 1);
    }

    const hasTime = relativeMatch[2] !== undefined;
    const roundedMinutes = Math.ceil((now.getMinutes() + 1) / 5) * 5;
    const hour = hasTime ? Number(relativeMatch[2]) : now.getHours() + Math.floor(roundedMinutes / 60);
    const minute = hasTime ? Number(relativeMatch[3] || 0) : roundedMinutes % 60;
    reminderDate.setHours(hour, minute, 0, 0);

    const title = text.replace(relativeMatch[0], " ").replace(/^\s*(?:на|для)\s+/i, "").replace(/\s+/g, " ").trim();
    return { title: title || text, reminderAt: reminderDate.toISOString() };
  }

  const match = text.match(/(?:на\s+)?(\d{1,2})\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|жовтня|листопада|грудня)(?:\s+(\d{4}))?\s*(?:о|в)\s*(\d{1,2})(?:\s*[:.,]\s*(\d{1,2}))?/i);
  if (!match) return { title: text, reminderAt: null };

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

// The Android home-screen widget cannot access WebView storage directly.
// Keep it supplied with the current active task list whenever the UI changes.
function syncAndroidWidget() {
  try {
    window.AndroidWidget?.sync?.(JSON.stringify(state.tasks.map((task) => ({
      id: String(task.id),
      title: task.title,
      category: task.category,
      // Send a numeric timestamp so the native widget is independent of the
      // date string format returned by Supabase.
      reminderAt: task.reminderAt ? new Date(task.reminderAt).getTime() : null,
      recurrence: task.recurrence,
      done: Boolean(task.done),
    }))));
  } catch (_) {}
}

async function addTask() {
  const title = els.taskInput.value.trim();
  if (!title) {
    els.taskInput.focus();
    return;
  }

  const parsedTitle = parseVoiceReminder(title);
  const task = createTask(parsedTitle.title);
  if (!task.title) {
    els.taskInput.focus();
    return;
  }
  task.reminderAt = parsedTitle.reminderAt || (els.newReminderEnabled.checked ? getNewReminderValue() : null);
  task.recurrence = task.reminderAt && els.taskRepeat.value !== "none"
    ? expandRecurrence(els.taskRepeat.value, new Date(task.reminderAt)) : null;
  state.tasks.push(task);
  scheduleNativeReminder(task);
  els.taskInput.value = "";
  els.newReminderEnabled.checked = false;
  updateNewReminderVisibility();
  els.taskRepeat.value = "none";
  closeTaskModal();
  render();
  await saveState();
}

async function addTaskFromTitle(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return false;

  const parsed = parseVoiceReminder(cleanTitle);
  const task = createTask(parsed.title);
  if (!task.title) return false;
  task.reminderAt = parsed.reminderAt;
  state.tasks.push(task);
  scheduleNativeReminder(task);
  render();
  return await saveState();
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

  const priorityLabel = document.createElement("label");
  priorityLabel.className = "input-label priority-editor-label";
  priorityLabel.textContent = "Пріоритет";
  const prioritySelect = document.createElement("select");
  prioritySelect.className = "priority-editor-select";
  prioritySelect.setAttribute("aria-label", "Пріоритет таски");
  prioritySelect.append(
    new Option("Без пріоритету", ""),
    ...Object.entries(PRIORITIES).map(([priority, details]) => new Option(details.label, priority)),
  );
  prioritySelect.value = hasPriority(task.priority) ? task.priority : "";
  priorityLabel.append(prioritySelect);

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
    task.priority = hasPriority(prioritySelect.value) ? prioritySelect.value : null;
    if (isUrgentTaskTitle(title)) task.priority = "high";
    close();
    render();
    await saveState();
  };
  saveButton.addEventListener("click", save);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") save(); });
  card.append(heading, label, priorityLabel, saveButton);
  backdrop.append(card);
  document.body.append(backdrop);
  window.requestAnimationFrame(() => {
    backdrop.classList.add("open");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
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

const UKRAINIAN_MONTHS_GENITIVE = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function expandRecurrence(recurrence, date) {
  if (recurrence === "weekly-date") return `weekly-${date.getDay()}`;
  if (recurrence === "monthly-date") return `monthly-day-${date.getDate()}`;
  if (recurrence === "yearly-date") return `yearly-${date.getMonth() + 1}-${date.getDate()}`;
  return recurrence;
}

function normalizeRecurrenceForDate(recurrence, date) {
  if (recurrence === "weekly-monday") return "weekly-1";
  if (recurrence === "monthly-20") return "monthly-day-20";
  return expandRecurrence(recurrence, date);
}

function getRecurrenceOptions(date) {
  const weekday = new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(date);
  const dateLabel = `${date.getDate()} ${UKRAINIAN_MONTHS_GENITIVE[date.getMonth()]}`;
  return [
    ["none", "Не повторювати"],
    ["daily", "Щодня"],
    [`weekly-${date.getDay()}`, `Щотижня в ${weekday}`],
    [`monthly-day-${date.getDate()}`, `Щомісяця ${date.getDate()} числа`],
    ["monthly-last-day", "Щомісяця в останній день"],
    [`yearly-${date.getMonth() + 1}-${date.getDate()}`, `Щороку ${dateLabel}`],
  ];
}

function getNextReminderAt(task) {
  const now = new Date();
  const next = new Date(task.reminderAt || now);

  if (task.recurrence === "daily") {
    do next.setDate(next.getDate() + 1); while (next <= now);
  } else if (/^weekly-\d$/.test(task.recurrence || "") || task.recurrence === "weekly-monday") {
    const weekday = task.recurrence === "weekly-monday" ? 1 : Number(task.recurrence.slice(-1));
    do next.setDate(next.getDate() + 1); while (next.getDay() !== weekday || next <= now);
  } else if (/^monthly-day-\d{1,2}$/.test(task.recurrence || "") || task.recurrence === "monthly-20") {
    const day = task.recurrence === "monthly-20" ? 20 : Number(task.recurrence.replace("monthly-day-", ""));
    do {
      next.setMonth(next.getMonth() + 1, 1);
      next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
    } while (next <= now);
  } else if (task.recurrence === "monthly-last-day") {
    do {
      next.setMonth(next.getMonth() + 1, 1);
      next.setDate(daysInMonth(next.getFullYear(), next.getMonth()));
    } while (next <= now);
  } else if (/^yearly-\d{1,2}-\d{1,2}$/.test(task.recurrence || "")) {
    const [, month, day] = task.recurrence.match(/^yearly-(\d{1,2})-(\d{1,2})$/).map(Number);
    do {
      next.setFullYear(next.getFullYear() + 1, month - 1, 1);
      next.setDate(Math.min(day, daysInMonth(next.getFullYear(), month - 1)));
    } while (next <= now);
  } else {
    return null;
  }

  return next.toISOString();
}

function isSameCalendarDay(first, second = new Date()) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

function isRecurringTaskCompletedToday(task) {
  return Boolean(task.recurrence && task.lastCompletedAt
    && isSameCalendarDay(new Date(task.lastCompletedAt)));
}

function isRecurringTaskReadyToComplete(task) {
  return Boolean(task.recurrence && (
    earlyRecurringCompletionIds.has(String(task.id))
    || (task.reminderAt && new Date(task.reminderAt).getTime() <= Date.now())
  ));
}

function registerEarlyRecurringTap(task) {
  const now = Date.now();
  const id = String(task.id);
  const isSameSequence = earlyRecurringTapState?.id === id
    && now - earlyRecurringTapState.lastTapAt <= 900;
  const taps = isSameSequence ? earlyRecurringTapState.taps + 1 : 1;
  earlyRecurringTapState = { id, taps, lastTapAt: now };

  if (taps < 3) return false;
  earlyRecurringCompletionIds.add(id);
  earlyRecurringTapState = null;
  return true;
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
  const recurrenceSelect = makeSelect(
    "Повторювати",
    getRecurrenceOptions(currentReminder),
    normalizeRecurrenceForDate(task.recurrence || "none", currentReminder),
  );
  recurrenceSelect.closest(".reminder-field")?.classList.add("reminder-recurrence-field");
  const updateRecurrenceOptions = () => {
    const selectedDate = new Date(Number(yearSelect.value), Number(monthSelect.value), Number(daySelect.value));
    const previousValue = recurrenceSelect.value;
    const nextValue = /^weekly-\d$/.test(previousValue) ? `weekly-${selectedDate.getDay()}`
      : /^monthly-day-\d{1,2}$/.test(previousValue) ? `monthly-day-${selectedDate.getDate()}`
        : /^yearly-\d{1,2}-\d{1,2}$/.test(previousValue)
          ? `yearly-${selectedDate.getMonth() + 1}-${selectedDate.getDate()}` : previousValue;
    recurrenceSelect.replaceChildren(...getRecurrenceOptions(selectedDate).map(([value, text]) => (
      new Option(text, value, value === nextValue, value === nextValue)
    )));
  };
  [daySelect, monthSelect, yearSelect].forEach((select) => {
    select.addEventListener("change", updateRecurrenceOptions);
  });

  const reminderActions = document.createElement("div");
  reminderActions.className = "reminder-picker-actions";
  const saveReminderButton = document.createElement("button");
  saveReminderButton.className = "priority-option reminder-action reminder-save-action";
  saveReminderButton.type = "button";
  saveReminderButton.textContent = "Зберегти дату";
  saveReminderButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    const selectedDate = new Date(Number(yearSelect.value), Number(monthSelect.value), Number(daySelect.value), Number(hourSelect.value), Number(minuteSelect.value));
    task.reminderAt = selectedDate.toISOString();
    task.recurrence = recurrenceSelect.value === "none" ? null : recurrenceSelect.value;
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
    task.recurrence = null;
    task.lastCompletedAt = null;
    cancelNativeReminder(task.id);
    closePriorityPicker();
    render();
    await saveState();
  });
  const deleteTaskButton = document.createElement("button");
  deleteTaskButton.className = "priority-option reminder-action reminder-delete-action";
  deleteTaskButton.type = "button";
  deleteTaskButton.textContent = "Видалити таску";
  deleteTaskButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    closePriorityPicker();
    await deleteTaskPermanently(task.id);
  });
  reminderActions.append(saveReminderButton, removeReminderButton, deleteTaskButton);
  picker.append(pickerFields, reminderActions);
  }

  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportHeight = viewport?.height || window.innerHeight;
  const viewportWidth = viewport?.width || window.innerWidth;
  picker.style.maxHeight = `${Math.max(160, viewportHeight - 24)}px`;
  const pickerRect = picker.getBoundingClientRect();
  const left = Math.min(Math.max(viewportLeft + 12, rect.left), viewportLeft + viewportWidth - pickerRect.width - 12);
  const top = Math.min(Math.max(viewportTop + 12, rect.bottom + 8), viewportTop + viewportHeight - pickerRect.height - 12);
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
}

async function deleteTaskPermanently(id) {
  cancelNativeReminder(id);
  state.tasks = state.tasks.filter((task) => task.id !== id);
  state.trash = state.trash.filter((task) => task.id !== id);
  render();
  await saveState();
}

async function removeForever(id) {
  await deleteTaskPermanently(id);
}

async function completeTask(id, { force = false } = {}) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  if (task.recurrence && !force && !isRecurringTaskReadyToComplete(task)) return;
  earlyRecurringCompletionIds.delete(String(id));
  const nextReminderAt = getNextReminderAt(task);
  if (nextReminderAt) {
    if (isRecurringTaskCompletedToday(task)) return;
    cancelNativeReminder(id);
    task.reminderAt = nextReminderAt;
    task.done = false;
    task.lastCompletedAt = Date.now();
    scheduleNativeReminder(task);
    render();
    await saveState();
    return;
  }

  // A completed task without recurrence has no next occurrence, so remove it
  // completely instead of leaving a completed row in the database.
  cancelNativeReminder(id);
  state.tasks = state.tasks.filter((item) => item.id !== id);
  render();
  await saveState();
}

async function snoozeTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !task.reminderAt) return false;

  // Snoozing is relative to the moment the notification action is tapped, so
  // an overdue reminder is still useful instead of remaining in the past.
  cancelNativeReminder(id);
  task.reminderAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  task.done = false;
  scheduleNativeReminder(task);
  render();
  await saveState();
  return true;
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
      // Horizontal gestures are reserved for moving between task screens.
      // Do not open the editor when the finger finishes a swipe on a card.
      event.preventDefault();
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
  const completedToday = isRecurringTaskCompletedToday(task);
  const notReadyYet = Boolean(task.recurrence && !completedToday && !isRecurringTaskReadyToComplete(task));

  const checkButton = document.createElement("button");
  checkButton.className = `check-button${completedToday ? " completed-today" : ""}${notReadyYet ? " not-ready-yet" : ""}`;
  checkButton.type = "button";
  checkButton.textContent = task.done || completedToday ? "✓" : "";
  checkButton.setAttribute("aria-label", completedToday ? "Виконано сьогодні" : notReadyYet ? `Доступно після ${formatDate(task.reminderAt)}` : task.done ? "Позначити активним" : "Позначити виконаним");
  checkButton.setAttribute("aria-pressed", String(task.done || completedToday));
  if (completedToday) checkButton.title = "Виконано сьогодні";
  if (notReadyYet) checkButton.title = `Можна відмітити після ${formatDate(task.reminderAt)}`;
  checkButton.disabled = mode === "trash";
  checkButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (completedToday) return;
    if (notReadyYet) {
      if (registerEarlyRecurringTap(task)) render();
      return;
    }
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
    meta.textContent = completedToday
      ? `Виконано сьогодні · Наступне ${formatDate(task.reminderAt)}`
      : `Нагадати ${formatDate(task.reminderAt)}`;
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
    if (event.detail === 2) {
      event.preventDefault();
      openTaskTitleEditor(task);
      return;
    }
    if (event.detail === 3) {
      event.preventDefault();
      openPriorityPicker(task, item);
    }
  });

  setupTaskReorder(item, task, mode);
  return item;
}

function renderTaskList() {
  const visibleTasks = getFilteredTasks();
  els.taskList.replaceChildren(...visibleTasks.map((task) => makeTaskItem(task, "tasks")));
}

function renderMandatoryTaskList() {
  const mandatoryTasks = getMandatoryTasks();
  els.trashList.replaceChildren(...mandatoryTasks.map((task) => makeTaskItem(task, "tasks")));
}

function animateFilterChange(list, direction) {
  if (!direction || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const animationClass = direction === "next" ? "filter-swipe-next" : "filter-swipe-previous";
  list.classList.remove("filter-swipe-next", "filter-swipe-previous");
  // Restart the animation when the user changes filters repeatedly.
  void list.offsetWidth;
  list.classList.add(animationClass);
  list.addEventListener("animationend", () => list.classList.remove(animationClass), { once: true });
}

function render() {
  sortActiveTasks();
  const regularTasks = state.tasks.filter((task) => !task.reminderAt);
  els.taskFilterCounts.forEach((count) => {
    const filter = count.dataset.taskFilterCount;
    count.textContent = regularTasks.filter((task) => {
      const category = getTaskCategory(task);
      return filter === "all" ? category === null : category === filter;
    }).length;
  });
  els.mandatoryFilterCounts.forEach((count) => {
    const filter = count.dataset.mandatoryFilterCount;
    count.textContent = state.tasks.filter((task) => (
      filter === "daily" ? task.recurrence === "daily"
        : filter === "other" ? Boolean(task.recurrence) && task.recurrence !== "daily"
          : Boolean(task.reminderAt) && !task.recurrence
    )).length;
  });
  renderTaskList();
  renderMandatoryTaskList();
  rescheduleNativeReminders();
  syncAndroidWidget();
}

window.openTaskFromNotification = (taskId) => {
  // The Android activity may finish loading this script before Supabase has
  // restored the list. Tell native code to retry instead of losing the task ID.
  if (!appDataReady) return false;
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (!task) return false;

  const isReminderTask = Boolean(task.reminderAt);
  const taskFilter = getTaskCategory(task) || "all";
  setTaskFilter(taskFilter);
  switchTab(isReminderTask ? "trash" : "tasks");
  if (isReminderTask && task.recurrence) setMandatoryFilter(task.recurrence === "daily" ? "daily" : "other");
  const taskItem = (isReminderTask ? els.trashList : els.taskList)
    .querySelector(`.task-item[data-task-id="${CSS.escape(taskId)}"]`);
  if (!taskItem) return false;

  taskItem.scrollIntoView({ behavior: "smooth", block: "center" });
  taskItem.classList.add("notification-target");
  window.setTimeout(() => taskItem.classList.remove("notification-target"), 3000);
  return true;
};

async function applyNotificationAction(taskId, action) {
  const task = state.tasks.find((item) => String(item.id) === String(taskId));
  if (!task) return false;
  if (action === "complete") await completeTask(task.id, { force: true });
  else if (action === "snooze") await snoozeTask(task.id);
  else return false;
  return true;
}

async function processNativeNotificationAction() {
  let rawAction = null;
  try {
    rawAction = window.AndroidNotificationActions?.peek?.();
  } catch (_) {
    return;
  }
  if (!rawAction) return;

  try {
    const { taskId, action } = JSON.parse(rawAction);
    if (await applyNotificationAction(taskId, action)) {
      window.AndroidNotificationActions?.clear?.();
      window.AndroidNotificationActionCallback?.complete?.();
    }
  } catch (error) {
    console.error("Failed to apply notification action:", error);
  }
}

window.handleNotificationAction = (taskId, action) => {
  if (!appDataReady) return false;
  void applyNotificationAction(taskId, action);
  return true;
};

// Called by the microphone button on the Android home-screen widget.
window.startVoiceTaskFromWidget = () => addVoiceTask();
window.addVoiceTaskFromWidget = async (text) => {
  // The tiny native voice window may finish loading before Supabase has
  // restored the task list. Wait so a new voice task cannot be overwritten.
  for (let attempt = 0; attempt < 50 && !appDataReady; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  if (!appDataReady) return false;
  return await addTaskFromTitle(String(text || ""));
};

function setTaskFilter(filterName, { direction = null } = {}) {
  if (filterName === activeTaskFilter) return;
  activeTaskFilter = filterName;
  els.taskFilterTabs.forEach((tab) => {
    const isActive = tab.dataset.taskFilter === activeTaskFilter;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderTaskList();
  animateFilterChange(els.taskList, direction);
}

function setMandatoryFilter(filterName, { direction = null } = {}) {
  if (filterName === activeMandatoryFilter) return;
  activeMandatoryFilter = filterName;
  els.mandatoryFilterTabs.forEach((tab) => {
    const isActive = tab.dataset.mandatoryFilter === activeMandatoryFilter;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderMandatoryTaskList();
  animateFilterChange(els.trashList, direction);
}

function setupTaskFilterSwipe() {
  const filterOrder = ["all", "bookmarks", "buy", "laptops"];
  const swipeThreshold = 64;

  const isTasksSwipeArea = (event) => {
    if (els.tasksPanel.hidden || event.pointerType !== "touch") return false;
    // Cards are included deliberately: when the list fills the screen there
    // is no empty area left from which to change screens.
    return !event.target.closest("button, input, select, textarea, a");
  };

  els.appShell.addEventListener("pointerdown", (event) => {
    if (!isTasksSwipeArea(event)) return;
    taskFilterSwipe = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  });

  els.appShell.addEventListener("pointerup", (event) => {
    if (!taskFilterSwipe || taskFilterSwipe.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - taskFilterSwipe.startX;
    const deltaY = event.clientY - taskFilterSwipe.startY;
    taskFilterSwipe = null;

    if (Math.abs(deltaX) < swipeThreshold || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    const currentIndex = filterOrder.indexOf(activeTaskFilter);
    const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
    if (nextIndex >= 0 && nextIndex < filterOrder.length) {
      setTaskFilter(filterOrder[nextIndex], { direction: deltaX < 0 ? "next" : "previous" });
    }
  });

  els.appShell.addEventListener("pointercancel", () => {
    taskFilterSwipe = null;
  });
}

function setupMandatoryFilterSwipe() {
  const filterOrder = ["one-time", "daily", "other"];
  const swipeThreshold = 64;

  const isMandatorySwipeArea = (event) => {
    if (els.trashPanel.hidden || event.pointerType !== "touch") return false;
    return !event.target.closest("button, input, select, textarea, a");
  };

  els.appShell.addEventListener("pointerdown", (event) => {
    if (!isMandatorySwipeArea(event)) return;
    mandatoryFilterSwipe = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  });

  els.appShell.addEventListener("pointerup", (event) => {
    if (!mandatoryFilterSwipe || mandatoryFilterSwipe.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - mandatoryFilterSwipe.startX;
    const deltaY = event.clientY - mandatoryFilterSwipe.startY;
    mandatoryFilterSwipe = null;
    if (Math.abs(deltaX) < swipeThreshold || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    const currentIndex = filterOrder.indexOf(activeMandatoryFilter);
    const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
    if (nextIndex >= 0 && nextIndex < filterOrder.length) {
      setMandatoryFilter(filterOrder[nextIndex], { direction: deltaX < 0 ? "next" : "previous" });
    }
  });

  els.appShell.addEventListener("pointercancel", () => {
    mandatoryFilterSwipe = null;
  });
}

function switchTab(tabName) {
  const showTasks = tabName === "tasks";
  // The mandatory screen always opens on one-time reminders first.
  if (!showTasks) setMandatoryFilter("one-time");
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
els.mandatoryFilterTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMandatoryFilter(tab.dataset.mandatoryFilter));
});
setupTaskFilterSwipe();
setupMandatoryFilterSwipe();
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
els.newReminderEnabled.addEventListener("change", updateNewReminderVisibility);
updateNewReminderVisibility();
render();
setupAccessGate();
