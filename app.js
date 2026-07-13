const SUPABASE_URL = "https://qzcapeempzzdhicsweqz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nXxnpG6C_RO9mVqcYEt1mg_Z9Z-dpDr";
const SUPABASE_TABLE = "tasks_state";
const SUPABASE_ROW_ID = "simple-task-pwa-main";
const LEGACY_STORAGE_KEY = "simple-task-pwa-state";
const PENDING_STORAGE_KEY = "simple-task-pwa-pending-state";

const els = {
  addButton: document.querySelector("#addButton"),
  closeInstallModalButton: document.querySelector("#closeInstallModalButton"),
  closeTaskModalButton: document.querySelector("#closeTaskModalButton"),
  installModal: document.querySelector("#installModal"),
  installButton: document.querySelector("#installButton"),
  micButton: document.querySelector("#micButton"),
  navMicButton: document.querySelector("#navMicButton"),
  submitTaskButton: document.querySelector("#submitTaskButton"),
  taskCount: document.querySelector("#taskCount"),
  taskInput: document.querySelector("#taskInput"),
  taskModal: document.querySelector("#taskModal"),
  taskList: document.querySelector("#taskList"),
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
let realtimeChannel = null;
let installPrompt = null;
let recognition = null;
let shouldAutoAddVoiceResult = false;
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
const isAppleTouchDevice = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

const state = {
  tasks: [],
  trash: [],
};

function normalizeState(value) {
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    trash: Array.isArray(value?.trash) ? value.trash : [],
  };
}

function applyState(nextState) {
  const normalized = normalizeState(nextState);
  state.tasks = normalized.tasks;
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
  return {
    tasks: state.tasks,
    trash: state.trash,
  };
}

function setSyncStatus() {
  // Sync messages stay silent in the UI.
}

async function saveState() {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(getStateSnapshot()));
  setSyncStatus("Зберігаю...", "neutral");

  if (!supabaseClient) {
    console.error("Supabase client is not ready.");
    setSyncStatus("Не підключено до бази. Збережено тимчасово.", "error");
    return false;
  }

  const { error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .upsert(
      {
        id: SUPABASE_ROW_ID,
        state: getStateSnapshot(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (error) {
    console.error("Failed to save tasks to Supabase:", error);
    setSyncStatus(`Не збережено в базу: ${error.message}`, "error");
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

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .select("state")
    .eq("id", SUPABASE_ROW_ID)
    .maybeSingle();

  const legacyState = readLegacyState();
  const pendingState = readPendingState();

  if (error) {
    console.error("Failed to load tasks from Supabase:", error);
    setSyncStatus(`Не прочитано з бази: ${error.message}`, "error");
    if (hasTasks(pendingState)) {
      applyState(pendingState);
    } else if (hasTasks(legacyState)) {
      applyState(legacyState);
    }
    render();
    return;
  }

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

function subscribeRealtime() {
  if (!supabaseClient || realtimeChannel) return;

  realtimeChannel = supabaseClient
    .channel("tasks-state")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: SUPABASE_TABLE,
        filter: `id=eq.${SUPABASE_ROW_ID}`,
      },
      (payload) => {
        if (!payload.new?.state) return;
        applyState(payload.new.state);
        render();
      },
    )
    .subscribe();
}

async function initDatabase() {
  if (!window.supabase?.createClient) {
    console.error("Supabase library is not loaded.");
    setSyncStatus("Supabase бібліотека не завантажилась", "error");
    render();
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadState();
  subscribeRealtime();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function createTask(title) {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    done: false,
    createdAt: Date.now(),
  };
}

async function addTask() {
  const title = els.taskInput.value.trim();
  if (!title) {
    els.taskInput.focus();
    return;
  }

  state.tasks.unshift(createTask(title));
  els.taskInput.value = "";
  closeTaskModal();
  render();
  await saveState();
}

async function addTaskFromTitle(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  state.tasks.unshift(createTask(cleanTitle));
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

function closeTaskModal() {
  els.taskModal.classList.remove("open");
  els.taskModal.hidden = true;
  els.voiceStatus.textContent = "";
}

function openInstallModal() {
  els.installModal.hidden = false;
  window.requestAnimationFrame(() => els.installModal.classList.add("open"));
}

function closeInstallModal() {
  els.installModal.classList.remove("open");
  els.installModal.hidden = true;
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
  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = task.title;
  const meta = document.createElement("span");
  meta.className = "task-meta";
  meta.textContent = mode === "trash" ? `Видалено ${formatDate(task.deletedAt)}` : `Створено ${formatDate(task.createdAt)}`;
  text.append(title, meta);

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
  return item;
}

function render() {
  els.taskList.replaceChildren(...state.tasks.map((task) => makeTaskItem(task, "tasks")));
  els.trashList.replaceChildren(...state.trash.map((task) => makeTaskItem(task, "trash")));
  els.taskCount.textContent = state.tasks.length;
  els.trashCount.textContent = state.trash.length;
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
    els.navMicButton.disabled = true;
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

els.addButton.addEventListener("click", openTaskModal);
els.submitTaskButton.addEventListener("click", addTask);
els.closeTaskModalButton.addEventListener("click", closeTaskModal);
els.closeInstallModalButton.addEventListener("click", closeInstallModal);
els.taskModal.addEventListener("click", (event) => {
  if (event.target === els.taskModal) closeTaskModal();
});
els.installModal.addEventListener("click", (event) => {
  if (event.target === els.installModal) closeInstallModal();
});
els.taskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addTask();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.taskModal.hidden) closeTaskModal();
  if (event.key === "Escape" && !els.installModal.hidden) closeInstallModal();
});

els.tasksTab.addEventListener("click", () => switchTab("tasks"));
els.trashTab.addEventListener("click", () => switchTab("trash"));
els.navMicButton.addEventListener("click", addVoiceTask);

els.micButton.addEventListener("click", () => startVoiceInput());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  els.installButton.hidden = false;
});

els.installButton.addEventListener("click", async () => {
  if (isAppleTouchDevice && !installPrompt) {
    openInstallModal();
    return;
  }

  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  els.installButton.hidden = true;
});

if (isAppleTouchDevice && !isStandalone) {
  els.installButton.hidden = false;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

setupSpeechRecognition();
render();
initDatabase();
