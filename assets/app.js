const DEFAULT_GUILD_ID = "1513331636362809466";
const PUBLIC_CONFIG = window.CONAN_DASHBOARD_CONFIG || {};
const STORAGE = {
  apiBase: "conan-dashboard-api-base",
  key: "conan-dashboard-key",
  guildId: "conan-dashboard-guild-id",
  activePage: "conan-dashboard-active-page",
  sidebarCollapsed: "conan-dashboard-sidebar-collapsed",
  navGroups: "conan-dashboard-nav-groups",
  density: "conan-dashboard-density",
  reduceMotion: "conan-dashboard-reduce-motion",
};

let state = {
  apiBase: localStorage.getItem(STORAGE.apiBase) || PUBLIC_CONFIG.apiBase || window.location.origin,
  key: localStorage.getItem(STORAGE.key) || PUBLIC_CONFIG.dashboardKey || "",
  guildId: localStorage.getItem(STORAGE.guildId) || PUBLIC_CONFIG.guildId || DEFAULT_GUILD_ID,
  config: null,
  health: null,
  adminStatus: null,
  media: { items: [], stats: {}, drive: {} },
  commandSetup: { commands: [], syncStatus: "unknown", syncError: null },
  driveDiagnostic: null,
  channels: [],
  categories: [],
  connected: false,
  refreshing: false,
  dirty: false,
  currentPage: "overview",
};

const PAGE_ALIASES = {
  ai: "ai-behavior",
  media: "media-library",
  settings: "setup-ids",
  admin: "admin-permissions",
};

const PAGE_META = {
  overview: { section: "Workspace", title: "Overview", description: "Status, shortcuts, and the most important controls." },
  "setup-ids": { section: "Workspace", title: "Quick setup", description: "Important Discord IDs and shared connection targets." },
  "ai-behavior": { section: "AI Studio", title: "Behavior", description: "Response routing, triggers, generation limits, and cooldowns." },
  "ai-memory": { section: "AI Studio", title: "Branch memory", description: "Mention-created branches, reply continuity, and reset rules." },
  "ai-personality": { section: "AI Studio", title: "Personality", description: "Tone, response length, formatting, and custom instructions." },
  "ai-messages": { section: "AI Studio", title: "Replies & embeds", description: "Message templates, delivery limits, mentions, and embed styling." },
  "ai-actions": { section: "AI Studio", title: "Actions & feedback", description: "Unified embeds, AI game narration, deterministic results, and per-feature fallbacks." },
  "ai-providers": { section: "AI Studio", title: "Providers", description: "Fallback priority and provider availability." },
  "media-library": { section: "Media", title: "Library", description: "Browse and manage archived Discord photos and videos." },
  "media-intake": { section: "Media", title: "Archive intake", description: "Attachment rules, filenames, privacy, and upload feedback." },
  "media-drive": { section: "Media", title: "Google Drive", description: "Destination folder, active Drive identity, and connection testing." },
  triggers: { section: "Media", title: "Triggers", description: "Map words to media URLs and response text." },
  commands: { section: "Discord", title: "Command setup", description: "Control runtime availability and publish the exact Discord slash-command tree." },
  games: { section: "Games", title: "Game hub", description: "Global limits and links to every game configuration." },
  "game-tictactoe": { section: "Games", title: "Tic-tac-toe", description: "Board behavior, bot opponents, and result messages." },
  "game-coinflip": { section: "Games", title: "Coinflip", description: "Labels and result message customization." },
  "game-eightball": { section: "Games", title: "8-ball", description: "Custom answer pool and command availability." },
  "game-rps": { section: "Games", title: "Rock Paper Scissors", description: "Win, loss, and draw responses." },
  "game-guesssong": { section: "Games", title: "Guess the Song", description: "Reply-driven rounds, AI answer judging, attempts, and structured song clues." },
  "game-wyr": { section: "Games", title: "Would You Rather", description: "Question pool and enable state." },
  "admin-permissions": { section: "Administration", title: "Permissions", description: "Role-gated commands and admin feedback messages." },
  "admin-lifecycle": { section: "Administration", title: "Lifecycle", description: "Start, restart, stop, pause, or resume the bot." },
  "admin-memory": { section: "Administration", title: "Memory tools", description: "Inspect and clear channel or server branch memory." },
  "admin-presence": { section: "Administration", title: "Presence", description: "Discord status, activity type, and activity text." },
  appearance: { section: "System", title: "Appearance", description: "Discord embed styling and local dashboard preferences." },
  logs: { section: "System", title: "Logs", description: "Recent backend events and configuration activity." },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function icon(name) {
  return `<span class="icon" style="--icon: url('/assets/icons/${escapeAttr(name)}.svg')" aria-hidden="true"></span>`;
}

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

function readStoredNavGroups() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.navGroups) || "{}") || {};
  } catch {
    return {};
  }
}

function setNavGroupOpen(group, open, persist = true) {
  if (!group) return;
  group.classList.toggle("open", Boolean(open));
  group.querySelector(".nav-group-toggle")?.setAttribute("aria-expanded", String(Boolean(open)));
  if (!persist) return;
  const stored = readStoredNavGroups();
  stored[group.dataset.navGroup] = Boolean(open);
  localStorage.setItem(STORAGE.navGroups, JSON.stringify(stored));
}

function setMobileSidebar(open) {
  const isOpen = Boolean(open) && window.innerWidth <= 980;
  document.body.classList.toggle("sidebar-open", isOpen);
  const button = $("#mobile-nav-btn");
  const backdrop = $("#sidebar-backdrop");
  if (button) button.setAttribute("aria-expanded", String(isOpen));
  if (backdrop) backdrop.hidden = !isOpen;
}

