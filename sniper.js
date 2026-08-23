import { CLAIM_PLATFORMS } from "./claim-platforms.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const config = window.WEBSCRAPER_CONFIG || {};
const ACTIVE_KEY = "marfeyx-active-claim-v1";
const CLAIMED_KEY = "marfeyx-claimed-usernames-v1";
const demoMode = new URLSearchParams(location.search).get("demo") === "1";

const state = {
  username: "",
  selectedCategories: new Set(CLAIM_PLATFORMS.map(platform => platform.category)),
  requestedIds: [],
  results: new Map(),
  scanId: null,
  scanToken: null,
  lastResultId: 0,
  platformTotal: 0,
  checkedTotal: 0,
  startedAt: null,
  timer: null,
  controller: null,
  scanning: false,
  stopped: false,
  filter: "all",
  claimed: loadClaimed()
};

const platformMap = new Map(CLAIM_PLATFORMS.map(platform => [platform.id, platform]));
const form = $("#claim-form");
const input = $("#claim-username");
const errorBox = $("#claim-error");
const progressSection = $("#claim-progress");
const resultsSection = $("#claim-results");

function configured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") &&
    typeof config.supabasePublishableKey === "string" && config.supabasePublishableKey.length > 20;
}

function normalizeUsername(value) {
  return value.trim().replace(/^@+/, "");
}

function validUsername(value) {
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,31}$/u.test(value);
}

function getClientId() {
  const key = "marfeyx-webscraper-client-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

async function api(body, signal) {
  if (!configured()) throw new Error("The scan service is not configured yet.");
  const endpoint = `${config.supabaseUrl}/functions/v1/${config.functionName || "alias-scan"}`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "apikey": config.supabasePublishableKey,
      "x-client-id": getClientId()
    },
    body: JSON.stringify(body)
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || `Scan service returned ${response.status}.`);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  return data;
}

function selectedPlatforms() {
  return CLAIM_PLATFORMS.filter(platform => state.selectedCategories.has(platform.category));
}

function renderCategories() {
  const categories = [...new Set(CLAIM_PLATFORMS.map(platform => platform.category))];
  const container = $("#claim-categories");
  const all = document.createElement("button");
  all.type = "button";
  all.className = state.selectedCategories.size === categories.length ? "active" : "";
  all.textContent = "All";
  all.addEventListener("click", () => {
    const selectAll = state.selectedCategories.size !== categories.length;
    state.selectedCategories = new Set(selectAll ? categories : [categories[0]]);
    renderCategories();
  });
  const buttons = categories.map(category => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = state.selectedCategories.has(category) ? "active" : "";
    button.textContent = category;
    button.addEventListener("click", () => {
      if (state.selectedCategories.has(category) && state.selectedCategories.size > 1) state.selectedCategories.delete(category);
      else state.selectedCategories.add(category);
      renderCategories();
    });
    return button;
  });
  container.replaceChildren(all, ...buttons);
  const count = selectedPlatforms().length;
  $("#selected-platform-count").textContent = `${count} platform${count === 1 ? "" : "s"} selected`;
}

function resetCheck() {
  state.results.clear();
  state.scanId = null;
  state.scanToken = null;
  state.lastResultId = 0;
  state.platformTotal = 0;
  state.checkedTotal = 0;
  state.stopped = false;
  state.filter = "all";
  errorBox.textContent = "";
  progressSection.hidden = true;
  resultsSection.hidden = true;
  $("#claim-results-grid").replaceChildren();
  updateProgress(0, 0);
}

