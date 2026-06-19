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

function api(path, options = {}, didRetry = false) {
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
      throw createApiError(data.detail || data.message || `HTTP ${response.status}`, data);
    }
    return data;
  }).catch((error) => {
    if (!didRetry && shouldRecoverApiBase(error)) {
      const fallback = normalizeApiBase(PUBLIC_CONFIG.apiBase || "https://conanbot.discloud.app");
      state.apiBase = fallback;
      localStorage.setItem(STORAGE.apiBase, fallback);
      const input = $("#api-base-input");
      if (input) input.value = fallback;
      return api(path, options, true);
    }

    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error(
        `Failed to fetch ${base}${path}. Check if the Discloud API is online and accepting CORS from this dashboard.`
      );
    }

    throw error;
  });
}

function createApiError(detail, data = {}) {
  const message = typeof detail === "string" ? detail : detail?.message || detail?.error || JSON.stringify(detail);
  const error = new Error(message || "Request failed");
  error.payload = data;
  error.detail = detail;
  return error;
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
  $("#page-title").textContent = pageTitle(name);
}

function pageTitle(name) {
  return {
    overview: "Overview",
    ai: "AI",
    triggers: "Triggers",
    commands: "Commands",
    games: "Games",
    "game-tictactoe": "Tic-tac-toe",
    "game-coinflip": "Coinflip",
    "game-eightball": "8-ball",
    "game-rps": "Rock Paper Scissors",
    "game-guesssong": "Guess the Song",
    "game-wyr": "Would You Rather",
    logs: "Logs",
  }[name] || name.charAt(0).toUpperCase() + name.slice(1);
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
    renderCommandSyncNotice();
    renderChannelSelectors();
    bindConfigToInputs();
    enhanceSelects();
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

function renderCommandSyncNotice() {
  const notice = $("#command-sync-notice");
  if (!notice) return;
  const sync = state.health?.bot?.commandSync || {};
  if (!sync.error && sync.status !== "forbidden") {
    notice.hidden = true;
    notice.innerHTML = "";
    return;
  }
  notice.hidden = false;
  notice.innerHTML = `
    <strong>Command sync needs access.</strong>
    <span>${escapeHtml(sync.error || "Reinvite the bot with bot + applications.commands scopes.")}</span>
    ${sync.inviteUrl ? `<button class="ghost" type="button" data-open-invite>Open invite</button>` : ""}
  `;
  const button = notice.querySelector("[data-open-invite]");
  if (button) button.onclick = () => window.open(sync.inviteUrl, "_blank", "noopener,noreferrer");
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

function shouldRecoverApiBase(error) {
  const fallback = normalizeApiBase(PUBLIC_CONFIG.apiBase || "https://conanbot.discloud.app");
  const current = normalizeApiBase(state.apiBase);
  if (!fallback || current === fallback) return false;
  if (error instanceof TypeError && /fetch/i.test(error.message)) return true;
  return isLocalOrDashboardHost(current);
}

function isLocalOrDashboardHost(value) {
  try {
    const host = new URL(value).host;
    return host === window.location.host || host === "localhost:8080" || host.startsWith("localhost") || host.startsWith("127.0.0.1");
  } catch {
    return false;
  }
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
    const defaults = state.health?.defaults || {};
    const channels = [...state.channels];
    if (defaults.aiChannelId && !channels.some((channel) => channel.id === defaults.aiChannelId)) {
      channels.unshift({
        id: defaults.aiChannelId,
        name: "Configured AI channel",
      });
    }
    select.innerHTML = `<option value="">Select channel</option>${channels
      .map((channel) => `<option value="${channel.id}">#${channel.name}</option>`)
      .join("")}`;
    select.value = current || "";
  });

  $$("[data-category-select]").forEach((select) => {
    const current = getPath(state.config, select.dataset.bind);
    const defaults = state.health?.defaults || {};
    const categories = [...state.categories];
    if (defaults.allowedCategoryId && !categories.some((category) => category.id === defaults.allowedCategoryId)) {
      categories.unshift({
        id: defaults.allowedCategoryId,
        name: "Configured category",
      });
    }
    select.innerHTML = `<option value="">Select category</option>${categories
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
    } else if (input.dataset.lines !== undefined) {
      input.value = Array.isArray(value) ? value.join("\n") : value || "";
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
      } else if (input.dataset.lines !== undefined) {
        nextValue = input.value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      } else if (input.dataset.array !== undefined) {
        nextValue = input.value.split(",").map((item) => item.trim()).filter(Boolean);
      } else {
        nextValue = input.value;
      }
      setPath(state.config, input.dataset.bind, nextValue);
    };
  });
}