function setSidebarCollapsed(collapsed, persist = true) {
  document.body.classList.toggle("sidebar-collapsed", Boolean(collapsed));
  const button = $("#sidebar-collapse-btn");
  if (button) {
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  const mode = $("#dashboard-sidebar-mode-select");
  if (mode) {
    mode.value = collapsed ? "compact" : "expanded";
    updateSelectShell(mode);
  }
  if (persist) localStorage.setItem(STORAGE.sidebarCollapsed, collapsed ? "1" : "0");
}

function applyUiPreferences() {
  const collapsed = localStorage.getItem(STORAGE.sidebarCollapsed) === "1";
  const density = localStorage.getItem(STORAGE.density) || "comfortable";
  const reduceMotion = localStorage.getItem(STORAGE.reduceMotion) === "1";
  setSidebarCollapsed(collapsed, false);
  document.body.dataset.density = density;
  document.body.classList.toggle("reduce-motion", reduceMotion);

  const densitySelect = $("#dashboard-density-select");
  const sidebarSelect = $("#dashboard-sidebar-mode-select");
  const motionInput = $("#dashboard-reduce-motion");
  if (densitySelect) densitySelect.value = density;
  if (sidebarSelect) sidebarSelect.value = collapsed ? "compact" : "expanded";
  if (motionInput) motionInput.checked = reduceMotion;
}

function filterNavigation(query) {
  const normalized = String(query || "").trim().toLowerCase();
  let visibleCount = 0;
  $$(".nav-group").forEach((group) => {
    if (normalized && group.dataset.preSearchOpen === undefined) {
      group.dataset.preSearchOpen = group.classList.contains("open") ? "1" : "0";
    }
    let groupMatches = 0;
    $$(".nav-item", group).forEach((item) => {
      const haystack = `${item.textContent} ${item.title || ""} ${item.dataset.page || ""}`.toLowerCase();
      const matches = !normalized || haystack.includes(normalized);
      item.hidden = !matches;
      if (matches) groupMatches += 1;
    });
    group.hidden = groupMatches === 0;
    visibleCount += groupMatches;
    if (normalized && groupMatches) setNavGroupOpen(group, true, false);
    if (!normalized && group.dataset.preSearchOpen !== undefined) {
      setNavGroupOpen(group, group.dataset.preSearchOpen === "1", false);
      delete group.dataset.preSearchOpen;
    }
  });
  const empty = $("#nav-empty");
  if (empty) empty.hidden = visibleCount > 0;
}

function initNavigation() {
  const storedGroups = readStoredNavGroups();
  $$(".nav-group").forEach((group) => {
    if (Object.hasOwn(storedGroups, group.dataset.navGroup)) {
      setNavGroupOpen(group, storedGroups[group.dataset.navGroup], false);
    }
    group.querySelector(".nav-group-toggle")?.addEventListener("click", () => {
      setNavGroupOpen(group, !group.classList.contains("open"));
    });
  });

  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });
  $$('[data-page-link]').forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.pageLink));
  });
  $$('[data-open-page]').forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.openPage));
  });

  const search = $("#nav-search-input");
  search?.addEventListener("input", () => filterNavigation(search.value));
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      search.value = "";
      filterNavigation("");
      search.blur();
    }
  });

  $("#sidebar-collapse-btn")?.addEventListener("click", () => {
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  });
  $("#mobile-nav-btn")?.addEventListener("click", () => {
    setMobileSidebar(!document.body.classList.contains("sidebar-open"));
  });
  $("#sidebar-backdrop")?.addEventListener("click", () => setMobileSidebar(false));
  $("#mobile-sidebar-close")?.addEventListener("click", () => setMobileSidebar(false));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (window.innerWidth <= 980) setMobileSidebar(true);
      search?.focus();
      search?.select();
    }
  });

  window.addEventListener("hashchange", () => showPage(pageFromLocation(), { skipHistory: true }));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setMobileSidebar(false);
  });

  showPage(pageFromLocation(), { skipHistory: Boolean(window.location.hash), keepScroll: true });
}