async function startCheck(event) {
  event.preventDefault();
  const username = normalizeUsername(input.value);
  errorBox.textContent = "";
  if (!validUsername(username)) {
    errorBox.textContent = "Use 1–32 letters, numbers, dots, underscores or hyphens; start with a letter or number.";
    input.focus();
    return;
  }
  const platforms = selectedPlatforms();
  if (!platforms.length) {
    errorBox.textContent = "Choose at least one platform group.";
    return;
  }
  if (!configured() && !demoMode) {
    errorBox.textContent = "The availability service is not configured yet.";
    return;
  }

  resetCheck();
  state.username = username;
  state.requestedIds = platforms.map(platform => platform.id);
  state.platformTotal = state.requestedIds.length;
  state.startedAt = Date.now();
  state.scanning = true;
  state.controller = new AbortController();
  input.disabled = true;
  $("#claim-submit").disabled = true;
  progressSection.hidden = false;
  $("#claim-progress-title").textContent = `Checking @${username}`;
  progressSection.scrollIntoView({ behavior: "smooth", block: "start" });
  startTimer();

  try {
    if (demoMode) {
      await runDemo();
      finishCheck();
      return;
    }
    const started = await api({ action: "start-claim", aliases: [username], platformIds: state.requestedIds }, state.controller.signal);
    state.scanId = started.scanId;
    state.scanToken = started.scanToken;
    state.platformTotal = started.platformCount;
    saveActiveCheck();
    await pollCheck();
  } catch (error) {
    handleCheckError(error);
  } finally {
    state.scanning = false;
    clearInterval(state.timer);
    input.disabled = false;
    $("#claim-submit").disabled = false;
  }
}

function mergeResults(incoming) {
  for (const result of incoming) {
    if (platformMap.has(result.platformId)) state.results.set(result.platformId, result);
  }
}

async function pollCheck() {
  while (!state.stopped) {
    const payload = await api({
      action: "status",
      scanId: state.scanId,
      scanToken: state.scanToken,
      afterId: state.lastResultId
    }, state.controller.signal);
    state.platformTotal = payload.platformCount || state.platformTotal;
    state.checkedTotal = payload.checkedCount || 0;
    state.lastResultId = payload.lastResultId || state.lastResultId;
    mergeResults(Array.isArray(payload.results) ? payload.results : []);
    updateProgress(state.checkedTotal, state.platformTotal);
    $("#claim-progress-label").textContent = payload.lastPlatform ? `Checking ${payload.lastPlatform}` : "Starting secure background workers…";
    saveActiveCheck();

    if (payload.hasMore) continue;
    if (payload.status === "complete") {
      clearActiveCheck();
      finishCheck();
      return;
    }
    if (payload.status === "stopped") {
      clearActiveCheck();
      finishCheck(true);
      return;
    }
    if (payload.status === "failed") {
      clearActiveCheck();
      throw new Error(payload.error || "The background check could not be completed.");
    }
    await wait(document.hidden ? 4000 : 1200, state.controller.signal);
  }
}

function updateProgress(checked, total) {
  const percent = total ? Math.min(100, Math.round((checked / total) * 100)) : 0;
  $("#claim-progress-percent").textContent = `${percent}%`;
  $("#claim-progress-bar").style.width = `${percent}%`;
  $("#claim-checked").textContent = checked;
  $("#claim-available-live").textContent = [...state.results.values()].filter(result => classify(result) === "available").length;
}

