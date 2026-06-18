const DEFAULT_GUILD_ID = "1513331636362809466";
const PUBLIC_CONFIG = window.CONAN_DASHBOARD_CONFIG || {};
const STORAGE = {
  apiBase: "conan-dashboard-api-base",
  key: "conan-dashboard-key",
  guildId: "conan-dashboard-guild-id",
};

let state = {
  apiBase: localStorage.getItem(STORAGE.apiBase) || PUBLIC_CONFIG.apiBase || window.location.origin,
  key: localStorage.getItem(STORAGE.key) || PUBLIC_CONFIG.dashboardKey || "",
  guildId: localStorage.getItem(STORAGE.guildId) || PUBLIC_CONFIG.guildId || DEFAULT_GUILD_ID,
  config: null,
  health: null,
  channels: [],
  categories: [],
  connected: false,
  refreshing: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove("show"), 2800);
}

function api(path, options = {}) {
  const base = normalizeApiBase(state.apiBase);
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Key": state.key,
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    return data;
  });
}

function getPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((acc, key) => {
    acc[key] ??= {};
    return acc[key];
  }, object);
  target[last] = value;
}

function showPage(name) {
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === name));
  $$(".page").forEach((page) => page.classList.toggle("active", page.dataset.pagePanel === name));
  $("#page-title").textContent = name.charAt(0).toUpperCase() + name.slice(1);
}

function setConnected(connected) {
  state.connected = connected;
  document.body.classList.toggle("is-connected", connected);
  $("#lock-card").hidden = connected;
  $("#pages").hidden = !connected;
  $("#save-btn").disabled = !connected;
}

async function connect() {
  state.apiBase = normalizeApiBase($("#api-base-input").value.trim() || window.location.origin);
  state.key = $("#dashboard-key-input").value;
  state.guildId = $("#guild-id-input").value.trim() || DEFAULT_GUILD_ID;
  localStorage.setItem(STORAGE.apiBase, state.apiBase);
  localStorage.setItem(STORAGE.key, state.key);
  localStorage.setItem(STORAGE.guildId, state.guildId);
  await refreshAll();
  setConnected(true);
  toast("Dashboard connected.");
}

async function refreshAll() {
  if (state.refreshing) return;
  state.refreshing = true;
  $("#refresh-btn").disabled = true;
  $("#refresh-btn").textContent = "Refreshing...";

  try {
    const [health, configData, discordData, logsData] = await Promise.all([
      api("/api/health"),
      api(`/api/config/${state.guildId}`),
      api(`/api/discord/${state.guildId}/channels`).catch(() => ({ channels: [], categories: [], botReady: false })),
      api(`/api/logs/${state.guildId}`).catch(() => ({ logs: [] })),
    ]);

    state.health = health;
    state.config = configData.config;
    normalizeConfigTheme();
    state.channels = discordData.channels || [];
    state.categories = discordData.categories || [];

    renderHealth();
    renderChannelSelectors();
    bindConfigToInputs();
    renderProviders();
    renderCommands();
    renderTriggers();
    renderLogs(logsData.logs || []);
  } finally {
    state.refreshing = false;
    $("#refresh-btn").disabled = false;
    $("#refresh-btn").textContent = "Refresh";
  }
}

function renderHealth() {
  const bot = state.health?.bot || {};
  const providers = state.health?.providers || {};
  const commandSync = bot.commandSync || {};
  const status = bot.status || (bot.ready ? "online" : bot.user ? "connecting" : "offline");
  const ready = status === "online";
  const connecting = ["starting", "connecting"].includes(status);
  const crashed = ["crashed", "closed", "stopped"].includes(status);
  const statusLabel = statusText(status);

  $("#side-status-dot").classList.toggle("ok", ready);
  $("#side-status-dot").classList.toggle("warn", connecting);
  $("#side-status-dot").classList.toggle("bad", crashed);
  $("#side-status").textContent = statusLabel;
  $("#side-latency").textContent = bot.error || (bot.latencyMs ? `${bot.latencyMs}ms latency` : bot.user || "Waiting for websocket");
  $("#metric-bot").textContent = statusLabel;
  $("#metric-user").textContent = bot.user || "Not logged in";
  $("#metric-latency").textContent = bot.latencyMs ? `${bot.latencyMs}ms` : "—";
  $("#metric-sync").textContent = syncText(commandSync.status);
  $("#metric-sync-detail").textContent = commandSync.error || "Slash commands";
  $("#metric-api").textContent = apiHost();
  $("#metric-api-detail").textContent = normalizeApiBase(state.apiBase);
  $("#metric-providers").textContent = Object.entries(providers)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(", ") || "None";
  $("#bot-ready-pill").textContent = ready ? "Bot websocket ready" : connecting ? "Bot is connecting..." : "Bot needs attention";
  $("#bot-ready-pill").classList.toggle("ok", ready);
  $("#bot-ready-pill").classList.toggle("warn", connecting);
  $("#bot-ready-pill").classList.toggle("bad", crashed);
}