function enhanceSelects() {
  $$("select").forEach((select) => {
    select.classList.add("native-select-hidden");
    let shell = select.nextElementSibling;
    if (!shell || !shell.classList.contains("select-ui")) {
      shell = document.createElement("div");
      shell.className = "select-ui";
      shell.innerHTML = `<button type="button" class="select-button"></button><div class="select-menu"></div>`;
      select.insertAdjacentElement("afterend", shell);
    }

    const button = shell.querySelector(".select-button");
    const menu = shell.querySelector(".select-menu");
    const updateButton = () => {
      const selected = select.options[select.selectedIndex];
      button.textContent = selected ? selected.textContent : "Select option";
      button.classList.toggle("placeholder", !select.value);
    };

    menu.innerHTML = Array.from(select.options)
      .map(
        (option) => `
          <button type="button" class="select-option ${option.value === select.value ? "active" : ""}" data-value="${escapeAttr(option.value)}">
            ${escapeHtml(option.textContent || "")}
          </button>`
      )
      .join("");

    button.onclick = (event) => {
      event.preventDefault();
      $$(".select-ui.open").forEach((item) => {
        if (item !== shell) item.classList.remove("open");
      });
      shell.classList.toggle("open");
    };

    $$(".select-option", menu).forEach((item) => {
      item.onclick = (event) => {
        event.preventDefault();
        select.value = item.dataset.value || "";
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        shell.classList.remove("open");
        enhanceSelects();
      };
    });

    updateButton();
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".select-ui")) {
    $$(".select-ui.open").forEach((item) => item.classList.remove("open"));
  }
});

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
  try {
    await api(`/api/discord/${state.guildId}/sync-commands`, { method: "POST", body: "{}" });
    toast("Slash commands synced.");
    await refreshAll();
  } catch (error) {
    const inviteUrl = error.detail?.inviteUrl || error.payload?.detail?.inviteUrl || state.health?.bot?.commandSync?.inviteUrl;
    if (inviteUrl) {
      toast("Missing access. Opening bot invite...");
      window.open(inviteUrl, "_blank", "noopener,noreferrer");
    } else {
      toast(error.message);
    }
    await refreshAll().catch(() => {});
  }
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function init() {
  state.apiBase = normalizeApiBase(state.apiBase);
  const fallback = normalizeApiBase(PUBLIC_CONFIG.apiBase || "https://conanbot.discloud.app");
  if (fallback && isLocalOrDashboardHost(state.apiBase)) {
    state.apiBase = fallback;
    localStorage.setItem(STORAGE.apiBase, fallback);
  }
  $("#api-base-input").value = state.apiBase;
  $("#dashboard-key-input").value = state.key;
  $("#guild-id-input").value = state.guildId;
  $("#connect-btn").onclick = () => connect().catch((error) => toast(error.message));
  $("#refresh-btn").onclick = () => refreshAll().then(() => toast("Refreshed.")).catch((error) => toast(error.message));
  $("#save-btn").onclick = () => saveConfig().catch((error) => toast(error.message));
  $("#add-trigger-btn").onclick = addTrigger;
  $("#sync-commands-btn").onclick = () => syncCommands().catch((error) => toast(error.message));
  $("#invite-bot-btn").onclick = () => {
    const inviteUrl = state.health?.bot?.commandSync?.inviteUrl;
    if (inviteUrl) window.open(inviteUrl, "_blank", "noopener,noreferrer");
    else toast("Connect the dashboard first.");
  };
  $$(".nav-item").forEach((button) => (button.onclick = () => showPage(button.dataset.page)));
  $$("[data-page-link]").forEach((button) => (button.onclick = () => showPage(button.dataset.pageLink)));

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