function finishCheck(partial = false) {
  clearInterval(state.timer);
  state.scanning = false;
  for (const id of state.requestedIds) {
    if (!state.results.has(id)) {
      const platform = platformMap.get(id);
      state.results.set(id, { platformId: id, platform: platform?.name || id, status: "error", message: partial ? "Check stopped before this platform" : "No conclusive response returned", profileUrl: "" });
    }
  }
  progressSection.hidden = true;
  resultsSection.hidden = false;
  $("#claim-results-title").textContent = `@${state.username} across ${state.requestedIds.length} platforms`;
  $("#claim-results-summary").textContent = partial ? "Partial results are shown. Unchecked platforms need a manual check." : "Likely available names are ready to claim on the official platform.";
  renderResults();
  setTimeout(() => resultsSection.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
}

function classify(result) {
  if (result.status === "found") return "taken";
  if (result.status === "not_found" && !/invalid|unsupported/i.test(result.message || "")) return "available";
  return "manual";
}

function isClaimed(platformId) {
  return Boolean(state.claimed[state.username.toLowerCase()]?.includes(platformId));
}

function toggleClaimed(platformId) {
  const key = state.username.toLowerCase();
  const current = new Set(state.claimed[key] || []);
  if (current.has(platformId)) current.delete(platformId);
  else current.add(platformId);
  state.claimed[key] = [...current];
  localStorage.setItem(CLAIMED_KEY, JSON.stringify(state.claimed));
  renderResults();
}

function resultCounts() {
  const results = [...state.results.values()];
  return {
    available: results.filter(result => classify(result) === "available").length,
    taken: results.filter(result => classify(result) === "taken").length,
    manual: results.filter(result => classify(result) === "manual").length,
    claimed: results.filter(result => isClaimed(result.platformId)).length
  };
}

function renderResults() {
  const counts = resultCounts();
  for (const [key, value] of Object.entries(counts)) $(`#claim-stat-${key}`).textContent = value;
  const query = $("#claim-result-search").value.trim().toLowerCase();
  const rank = { available: 0, manual: 1, taken: 2 };
  const results = [...state.results.values()]
    .filter(result => {
      const platform = platformMap.get(result.platformId);
      const claimed = isClaimed(result.platformId);
      const matchesFilter = state.filter === "all" || (state.filter === "claimed" ? claimed : classify(result) === state.filter);
      return matchesFilter && (!query || platform?.name.toLowerCase().includes(query) || platform?.category.toLowerCase().includes(query));
    })
    .sort((a, b) => rank[classify(a)] - rank[classify(b)] || (platformMap.get(a.platformId)?.importance || 9) - (platformMap.get(b.platformId)?.importance || 9) || a.platform.localeCompare(b.platform));
  const grid = $("#claim-results-grid");
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = "No platforms match this filter.";
    grid.replaceChildren(empty);
    return;
  }
  grid.replaceChildren(...results.map(createResultCard));
}

function createResultCard(result) {
  const platform = platformMap.get(result.platformId);
  const status = classify(result);
  const claimed = isClaimed(result.platformId);
  const card = document.createElement("article");
  card.className = `claim-card ${status}${claimed ? " is-claimed" : ""}`;

  const icon = document.createElement("div");
  icon.className = "claim-platform-icon";
  icon.textContent = (platform?.name || result.platform || "?").slice(0, 1).toUpperCase();
  const identity = document.createElement("div");
  identity.className = "claim-card-identity";
  const title = document.createElement("h3");
  title.textContent = platform?.name || result.platform;
  const meta = document.createElement("p");
  meta.textContent = `${platform?.category || "Platform"} · @${state.username}`;
  identity.append(title, meta);
  const badge = document.createElement("span");
  badge.className = `claim-status ${status}`;
  badge.textContent = claimed ? "Claimed" : ({ available: "Likely available", taken: "Taken", manual: "Manual check" })[status];

  const message = document.createElement("p");
  message.className = "claim-card-message";
  message.textContent = status === "available" ? "No public profile was detected. Confirm it during signup before celebrating." : status === "taken" ? "A public profile currently uses this name." : (result.message || "The platform blocked an automated availability check.");

  const actions = document.createElement("div");
  actions.className = "claim-card-actions";
  const link = document.createElement("a");
  link.href = status === "taken" && safeUrl(result.profileUrl) ? safeUrl(result.profileUrl) : platform.claimUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = status === "available" ? "primary-button small" : "secondary-button";
  link.textContent = status === "available" ? `${platform.claimLabel || "Claim username"} ↗` : status === "taken" ? "View profile ↗" : `${platform.claimLabel || "Check manually"} ↗`;
  actions.append(link);
  if (status !== "taken") {
    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = "claim-mark";
    mark.textContent = claimed ? "✓ Marked claimed" : "Mark as claimed";
    mark.addEventListener("click", () => toggleClaimed(result.platformId));
    actions.append(mark);
  }
  card.append(icon, identity, badge, message, actions);
  return card;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

function saveActiveCheck() {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify({
    scanId: state.scanId,
    scanToken: state.scanToken,
    username: state.username,
    requestedIds: state.requestedIds,
    startedAt: state.startedAt,
    platformTotal: state.platformTotal
  }));
}