function normalizePageName(name) {
  const clean = String(name || "").replace(/^#\/?/, "");
  return PAGE_ALIASES[clean] || clean || "overview";
}

function pageFromLocation() {
  const fromHash = normalizePageName(window.location.hash);
  if (PAGE_META[fromHash]) return fromHash;
  const stored = normalizePageName(localStorage.getItem(STORAGE.activePage));
  return PAGE_META[stored] ? stored : "overview";
}

function showPage(requestedName, options = {}) {
  closeSelectPortal();
  const name = normalizePageName(requestedName);
  const target = $(`.page[data-page-panel="${name}"]`);
  const resolved = target ? name : "overview";
  const meta = PAGE_META[resolved] || PAGE_META.overview;
  state.currentPage = resolved;

  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === resolved));
  $$(".page").forEach((page) => page.classList.toggle("active", page.dataset.pagePanel === resolved));

  const activeButton = $(`.nav-item[data-page="${resolved}"]`);
  const group = activeButton?.closest(".nav-group");
  if (group) setNavGroupOpen(group, true, false);

  const title = $("#page-title");
  const section = $("#page-section");
  const breadcrumb = $("#page-breadcrumb");
  const description = $("#page-description");
  if (title) title.textContent = meta.title;
  if (section) section.textContent = meta.section;
  if (breadcrumb) breadcrumb.textContent = meta.title;
  if (description) description.textContent = meta.description;
  document.title = `${meta.title} · Conan Gray Bot Dashboard`;

  localStorage.setItem(STORAGE.activePage, resolved);
  if (!options.skipHistory) history.replaceState(null, "", `#/${resolved}`);
  if (!options.keepScroll) {
    const content = $(".content");
    requestAnimationFrame(() => content?.scrollTo({ top: 0, behavior: "auto" }));
  }
  setMobileSidebar(false);

  if (resolved === "media-library" && state.connected) {
    refreshMedia().catch((error) => toast(error.message));
  }
  if (resolved === "appearance") renderEmbedPreview();
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
  const refreshLabel = $("#refresh-btn span:last-child");
  if (refreshLabel) refreshLabel.textContent = "Refreshing...";

  try {
    const [health, configData, discordData, logsData, adminStatusData, mediaData, commandData] = await Promise.all([
      api("/api/health"),
      api(`/api/config/${state.guildId}`),
      api(`/api/discord/${state.guildId}/channels`).catch(() => ({ channels: [], categories: [], botReady: false })),
      api(`/api/logs/${state.guildId}`).catch(() => ({ logs: [] })),
      api(`/api/admin/${state.guildId}/status`).catch(() => ({ botStatus: "unknown", memory: { channels: 0, messages: 0 } })),
      api(`/api/media/${state.guildId}`).catch(() => ({ items: [], stats: {}, drive: {} })),
      api(`/api/discord/${state.guildId}/commands`).catch(() => ({ commands: [], syncStatus: "unknown", syncError: null })),
    ]);

    state.health = health;
    state.adminStatus = adminStatusData;
    state.config = configData.config;
    state.media = mediaData;
    state.commandSetup = commandData;
    normalizeConfigTheme();
    state.channels = discordData.channels || [];
    state.categories = discordData.categories || [];

    renderHealth();
    renderAdminStatus();
    renderCommandSyncNotice();
    renderChannelSelectors();
    bindConfigToInputs();
    enhanceSelects();
    renderProviders();
    renderMedia(mediaData);
    renderDriveStatus(mediaData);
    renderDriveDiagnostic();
    renderCommands();
    renderTriggers();
    renderLogs(logsData.logs || []);
    renderEmbedPreview();
    setDirty(false);
  } finally {
    state.refreshing = false;
    $("#refresh-btn").disabled = false;
    const refreshLabel = $("#refresh-btn span:last-child");
    if (refreshLabel) refreshLabel.textContent = "Refresh";
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

function renderAdminStatus() {
  const admin = state.adminStatus || {};
  const memory = admin.memory || {};
  const status = admin.botStatus || state.health?.bot?.status || "unknown";
  const roleId = admin.adminRoleId || state.config?.admin?.roleId || "1514041404836282460";
  const rolePill = $("#admin-role-pill");
  if (rolePill) rolePill.textContent = `Role ${roleId}`;
  const botStatus = $("#admin-bot-status");
  if (botStatus) botStatus.textContent = statusText(status);
  const channelCount = $("#memory-channel-count");
  if (channelCount) channelCount.textContent = `${memory.channels || 0} channel${memory.channels === 1 ? "" : "s"}`;
  const messageCount = $("#memory-message-count");
  if (messageCount) messageCount.textContent = `${memory.messages || 0} stored messages`;

  const online = status === "online" || status === "starting" || status === "connecting";
  const startButton = $("#start-bot-btn");
  const restartButton = $("#restart-bot-btn");
  const shutdownButton = $("#shutdown-bot-btn");
  if (startButton) startButton.disabled = online;
  if (restartButton) restartButton.disabled = !online;
  if (shutdownButton) shutdownButton.disabled = !online;

  const pauseButton = $("#pause-ai-btn");
  const resumeButton = $("#resume-ai-btn");
  if (pauseButton) pauseButton.disabled = admin.aiEnabled === false;
  if (resumeButton) resumeButton.disabled = admin.aiEnabled !== false;
}


function renderDriveStatus(mediaData = state.media) {
  const drive = state.health?.googleDrive || {};
  const mediaDrive = mediaData?.drive || {};
  const folderId = String(state.config?.media?.googleDriveFolderId || mediaDrive.folderId || "").trim();
  const aligned = drive.projectAligned !== false && mediaDrive.projectAligned !== false;
  const ready = Boolean(drive.configured && aligned && folderId);
  const status = $("#drive-status-pill");
  if (status) {
    status.textContent = !drive.configured
      ? aligned ? "Drive credentials missing" : "Drive project mismatch"
      : folderId ? "Drive ready to test" : "Choose a Drive folder";
    status.classList.toggle("ok", ready);
    status.classList.toggle("warn", !ready);
  }

  const authModeValue = drive.authMode || mediaDrive.authMode || "service_account";
  const identityLabel = drive.identityLabel || mediaDrive.identityLabel || (authModeValue === "oauth_user" ? "Google user OAuth" : "Service account");
  const email = drive.principalEmail || mediaDrive.principalEmail || drive.serviceAccountEmail || mediaDrive.serviceAccountEmail || "Not configured";
  const serviceAccount = $("#drive-service-account");
  if (serviceAccount) serviceAccount.textContent = email;
  const settingsEmail = $("#settings-drive-service-account");
  if (settingsEmail) settingsEmail.textContent = email;
  const credentialState = $("#settings-drive-credential-state");
  if (credentialState) credentialState.textContent = drive.configured ? `${identityLabel} loaded` : `${identityLabel} incomplete`;
  const credentialProject = $("#drive-credential-project");
  if (credentialProject) credentialProject.textContent = drive.credentialProjectId || mediaDrive.credentialProjectId || "Not configured";
  const authMode = $("#drive-auth-mode");
  if (authMode) authMode.textContent = identityLabel;
  const oauthProject = $("#drive-oauth-project");
  if (oauthProject) {
    const project = drive.oauthClientProjectId || mediaDrive.oauthClientProjectId || "Not configured";
    const active = authModeValue === "oauth_user";
    oauthProject.textContent = project === "Not configured" ? project : `${project} · ${active ? "active" : "registered"}`;
  }
  const folderSummary = $("#drive-folder-summary");
  if (folderSummary) folderSummary.textContent = folderId ? compactId(folderId) : "Not selected";
}

function renderDriveDiagnostic(detail = state.driveDiagnostic) {
  const card = $("#drive-diagnostic-card");
  if (!card) return;
  const normalized = detail && typeof detail === "object" ? detail : null;
  card.hidden = !normalized;
  if (!normalized) return;

  const success = normalized.ok === true;
  $("#drive-diagnostic-title").textContent = success ? "Google Drive connection ready" : "Google Drive needs attention";
  $("#drive-diagnostic-message").textContent = normalized.message || (success ? "The folder is accessible and ready for media." : "The connection test failed.");
  $("#drive-diagnostic-code").textContent = success ? "connected" : normalized.code || normalized.reason || "drive_error";
  $("#drive-diagnostic-project").textContent = normalized.credentialProjectId || normalized.expectedProjectId || normalized.projectId || "Not reported";
  $("#drive-diagnostic-account").textContent = normalized.principalEmail || normalized.serviceAccountEmail || state.media?.drive?.principalEmail || state.media?.drive?.serviceAccountEmail || "Not configured";
  $("#drive-diagnostic-next").textContent = success
    ? "Use /media or archive a Discord attachment"
    : normalized.code === "drive_api_disabled"
      ? "Enable Google Drive API in the active credential project, wait a few minutes, then retest"
      : normalized.code === "drive_oauth_incomplete"
        ? "Complete Google consent locally, add the generated refresh token to the private environment, then restart"
      : normalized.code === "drive_credentials_missing"
        ? "Configure a dedicated Drive credential; Firebase fallback is disabled unless explicitly enabled"
      : normalized.code === "credential_project_mismatch"
        ? "Align GOOGLE_DRIVE_EXPECTED_PROJECT_ID with the active Drive credential project"
      : normalized.code === "drive_storage_unavailable"
        ? "Use Google-user OAuth for My Drive, or upload into a Google Workspace Shared Drive"
      : normalized.code === "folder_permission_denied" || normalized.code === "folder_not_found"
        ? "Share the folder with the authenticated Drive identity and grant edit access"
        : "Check the backend logs and retest";
  const action = $("#drive-diagnostic-action");
  if (action) {
    action.hidden = !normalized.actionUrl;
    if (normalized.actionUrl) action.href = normalized.actionUrl;
  }
  card.classList.toggle("diagnostic-success", success);
  card.classList.toggle("diagnostic-error", !success);
}

function renderMedia(data = state.media) {
  state.media = data || { items: [], stats: {}, drive: {} };
  const stats = state.media.stats || {};
  const allItems = state.media.items || [];
  const query = String($("#media-search-filter")?.value || "").trim().toLowerCase();
  const items = query
    ? allItems.filter((item) => [item.name, item.originalName, item.authorName, item.channelName, item.channelId]
        .some((value) => String(value || "").toLowerCase().includes(query)))
    : allItems;
  const setText = (selector, value) => {
    const element = $(selector);
    if (element) element.textContent = value;
  };
  setText("#media-file-count", String(stats.files || 0));
  setText("#media-image-count", String(stats.images || 0));
  setText("#media-video-count", String(stats.videos || 0));
  setText("#media-total-size", formatBytes(stats.bytes || 0));

  const list = $("#media-list");
  if (!list) return;
  list.innerHTML = items.length
    ? items.map(mediaCardTemplate).join("")
    : `<div class="media-empty">${icon("media")}<strong>${query ? "No matching media" : "No archived media yet"}</strong><span>${query ? "Try another filename, user, or channel." : "Send a photo or video in the configured Discord channel after enabling the archive."}</span></div>`;

  $$("[data-delete-media]", list).forEach((button) => {
    button.onclick = () => deleteMediaRecord(button.dataset.deleteMedia).catch((error) => toast(error.message));
  });
}

function mediaCardTemplate(item) {
  const isImage = item.mediaType === "image";
  const previewUrl = isImage ? item.publicThumbnailUrl || "" : "";
  const preview = previewUrl
    ? `<img src="${escapeAttr(previewUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="media-type-icon">${icon(isImage ? "image" : "video")}</span>`;
  const driveLink = item.webViewLink
    ? `<a class="ghost compact" href="${escapeAttr(item.webViewLink)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}<span>Drive</span></a>`
    : "";
  const messageLink = item.messageUrl
    ? `<a class="ghost compact" href="${escapeAttr(item.messageUrl)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}<span>Discord</span></a>`
    : "";
  return `
    <article class="media-card">
      <div class="media-preview ${previewUrl ? "has-preview" : ""}">${preview}</div>
      <div class="media-card-body">
        <div class="media-card-title">
          <strong title="${escapeAttr(item.name || item.originalName || "Media file")}">${escapeHtml(item.name || item.originalName || "Media file")}</strong>
          <span class="media-kind">${item.mediaType === "video" ? "Video" : "Photo"}</span>
        </div>
        <dl class="media-meta">
          <div><dt>From</dt><dd>${escapeHtml(item.authorName || "Unknown user")}</dd></div>
          <div><dt>Channel</dt><dd>#${escapeHtml(item.channelName || item.channelId || "unknown")}</dd></div>
          <div><dt>Size</dt><dd>${formatBytes(item.size || 0)}</dd></div>
          <div><dt>Archived</dt><dd>${formatDate(item.createdAt)}</dd></div>
        </dl>
        <div class="media-actions">
          ${driveLink}
          ${messageLink}
          <button class="danger compact" type="button" data-delete-media="${escapeAttr(item.recordId || "")}">${icon("trash")}<span>Delete</span></button>
        </div>
      </div>
    </article>`;
}

async function refreshMedia() {
  if (!state.connected && !state.key) return;
  const type = $("#media-type-filter")?.value || "";
  const channelId = $("#media-channel-filter")?.value || "";
  const params = new URLSearchParams({ limit: "100" });
  if (type) params.set("media_type", type);
  if (channelId) params.set("channel_id", channelId);
  const data = await api(`/api/media/${state.guildId}?${params.toString()}`);
  renderMedia(data);
  renderDriveStatus(data);
}

async function testDrive() {
  if (!state.config) throw new Error("Connect the dashboard first.");
  const saved = await api(`/api/config/${state.guildId}`, {
    method: "PUT",
    body: JSON.stringify({ config: state.config }),
  });
  state.config = saved.config;
  try {
    const result = await api(`/api/media/${state.guildId}/test-drive`, { method: "POST", body: "{}" });
    const name = result.folder?.name || "Google Drive folder";
    state.driveDiagnostic = {
      ok: true,
      message: `Connected to ${name}. The bot can read and add files in this folder.`,
      serviceAccountEmail: result.serviceAccountEmail,
    };
    renderDriveDiagnostic();
    toast(`Connected to ${name}.`);
    await refreshAll();
    renderDriveDiagnostic(state.driveDiagnostic);
    return result;
  } catch (error) {
    const detail = error.detail && typeof error.detail === "object" ? error.detail : error.payload?.detail;
    state.driveDiagnostic = typeof detail === "object" ? detail : { message: error.message, code: "drive_request_failed" };
    renderDriveDiagnostic();
    throw error;
  }
}

async function deleteMediaRecord(recordId) {
  if (!recordId) return;
  const accepted = window.confirm("Delete this archive entry and its Google Drive file? This cannot be undone.");
  if (!accepted) return;
  await api(`/api/media/${state.guildId}/${encodeURIComponent(recordId)}?delete_drive_file=true`, { method: "DELETE" });
  toast("Media deleted from the archive and Google Drive.");
  await refreshMedia();
}

function formatBytes(value) {
  let bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  return `${bytes >= 10 || index === 0 ? bytes.toFixed(0) : bytes.toFixed(1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function compactId(value) {
  const text = String(value || "");
  if (text.length <= 24) return text;
  return `${text.slice(0, 10)}…${text.slice(-8)}`;
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
    ${sync.inviteUrl ? `<button class="ghost" type="button" data-open-invite>${icon("external-link")}<span>Open invite</span></button>` : ""}
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

  const memorySelect = $("#memory-channel-select");
  if (memorySelect) {
    const previous = memorySelect.value || state.config?.ai?.channelId || "";
    memorySelect.innerHTML = `<option value="">Select channel</option>${state.channels
      .map((channel) => `<option value="${escapeAttr(channel.id)}">#${escapeHtml(channel.name)}</option>`)
      .join("")}`;
    memorySelect.value = previous;
  }

  const mediaFilter = $("#media-channel-filter");
  if (mediaFilter) {
    const previous = mediaFilter.value || "";
    mediaFilter.innerHTML = `<option value="">All channels</option>${state.channels
      .map((channel) => `<option value="${escapeAttr(channel.id)}">#${escapeHtml(channel.name)}</option>`)
      .join("")}`;
    mediaFilter.value = previous;
  }
}

function setDirty(dirty = true) {
  state.dirty = Boolean(dirty);
  const indicator = $("#save-state");
  if (indicator) {
    indicator.textContent = state.dirty ? "Unsaved changes" : "All changes saved";
    indicator.classList.toggle("dirty", state.dirty);
  }
  const saveButton = $("#save-btn");
  if (saveButton) saveButton.classList.toggle("has-changes", state.dirty);
}

function valueForBoundInput(input, value) {
  if (input.type === "checkbox") {
    input.checked = Boolean(value);
  } else if (input.dataset.lines !== undefined) {
    input.value = Array.isArray(value) ? value.join("\n") : value || "";
  } else if (input.dataset.array !== undefined) {
    input.value = Array.isArray(value) ? value.join(", ") : value || "";
  } else {
    input.value = value ?? "";
  }
  updateSelectShell(input);
}

function syncBoundControls(path, value, source) {
  $$(`[data-bind="${path}"]`).forEach((input) => {
    if (input !== source) valueForBoundInput(input, value);
  });
}

function readBoundInput(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  if (input.dataset.lines !== undefined) return input.value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  if (input.dataset.array !== undefined) return input.value.split(",").map((item) => item.trim()).filter(Boolean);
  return input.value;
}

function bindConfigToInputs() {
  $$("[data-bind]").forEach((input) => {
    const path = input.dataset.bind;
    valueForBoundInput(input, getPath(state.config, path));

    input.oninput = () => {
      const nextValue = readBoundInput(input);
      setPath(state.config, path, nextValue);
      syncBoundControls(path, nextValue, input);
      if (path === "ai.replyStyle") state.config.ai.embedReplies = nextValue === "embed";
      if (path.startsWith("appearance.") || path.startsWith("presentation.")) renderEmbedPreview();
      if (path === "ai.providerOrder") renderProviders();
      setDirty(true);
    };
  });
}

let selectPortal = null;
let activeSelect = null;
let activeOptionIndex = -1;

function ensureSelectPortal() {
  if (selectPortal) return selectPortal;
  selectPortal = document.createElement("div");
  selectPortal.className = "select-portal";
  selectPortal.setAttribute("role", "listbox");
  selectPortal.hidden = true;
  document.body.appendChild(selectPortal);
  return selectPortal;
}

function updateSelectShell(select) {
  const shell = select._selectShell;
  if (!shell) return;
  const label = shell.querySelector("[data-select-label]");
  const button = shell.querySelector(".select-button");
  const selected = select.options[select.selectedIndex];
  label.textContent = selected?.textContent || "Select option";
  button.classList.toggle("placeholder", !select.value);
  button.disabled = select.disabled;
  button.setAttribute("aria-expanded", String(activeSelect === select));
}

function enhanceSelects() {
  $$("select").forEach((select, selectIndex) => {
    select.classList.add("native-select-hidden");
    let shell = select._selectShell;
    if (!shell || !shell.isConnected) {
      const legacyShell = select.nextElementSibling?.classList.contains("select-ui") ? select.nextElementSibling : null;
      if (legacyShell) legacyShell.remove();
      shell = document.createElement("div");
      shell.className = "select-ui";
      shell.innerHTML = `
        <button type="button" class="select-button" aria-haspopup="listbox" aria-expanded="false">
          <span data-select-label></span>
          ${icon("chevron-down")}
        </button>`;
      select.insertAdjacentElement("afterend", shell);
      select._selectShell = shell;
      const button = shell.querySelector(".select-button");
      button.id ||= `select-button-${selectIndex}-${Math.random().toString(36).slice(2, 7)}`;
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activeSelect === select) closeSelectPortal();
        else openSelectPortal(select);
      });
      button.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          if (activeSelect !== select) openSelectPortal(select);
          if (event.key === "ArrowDown") moveSelectOption(1);
          if (event.key === "ArrowUp") moveSelectOption(-1);
        }
        if (event.key === "Escape") closeSelectPortal(true);
      });
      select.addEventListener("input", () => updateSelectShell(select));
      select.addEventListener("change", () => updateSelectShell(select));
    }
    updateSelectShell(select);
  });
}

function openSelectPortal(select) {
  closeSelectPortal();
  const portal = ensureSelectPortal();
  activeSelect = select;
  const options = Array.from(select.options);
  activeOptionIndex = Math.max(0, select.selectedIndex);
  portal.innerHTML = options
    .map((option, index) => `
      <button
        type="button"
        class="select-option ${index === select.selectedIndex ? "active" : ""}"
        role="option"
        aria-selected="${index === select.selectedIndex}"
        data-option-index="${index}"
        ${option.disabled ? "disabled" : ""}
      >${escapeHtml(option.textContent || "")}</button>`)
    .join("");
  portal.hidden = false;
  select._selectShell.classList.add("open");
  updateSelectShell(select);
  positionSelectPortal();

  $$(".select-option", portal).forEach((button) => {
    button.addEventListener("mouseenter", () => {
      activeOptionIndex = Number(button.dataset.optionIndex);
      highlightSelectOption();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      chooseSelectOption(Number(button.dataset.optionIndex));
    });
  });
}

function positionSelectPortal() {
  if (!activeSelect || !selectPortal || selectPortal.hidden) return;
  const button = activeSelect._selectShell?.querySelector(".select-button");
  if (!button) return;
  const rect = button.getBoundingClientRect();
  const margin = 8;
  const availableBelow = window.innerHeight - rect.bottom - margin;
  const availableAbove = rect.top - margin;
  const preferredHeight = Math.min(288, Math.max(48, selectPortal.scrollHeight));
  const openAbove = availableBelow < Math.min(180, preferredHeight) && availableAbove > availableBelow;
  const maxHeight = Math.max(96, Math.min(288, openAbove ? availableAbove - margin : availableBelow - margin));

  selectPortal.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin))}px`;
  selectPortal.style.width = `${rect.width}px`;
  selectPortal.style.maxHeight = `${maxHeight}px`;
  selectPortal.style.top = openAbove ? "auto" : `${rect.bottom + margin}px`;
  selectPortal.style.bottom = openAbove ? `${window.innerHeight - rect.top + margin}px` : "auto";
}

function moveSelectOption(direction) {
  if (!activeSelect || !selectPortal) return;
  const options = Array.from(activeSelect.options);
  let next = activeOptionIndex;
  do {
    next = (next + direction + options.length) % options.length;
  } while (options[next]?.disabled && next !== activeOptionIndex);
  activeOptionIndex = next;
  highlightSelectOption();
}

function highlightSelectOption() {
  if (!selectPortal) return;
  $$(".select-option", selectPortal).forEach((button) => {
    const active = Number(button.dataset.optionIndex) === activeOptionIndex;
    button.classList.toggle("focused", active);
    if (active) button.scrollIntoView({ block: "nearest" });
  });
}

function chooseSelectOption(index) {
  if (!activeSelect) return;
  const option = activeSelect.options[index];
  if (!option || option.disabled) return;
  activeSelect.selectedIndex = index;
  activeSelect.dispatchEvent(new Event("input", { bubbles: true }));
  activeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  closeSelectPortal(true);
}

function closeSelectPortal(returnFocus = false) {
  const select = activeSelect;
  activeSelect = null;
  activeOptionIndex = -1;
  if (select?._selectShell) {
    select._selectShell.classList.remove("open");
    updateSelectShell(select);
  }
  if (selectPortal) {
    selectPortal.hidden = true;
    selectPortal.innerHTML = "";
  }
  if (returnFocus) select?._selectShell?.querySelector(".select-button")?.focus();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".select-ui") && !event.target.closest(".select-portal")) closeSelectPortal();
});