function statusText(status) {
  return {
    online: "Bot online",
    connecting: "Bot connecting",
    starting: "Bot starting",
    crashed: "Bot crashed",
    closed: "Bot closed",
    stopped: "Bot stopped",
    not_configured: "Bot not configured",
    offline: "Bot offline",
  }[status] || "Bot unknown";
}

function syncText(status) {
  return {
    ok: "Synced",
    pending: "Pending",
    forbidden: "Missing access",
    failed: "Failed",
    not_started: "Not started",
    not_configured: "Not configured",
  }[status] || "Unknown";
}

function apiHost() {
  try {
    return new URL(normalizeApiBase(state.apiBase)).host;
  } catch {
    return state.apiBase || "Not set";
  }
}

function normalizeApiBase(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

function normalizeConfigTheme() {
  state.config.appearance ??= {};
  const current = String(state.config.appearance.accentColor || "").toLowerCase();
  const oldAccents = ["", "#f7b7c8", "#b9a7ff", "f7b7c8", "b9a7ff"];
  if (oldAccents.includes(current)) {
    state.config.appearance.accentColor = "#67e8f9";
  }
}

function renderChannelSelectors() {
  $$("[data-channel-select]").forEach((select) => {
    const current = getPath(state.config, select.dataset.bind);
    select.innerHTML = `<option value="">Select channel</option>${state.channels
      .map((channel) => `<option value="${channel.id}">#${channel.name}</option>`)
      .join("")}`;
    select.value = current || "";
  });

  $$("[data-category-select]").forEach((select) => {
    const current = getPath(state.config, select.dataset.bind);
    select.innerHTML = `<option value="">Select category</option>${state.categories
      .map((category) => `<option value="${category.id}">${category.name}</option>`)
      .join("")}`;
    select.value = current || "";
  });
}

function bindConfigToInputs() {
  $$("[data-bind]").forEach((input) => {
    const value = getPath(state.config, input.dataset.bind);
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else if (input.dataset.array !== undefined) {
      input.value = Array.isArray(value) ? value.join(", ") : value || "";
    } else {
      input.value = value ?? "";
    }

    input.oninput = () => {
      let nextValue;
      if (input.type === "checkbox") {
        nextValue = input.checked;
      } else if (input.type === "number") {
        nextValue = Number(input.value);
      } else if (input.dataset.array !== undefined) {
        nextValue = input.value.split(",").map((item) => item.trim()).filter(Boolean);
      } else {
        nextValue = input.value;
      }
      setPath(state.config, input.dataset.bind, nextValue);
    };
  });
}

function renderProviders() {
  const providers = state.config.ai.providerOrder || [];
  $("#provider-list").innerHTML = providers
    .map((provider, index) => `<div class="command-toggle"><strong>${index + 1}. ${provider}</strong><small>fallback provider</small></div>`)
    .join("");
}

function renderCommands() {
  const commands = state.config.commands || {};
  $("#commands-grid").innerHTML = Object.entries(commands)
    .map(
      ([name, enabled]) => `
      <div class="command-toggle">
        <div>
          <strong>/${name}</strong>
          <small>${enabled ? "Enabled" : "Disabled"}</small>
        </div>
        <label class="switch">
          <input type="checkbox" data-command="${name}" ${enabled ? "checked" : ""}>
          <span></span>
        </label>
      </div>`
    )
    .join("");

  $$("[data-command]").forEach((input) => {
    input.onchange = () => {
      state.config.commands[input.dataset.command] = input.checked;
      renderCommands();
    };
  });
}

function renderTriggers() {
  const triggers = state.config.triggers || [];
  $("#triggers-list").innerHTML = triggers.length
    ? triggers.map(triggerTemplate).join("")
    : `<p class="muted">No triggers yet. Add one and let the chaos begin.</p>`;

  $$("[data-trigger-field]").forEach((input) => {
    input.oninput = () => {
      const trigger = state.config.triggers.find((item) => item.id === input.dataset.triggerId);
      if (!trigger) return;
      const field = input.dataset.triggerField;
      if (input.type === "checkbox") {
        trigger[field] = input.checked;
      } else if (field === "channelIds") {
        trigger[field] = input.value.split(",").map((item) => item.trim()).filter(Boolean);
      } else {
        trigger[field] = input.value;
      }
    };
  });

  $$("[data-remove-trigger]").forEach((button) => {
    button.onclick = () => {
      state.config.triggers = state.config.triggers.filter((item) => item.id !== button.dataset.removeTrigger);
      renderTriggers();
    };
  });
}

function triggerTemplate(trigger) {
  return `
    <div class="trigger-row">
      <label>
        Word
        <input data-trigger-id="${trigger.id}" data-trigger-field="word" value="${escapeAttr(trigger.word || "")}" placeholder="heather">
      </label>
      <label>
        Channel IDs
        <input data-trigger-id="${trigger.id}" data-trigger-field="channelIds" value="${escapeAttr((trigger.channelIds || []).join(", "))}" placeholder="empty = all category channels">
      </label>
      <label>
        Media URL
        <input data-trigger-id="${trigger.id}" data-trigger-field="mediaUrl" value="${escapeAttr(trigger.mediaUrl || "")}" placeholder="https://...gif">
      </label>
      <div class="top-actions">
        <label class="switch">
          <input type="checkbox" data-trigger-id="${trigger.id}" data-trigger-field="enabled" ${trigger.enabled !== false ? "checked" : ""}>
          <span></span>
        </label>
        <button class="ghost danger" data-remove-trigger="${trigger.id}">Remove</button>
      </div>
      <label style="grid-column: 1 / -1">
        Response text
        <input data-trigger-id="${trigger.id}" data-trigger-field="responseText" value="${escapeAttr(trigger.responseText || "")}" placeholder="Conan-coded moment detected.">
      </label>
    </div>`;
}

function renderLogs(logs) {
  $("#logs-list").innerHTML = logs.length
    ? logs
        .map(
          (log) => `
        <div class="log-row">
          <strong>${log.event || "event"}</strong>
          <small>${log.createdAt || ""}</small>
          <code>${escapeHtml(JSON.stringify(log.payload || {}, null, 2))}</code>
        </div>`
        )
        .join("")
    : `<p class="muted">No logs yet.</p>`;
}

async function saveConfig() {
  if (!state.config) {
    toast("Connect the dashboard first.");
    return;
  }
  await api(`/api/config/${state.guildId}`, {
    method: "PUT",
    body: JSON.stringify({ config: state.config }),
  });
  toast("Saved. Conan-coded settings updated.");
  await refreshAll();
}

function addTrigger() {
  if (!state.config) {
    toast("Connect the dashboard first.");
    return;
  }
  state.config.triggers ??= [];
  state.config.triggers.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    word: "",
    channelIds: [],
    mediaUrl: "",
    responseText: "Conan-coded moment detected.",
    enabled: true,
  });
  renderTriggers();
}

async function syncCommands() {
  await api(`/api/discord/${state.guildId}/sync-commands`, { method: "POST", body: "{}" });
  toast("Slash commands synced.");
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function init() {
  state.apiBase = normalizeApiBase(state.apiBase);
  $("#api-base-input").value = state.apiBase;
  $("#dashboard-key-input").value = state.key;
  $("#guild-id-input").value = state.guildId;
  $("#connect-btn").onclick = () => connect().catch((error) => toast(error.message));
  $("#refresh-btn").onclick = () => refreshAll().then(() => toast("Refreshed.")).catch((error) => toast(error.message));
  $("#save-btn").onclick = () => saveConfig().catch((error) => toast(error.message));
  $("#add-trigger-btn").onclick = addTrigger;
  $("#sync-commands-btn").onclick = () => syncCommands().catch((error) => toast(error.message));
  $$(".nav-item").forEach((button) => (button.onclick = () => showPage(button.dataset.page)));

  setConnected(false);

  if (state.key && state.apiBase) {
    refreshAll()
      .then(() => setConnected(true))
      .catch((error) => {
        setConnected(false);
        toast(`Could not connect: ${error.message}`);
      });
  }
}

init();