function clearActiveCheck() {
  localStorage.removeItem(ACTIVE_KEY);
}

async function resumeActiveCheck() {
  if (demoMode || state.scanning) return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null"); }
  catch { clearActiveCheck(); return; }
  if (!saved?.scanId || !saved?.scanToken || !validUsername(saved.username || "") || !Array.isArray(saved.requestedIds)) return;
  resetCheck();
  state.scanId = saved.scanId;
  state.scanToken = saved.scanToken;
  state.username = saved.username;
  state.requestedIds = saved.requestedIds.filter(id => platformMap.has(id)).slice(0, 100);
  state.platformTotal = Number(saved.platformTotal) || state.requestedIds.length;
  state.startedAt = Number(saved.startedAt) || Date.now();
  state.scanning = true;
  state.controller = new AbortController();
  input.value = state.username;
  input.disabled = true;
  $("#claim-submit").disabled = true;
  progressSection.hidden = false;
  $("#claim-progress-title").textContent = `Reconnecting to @${state.username}`;
  startTimer();
  try { await pollCheck(); }
  catch (error) {
    if (error.status === 404 || error.status === 403) clearActiveCheck();
    handleCheckError(error);
  } finally {
    state.scanning = false;
    clearInterval(state.timer);
    input.disabled = false;
    $("#claim-submit").disabled = false;
  }
}

function handleCheckError(error) {
  if (error.name === "AbortError") return;
  const retry = error.status === 429 && error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : "";
  errorBox.textContent = `${error.message}${retry}`;
  if (!state.results.size) progressSection.hidden = true;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startTimer() {
  clearInterval(state.timer);
  const tick = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    $("#claim-elapsed").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); }, { once: true });
  });
}

async function runDemo() {
  const statuses = ["not_found", "not_found", "found", "uncertain", "not_found"];
  for (let index = 0; index < state.requestedIds.length; index += 4) {
    await wait(160, state.controller.signal);
    for (const id of state.requestedIds.slice(index, index + 4)) {
      const status = statuses[(index + state.requestedIds.indexOf(id)) % statuses.length];
      state.results.set(id, { platformId: id, platform: platformMap.get(id).name, status, message: status === "found" ? "Public profile endpoint exists" : status === "not_found" ? "Profile not found" : "Platform blocked verification", profileUrl: "https://example.com/" });
    }
    updateProgress(Math.min(index + 4, state.platformTotal), state.platformTotal);
  }
}

function loadClaimed() {
  try {
    const value = JSON.parse(localStorage.getItem(CLAIMED_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

form.addEventListener("submit", startCheck);
$("#claim-stop").addEventListener("click", async () => {
  state.stopped = true;
  if (state.scanId && state.scanToken && !demoMode) await api({ action: "stop", scanId: state.scanId, scanToken: state.scanToken }).catch(() => null);
  clearActiveCheck();
  state.controller?.abort();
  finishCheck(true);
});
$("#claim-new-check").addEventListener("click", () => {
  resetCheck();
  input.value = "";
  input.focus();
  form.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#claim-result-search").addEventListener("input", renderResults);
$("#claim-result-filters").addEventListener("click", event => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  $$("#claim-result-filters button").forEach(item => item.classList.toggle("active", item === button));
  renderResults();
});
$("#year").textContent = new Date().getFullYear();

renderCategories();
resumeActiveCheck();