document.addEventListener("keydown", (event) => {
  if (!activeSelect) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSelectPortal(true);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelectOption(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelectOption(-1);
  } else if (event.key === "Home") {
    event.preventDefault();
    activeOptionIndex = 0;
    highlightSelectOption();
  } else if (event.key === "End") {
    event.preventDefault();
    activeOptionIndex = activeSelect.options.length - 1;
    highlightSelectOption();
  } else if (event.key === "Enter") {
    event.preventDefault();
    chooseSelectOption(activeOptionIndex);
  }
});

window.addEventListener("resize", positionSelectPortal);
document.addEventListener("scroll", positionSelectPortal, true);

function providerLabel(provider) {
  return { gemini: "Gemini", openrouter: "OpenRouter", groq: "Groq" }[provider] || provider;
}

function renderProviders() {
  const list = $("#provider-list");
  if (!list || !state.config?.ai) return;
  const providers = Array.isArray(state.config.ai.providerOrder) ? state.config.ai.providerOrder : [];
  const availability = state.health?.providers || {};
  list.innerHTML = providers.length
    ? providers.map((provider, index) => {
        const configured = Boolean(availability[provider]);
        return `<div class="provider-row">
          <span class="provider-rank">${index + 1}</span>
          <div class="provider-copy"><strong>${escapeHtml(providerLabel(provider))}</strong><small class="provider-status ${configured ? "ok" : "bad"}">${configured ? "Configured and available" : "No backend API key detected"}</small></div>
          <div class="provider-actions">
            <button class="icon-button" type="button" data-provider-up="${index}" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeAttr(providerLabel(provider))} up">${icon("arrow-up")}</button>
            <button class="icon-button" type="button" data-provider-down="${index}" ${index === providers.length - 1 ? "disabled" : ""} aria-label="Move ${escapeAttr(providerLabel(provider))} down">${icon("arrow-down")}</button>
          </div>
        </div>`;
      }).join("")
    : `<p class="muted">No providers are listed. Reset the order to restore the defaults.</p>`;

  $$('[data-provider-up]', list).forEach((button) => {
    button.onclick = () => moveProvider(Number(button.dataset.providerUp), -1);
  });
  $$('[data-provider-down]', list).forEach((button) => {
    button.onclick = () => moveProvider(Number(button.dataset.providerDown), 1);
  });
}

function moveProvider(index, direction) {
  const providers = [...(state.config?.ai?.providerOrder || [])];
  const target = index + direction;
  if (target < 0 || target >= providers.length) return;
  [providers[index], providers[target]] = [providers[target], providers[index]];
  state.config.ai.providerOrder = providers;
  syncBoundControls("ai.providerOrder", providers, null);
  renderProviders();
  setDirty(true);
}

function resetProviderOrder() {
  if (!state.config?.ai) return;
  state.config.ai.providerOrder = ["gemini", "openrouter", "groq"];
  syncBoundControls("ai.providerOrder", state.config.ai.providerOrder, null);
  renderProviders();
  setDirty(true);
}

function renderCommands() {
  const grid = $("#commands-grid");
  if (!grid || !state.config) return;
  const commands = state.config.commands || {};
  const catalog = Array.isArray(state.commandSetup?.commands) && state.commandSetup.commands.length
    ? state.commandSetup.commands
    : Object.keys(commands).map((key) => ({ key, name: key === "eightball" ? "8ball" : key, category: "Other", description: "Dashboard-managed slash command.", registered: false }));
  const query = String($("#command-search-input")?.value || "").trim().toLowerCase();
  const categoryFilter = String($("#command-category-filter")?.value || "");
  const categories = [...new Set(catalog.map((item) => item.category || "Other"))].sort();
  const categorySelect = $("#command-category-filter");
  if (categorySelect) {
    const previous = categorySelect.value;
    categorySelect.innerHTML = `<option value="">All categories</option>${categories.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}`;
    categorySelect.value = categories.includes(previous) ? previous : categoryFilter;
    updateSelectShell(categorySelect);
  }
  const activeCategory = String(categorySelect?.value || categoryFilter);
  const entries = catalog.filter((item) => {
    const haystack = `${item.name || item.key} ${item.description || ""} ${item.category || ""}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!activeCategory || item.category === activeCategory);
  });

  grid.innerHTML = entries.length
    ? entries.map((item) => {
      const key = item.key;
      const enabled = Boolean(commands[key]);
      const registered = Boolean(item.registered);
      return `
      <div class="command-toggle command-management-card ${enabled ? "enabled" : "disabled"}">
        <div class="command-card-copy">
          <div class="command-card-title"><strong>/${escapeHtml(item.name || key)}</strong><span class="command-category">${escapeHtml(item.category || "Other")}</span></div>
          <small>${escapeHtml(item.description || "Dashboard-managed slash command.")}</small>
          <div class="command-status-row">
            <span class="status-chip ${enabled ? "ok" : "off"}">${enabled ? "Enabled" : "Disabled"}</span>
            <span class="status-chip ${registered ? "ok" : "pending"}">${registered ? "Published in Discord" : enabled ? "Publish required" : "Not registered"}</span>
          </div>
        </div>
        <label class="switch" title="${enabled ? "Disable" : "Enable"} /${escapeAttr(item.name || key)}">
          <input type="checkbox" data-command="${escapeAttr(key)}" ${enabled ? "checked" : ""}>
          <span></span>
        </label>
      </div>`;
    }).join("")
    : `<div class="media-empty">${icon("search")}<strong>No matching commands</strong><span>Try another name, description, or category.</span></div>`;

  $$("[data-command]", grid).forEach((input) => {
    input.onchange = () => {
      state.config.commands[input.dataset.command] = input.checked;
      setDirty(true);
      renderCommands();
    };
  });

  const enabledCount = catalog.filter((item) => Boolean(commands[item.key])).length;
  const registeredCount = catalog.filter((item) => Boolean(item.registered)).length;
  if ($("#command-enabled-count")) $("#command-enabled-count").textContent = String(enabledCount);
  if ($("#command-registered-count")) $("#command-registered-count").textContent = String(registeredCount);
  if ($("#command-total-count")) $("#command-total-count").textContent = String(catalog.length);
  const pill = $("#command-publish-pill");
  if (pill) {
    const pending = catalog.some((item) => Boolean(commands[item.key]) !== Boolean(item.registered));
    pill.textContent = pending ? "Changes need publishing" : state.commandSetup?.syncStatus === "ok" ? "Discord tree is current" : "Command sync needs attention";
    pill.classList.toggle("warn", pending);
    pill.classList.toggle("ok", !pending && state.commandSetup?.syncStatus === "ok");
  }
}

function setAllCommands(enabled) {
  if (!state.config?.commands) return;
  Object.keys(state.config.commands).forEach((name) => {
    state.config.commands[name] = Boolean(enabled);
  });
  renderCommands();
  setDirty(true);
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
      setDirty(true);
    };
  });

  $$("[data-remove-trigger]").forEach((button) => {
    button.onclick = () => {
      state.config.triggers = state.config.triggers.filter((item) => item.id !== button.dataset.removeTrigger);
      renderTriggers();
      setDirty(true);
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
        <button class="ghost danger" data-remove-trigger="${trigger.id}">${icon("trash")}<span>Remove</span></button>
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
  setDirty(false);
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
  setDirty(true);
}

async function syncCommands() {
  try {
    if (!state.config) throw new Error("Connect the dashboard first.");
    const saved = await api(`/api/config/${state.guildId}`, {
      method: "PUT",
      body: JSON.stringify({ config: state.config }),
    });
    state.config = saved.config;
    const result = await api(`/api/discord/${state.guildId}/sync-commands`, { method: "POST", body: "{}" });
    setDirty(false);
    toast(`${result.count ?? result.registered?.length ?? 0} slash commands published to Discord.`);
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

async function runBotAction(action) {
  const labels = { start: "start", restart: "restart", shutdown: "shut down" };
  if (["restart", "shutdown"].includes(action)) {
    const accepted = window.confirm(`Are you sure you want to ${labels[action]} the Discord bot connection?`);
    if (!accepted) return;
  }
  await api(`/api/admin/${state.guildId}/bot/${action}`, { method: "POST", body: "{}" });
  toast(action === "shutdown" ? "Discord bot stopped. The dashboard is still online." : `Bot ${labels[action]} requested.`);
  await refreshAll();
}

async function clearMemory(allChannels) {
  const select = $("#memory-channel-select");
  const channelId = select?.value || state.config?.ai?.channelId || "";
  if (allChannels) {
    const accepted = window.confirm("Clear all AI memory branches for every channel in this server? This cannot be undone.");
    if (!accepted) return;
  } else if (!channelId) {
    toast("Select a channel first.");
    return;
  } else {
    const accepted = window.confirm("Clear every AI memory branch in the selected channel?");
    if (!accepted) return;
  }
  const result = await api(`/api/admin/${state.guildId}/memory/clear`, {
    method: "POST",
    body: JSON.stringify({ allChannels, channelId }),
  });
  toast(allChannels ? `Cleared memory for ${result.clearedChannels || 0} channel(s).` : "Selected channel memory cleared.");
  await refreshAll();
}

async function runAiAction(action) {
  await api(`/api/admin/${state.guildId}/ai/${action}`, { method: "POST", body: "{}" });
  toast(action === "pause" ? "AI replies paused." : "AI replies resumed.");
  await refreshAll();
}

async function saveAndApplyPresence() {
  await saveConfig();
  toast("Presence settings saved and applied.");
}


function renderEmbedPreview() {
  const appearance = state.config?.appearance || {};
  const accent = String(appearance.accentColor || "#67e8f9").trim();
  const safeAccent = /^#[0-9a-f]{6}$/i.test(accent) || /^#[0-9a-f]{3}$/i.test(accent) ? accent : "#67e8f9";
  document.documentElement.style.setProperty("--accent", safeAccent);
  const preview = $("#embed-preview");
  const title = $("#embed-preview-title");
  const footer = $("#embed-preview-footer");
  if (preview) preview.style.borderLeftColor = safeAccent;
  if (title) title.textContent = appearance.embedTitle || "A natural reply";
  if (footer) footer.textContent = appearance.embedFooter || "Conan Gray Bot";
}

function applyAccentPreset(value) {
  if (!state.config) return;
  state.config.appearance ??= {};
  state.config.appearance.accentColor = value;
  syncBoundControls("appearance.accentColor", value, null);
  renderEmbedPreview();
  setDirty(true);
}

function bindUiPreferenceControls() {
  applyUiPreferences();
  const density = $("#dashboard-density-select");
  const sidebarMode = $("#dashboard-sidebar-mode-select");
  const reduceMotion = $("#dashboard-reduce-motion");

  if (density) {
    density.onchange = () => {
      document.body.dataset.density = density.value || "comfortable";
      localStorage.setItem(STORAGE.density, document.body.dataset.density);
      updateSelectShell(density);
    };
  }
  if (sidebarMode) {
    sidebarMode.onchange = () => {
      setSidebarCollapsed(sidebarMode.value === "compact");
      updateSelectShell(sidebarMode);
    };
  }
  if (reduceMotion) {
    reduceMotion.onchange = () => {
      document.body.classList.toggle("reduce-motion", reduceMotion.checked);
      localStorage.setItem(STORAGE.reduceMotion, reduceMotion.checked ? "1" : "0");
    };
  }

  $$('[data-accent-preset]').forEach((button) => {
    button.onclick = () => applyAccentPreset(button.dataset.accentPreset);
  });
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

  const apiInput = $("#api-base-input");
  const keyInput = $("#dashboard-key-input");
  const guildInput = $("#guild-id-input");
  if (apiInput) apiInput.value = state.apiBase;
  if (keyInput) keyInput.value = state.key;
  if (guildInput) guildInput.value = state.guildId;

  bindUiPreferenceControls();
  initNavigation();
  setDirty(false);

  const click = (selector, handler) => {
    const element = $(selector);
    if (element) element.onclick = handler;
  };

  click("#connect-btn", () => connect().catch((error) => toast(error.message)));
  click("#refresh-btn", () => refreshAll().then(() => toast("Refreshed.")).catch((error) => toast(error.message)));
  click("#save-btn", () => saveConfig().catch((error) => toast(error.message)));
  click("#add-trigger-btn", addTrigger);
  click("#sync-commands-btn", () => syncCommands().catch((error) => toast(error.message)));
  click("#enable-all-commands-btn", () => setAllCommands(true));
  click("#disable-all-commands-btn", () => setAllCommands(false));
  click("#reset-provider-order-btn", resetProviderOrder);
  click("#start-bot-btn", () => runBotAction("start").catch((error) => toast(error.message)));
  click("#restart-bot-btn", () => runBotAction("restart").catch((error) => toast(error.message)));
  click("#shutdown-bot-btn", () => runBotAction("shutdown").catch((error) => toast(error.message)));
  click("#clear-channel-memory-btn", () => clearMemory(false).catch((error) => toast(error.message)));
  click("#clear-all-memory-btn", () => clearMemory(true).catch((error) => toast(error.message)));
  click("#pause-ai-btn", () => runAiAction("pause").catch((error) => toast(error.message)));
  click("#resume-ai-btn", () => runAiAction("resume").catch((error) => toast(error.message)));
  click("#apply-presence-btn", () => saveAndApplyPresence().catch((error) => toast(error.message)));
  click("#refresh-media-btn", () => refreshMedia().then(() => toast("Media library refreshed.")).catch((error) => toast(error.message)));

  const mediaType = $("#media-type-filter");
  const mediaChannel = $("#media-channel-filter");
  const mediaSearch = $("#media-search-filter");
  const commandSearch = $("#command-search-input");
  const commandCategory = $("#command-category-filter");
  if (mediaType) mediaType.onchange = () => refreshMedia().catch((error) => toast(error.message));
  if (mediaChannel) mediaChannel.onchange = () => refreshMedia().catch((error) => toast(error.message));
  if (mediaSearch) mediaSearch.oninput = () => renderMedia(state.media);
  if (commandSearch) commandSearch.oninput = renderCommands;
  if (commandCategory) commandCategory.onchange = renderCommands;

  $$('[data-test-drive]').forEach((button) => {
    button.onclick = () => testDrive().catch((error) => toast(error.message));
  });

  click("#invite-bot-btn", () => {
    const inviteUrl = state.health?.bot?.commandSync?.inviteUrl;
    if (inviteUrl) window.open(inviteUrl, "_blank", "noopener,noreferrer");
    else toast("Connect the dashboard first.");
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (state.connected) saveConfig().catch((error) => toast(error.message));
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

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
