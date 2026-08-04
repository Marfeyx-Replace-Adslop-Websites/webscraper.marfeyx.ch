const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const config = window.WEBSCRAPER_CONFIG || {};
const state = {
  aliases: [],
  catalogue: [],
  results: [],
  scanId: null,
  scanToken: null,
  scanning: false,
  stopped: false,
  controller: null,
  startedAt: null,
  timer: null,
  activeAlias: "all",
  visibleLimit: 24
};

const form = $("#scan-form");
const aliasInput = $("#alias-input");
const chips = $("#alias-chips");
const formError = $("#form-error");
const progressSection = $("#progress-section");
const resultsSection = $("#results-section");
const demoMode = new URLSearchParams(location.search).get("demo") === "1";

function configured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") &&
    typeof config.supabasePublishableKey === "string" && config.supabasePublishableKey.length > 20;
}

function normalizeAlias(value) {
  return value.trim().replace(/^@+/, "");
}

function validAlias(value) {
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,31}$/u.test(value);
}

function addAlias(raw = aliasInput.value) {
  const alias = normalizeAlias(raw);
  formError.textContent = "";
  if (!alias) return false;
  if (!validAlias(alias)) {
    formError.textContent = "Use 1–32 letters, numbers, dots, underscores or hyphens; the first character must be alphanumeric.";
    return false;
  }
  if (state.aliases.some(item => item.toLowerCase() === alias.toLowerCase())) {
    formError.textContent = "That alias is already in the scan.";
    return false;
  }
  if (state.aliases.length >= 3) {
    formError.textContent = "Three aliases is the hard limit. Rate limits are fragile little creatures.";
    return false;
  }
  state.aliases.push(alias);
  aliasInput.value = "";
  renderAliases();
  return true;
}

function renderAliases() {
  chips.replaceChildren(...state.aliases.map(alias => {
    const chip = document.createElement("span");
    chip.className = "alias-chip";
    chip.append(document.createTextNode(`@${alias}`));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${alias}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.aliases = state.aliases.filter(item => item !== alias);
      renderAliases();
    });
    chip.append(remove);
    return chip;
  }));
  $("#alias-counter").textContent = `${state.aliases.length} / 3 aliases`;
  aliasInput.disabled = state.aliases.length >= 3 || state.scanning;
  $("#add-alias").disabled = state.aliases.length >= 3 || state.scanning;
}

async function loadCatalogue() {
  const response = await fetch("data/platforms.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Platform catalogue could not be loaded.");
  const data = await response.json();
  state.catalogue = data.sites || [];
  const count = state.catalogue.length;
  $("#hero-platform-count").textContent = `${count}`;
  $("#coverage-count").textContent = count;
  const grouped = Object.groupBy ? Object.groupBy(state.catalogue, site => site.category) : state.catalogue.reduce((acc, site) => {
    (acc[site.category] ||= []).push(site);
    return acc;
  }, {});
  $$("#coverage-grid article").forEach(card => {
    $("strong", card).textContent = grouped[card.dataset.category]?.length || 0;
  });
}

function getClientId() {
  const key = "aliastrace-client-id";
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

function eligibleSites() {
  return state.catalogue.filter(site => state.aliases.some(alias => {
    if (!site.regex) return true;
    try { return new RegExp(site.regex).test(alias); } catch { return true; }
  }));
}

function resetScan() {
  state.results = [];
  state.scanId = null;
  state.scanToken = null;
  state.stopped = false;
  state.visibleLimit = 24;
  $("#live-platforms").replaceChildren();
  updateProgress(0, 0);
  resultsSection.hidden = true;
}

async function startScan(event) {
  event.preventDefault();
  if (aliasInput.value.trim()) addAlias();
  if (!state.aliases.length) {
    formError.textContent = "Add at least one alias to scan.";
    aliasInput.focus();
    return;
  }
  if (!configured() && !demoMode) {
    formError.textContent = "The Supabase scan service has not been connected yet.";
    return;
  }
  resetScan();
  state.scanning = true;
  state.controller = new AbortController();
  state.startedAt = Date.now();
  formError.textContent = "";
  renderAliases();
  $("#scan-button").disabled = true;
  progressSection.hidden = false;
  progressSection.scrollIntoView({ behavior: "smooth", block: "start" });
  startTimer();

  try {
    if (demoMode) {
      await runDemo();
    } else {
      const sites = eligibleSites();
      const started = await api({ action: "start", aliases: state.aliases, platformCount: sites.length }, state.controller.signal);
      state.scanId = started.scanId;
      state.scanToken = started.scanToken;
      const batchSize = Math.min(Number(config.batchSize) || 8, 10);
      let checked = 0;
      for (let index = 0; index < sites.length && !state.stopped; index += batchSize) {
        const batch = sites.slice(index, index + batchSize);
        $("#progress-label").textContent = `Checking ${batch[0].name} → ${batch.at(-1).name}`;
        const payload = await api({
          action: "scan-batch",
          scanId: state.scanId,
          scanToken: state.scanToken,
          aliases: state.aliases,
          platformIds: batch.map(site => site.id)
        }, state.controller.signal);
        const incoming = Array.isArray(payload.results) ? payload.results : [];
        state.results.push(...incoming);
        checked += batch.length;
        updateProgress(checked, sites.length);
        renderLive(incoming);
        if (payload.retryAfterMs) await wait(Math.min(payload.retryAfterMs, 5000), state.controller.signal);
        else await wait(450, state.controller.signal);
      }
      if (state.stopped) throw new DOMException("Stopped", "AbortError");
      await api({ action: "finish", scanId: state.scanId, scanToken: state.scanToken }, state.controller.signal).catch(() => null);
    }
    finishScan();
  } catch (error) {
    if (error.name === "AbortError") {
      $("#progress-label").textContent = "Scan stopped. Partial results are available.";
      if (state.results.length) finishScan(true);
    } else {
      const retry = error.status === 429 && error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : "";
      formError.textContent = `${error.message}${retry}`;
      progressSection.hidden = true;
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } finally {
    state.scanning = false;
    clearInterval(state.timer);
    $("#scan-button").disabled = false;
    renderAliases();
  }
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); }, { once: true });
  });
}

function startTimer() {
  clearInterval(state.timer);
  const tick = () => {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    $("#elapsed-time").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

function updateProgress(checked, total) {
  const percent = total ? Math.round((checked / total) * 100) : 0;
  $("#progress-percent").textContent = `${percent}%`;
  $("#progress-bar").style.width = `${percent}%`;
  $("#checked-count").textContent = checked;
  $("#live-found-count").textContent = state.results.filter(result => result.status === "found").length;
}

function renderLive(incoming) {
  const container = $("#live-platforms");
  incoming.slice(-8).forEach(result => {
    const item = document.createElement("div");
    item.className = `live-platform ${result.status === "found" ? "found" : ""}`;
    const name = document.createElement("span");
    name.textContent = `${result.platform} · @${result.alias}`;
    const dot = document.createElement("b");
    item.append(name, dot);
    container.prepend(item);
  });
  while (container.children.length > 8) container.lastElementChild.remove();
}

function finishScan(partial = false) {
  clearInterval(state.timer);
  $("#progress-title").textContent = partial ? "Partial scan saved" : "Public footprint mapped";
  $("#progress-label").textContent = partial ? "Stopped before every platform was checked." : "All eligible platform checks completed.";
  renderResults();
  resultsSection.hidden = false;
  celebrate();
  setTimeout(() => resultsSection.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
}

function resultContentCount(result) {
  if (Number.isFinite(result.contentCount)) return result.contentCount;
  return Array.isArray(result.recentItems) ? result.recentItems.length : 0;
}

function renderResults() {
  const found = state.results.filter(item => item.status === "found");
  const uncertain = state.results.filter(item => item.status === "uncertain");
  const content = found.reduce((sum, item) => sum + resultContentCount(item), 0);
  const uniquePlatforms = new Set(state.results.map(item => item.platformId)).size;
  const possible = found.length + uncertain.length;
  $("#stat-found").textContent = found.length;
  $("#stat-content").textContent = compactNumber(content);
  $("#stat-checked").textContent = uniquePlatforms;
  $("#stat-coverage").textContent = `${Math.round(uniquePlatforms / Math.max(state.catalogue.length, 1) * 100)}% catalogue coverage`;
  $("#stat-confidence").textContent = possible ? `${Math.round(found.length / possible * 100)}%` : "—";
  $("#results-summary").textContent = `${state.aliases.map(alias => `@${alias}`).join(", ")} produced ${found.length} confirmed profile${found.length === 1 ? "" : "s"} and ${uncertain.length} uncertain check${uncertain.length === 1 ? "" : "s"}.`;
  renderAliasTabs();
  renderResultCards();
}

function renderAliasTabs() {
  const tabs = $("#alias-tabs");
  const values = ["all", ...state.aliases];
  tabs.replaceChildren(...values.map(value => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.className = state.activeAlias === value ? "active" : "";
    button.setAttribute("aria-selected", String(state.activeAlias === value));
    button.textContent = value === "all" ? "All aliases" : `@${value}`;
    button.addEventListener("click", () => {
      state.activeAlias = value;
      state.visibleLimit = 24;
      renderAliasTabs();
      renderResultCards();
    });
    return button;
  }));
}

function renderResultCards() {
  const query = $("#result-filter").value.trim().toLowerCase();
  const status = $("#status-filter").value;
  const order = { found: 0, uncertain: 1, error: 2, not_found: 3 };
  const filtered = state.results
    .filter(item => state.activeAlias === "all" || item.alias === state.activeAlias)
    .filter(item => status === "all" || item.status === status)
    .filter(item => !query || `${item.platform} ${item.alias}`.toLowerCase().includes(query))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.platform.localeCompare(b.platform));
  const grid = $("#results-grid");
  const page = filtered.slice(0, state.visibleLimit);
  if (!page.length) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = status === "found" ? "No confirmed profiles match this filter." : "No results match this filter.";
    grid.replaceChildren(empty);
  } else {
    grid.replaceChildren(...page.map(createResultCard));
  }
  $("#load-more").hidden = filtered.length <= state.visibleLimit;
}

function createResultCard(result) {
  const card = document.createElement("article");
  card.className = "result-card";
  const main = document.createElement("div");
  main.className = "result-card-main";
  const avatar = document.createElement("div");
  avatar.className = "platform-avatar";
  if (result.avatarUrl && /^https:\/\//.test(result.avatarUrl)) {
    const image = document.createElement("img");
    image.src = result.avatarUrl;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.replaceWith(document.createTextNode(result.platform.slice(0, 1).toUpperCase())));
    avatar.append(image);
  } else avatar.textContent = result.platform.slice(0, 1).toUpperCase();
  const identity = document.createElement("div");
  identity.className = "identity";
  const title = document.createElement("h3");
  title.textContent = result.platform;
  const subtitle = document.createElement("p");
  subtitle.textContent = result.displayName ? `${result.displayName} · @${result.alias}` : `@${result.alias} · ${result.message || labelForStatus(result.status)}`;
  identity.append(title, subtitle);
  const badge = document.createElement("span");
  badge.className = `status-badge ${result.status}`;
  badge.textContent = labelForStatus(result.status);
  main.append(avatar, identity, badge);
  card.append(main);

  if (result.status === "found" || result.status === "uncertain") {
    const evidence = document.createElement("div");
    evidence.className = "result-evidence";
    const metrics = document.createElement("div");
    metrics.className = "metrics";
    Object.entries(result.metrics || {}).slice(0, 5).forEach(([label, value]) => {
      const metric = document.createElement("span");
      metric.className = "metric";
      const strong = document.createElement("strong");
      strong.textContent = typeof value === "number" ? compactNumber(value) : String(value);
      metric.append(strong, document.createTextNode(humanize(label)));
      metrics.append(metric);
    });
    if (metrics.children.length) evidence.append(metrics);
    if (Array.isArray(result.recentItems) && result.recentItems.length) {
      const recent = document.createElement("div");
      recent.className = "recent-items";
      result.recentItems.slice(0, 3).forEach(item => {
        const link = document.createElement("a");
        link.href = safeUrl(item.url || result.profileUrl);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = item.title || "Recent public activity";
        recent.append(link);
      });
      evidence.append(recent);
    }
    const profile = document.createElement("a");
    profile.className = "result-link";
    profile.href = safeUrl(result.profileUrl);
    profile.target = "_blank";
    profile.rel = "noopener noreferrer";
    profile.textContent = "Open source profile ↗";
    evidence.append(profile);
    card.append(evidence);
  }
  return card;
}

function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : "#"; } catch { return "#"; }
}
function labelForStatus(status) { return ({ found: "Confirmed", uncertain: "Uncertain", not_found: "Not found", error: "Blocked" })[status] || "Unknown"; }
function humanize(value) { return value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim().toLowerCase(); }
function compactNumber(value) { return new Intl.NumberFormat("en", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }

function celebrate() {
  const holder = $("#celebration");
  holder.replaceChildren();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#9b7cff", "#658bff", "#6ee7ee", "#59d9a4", "#f5c86d"];
  for (let i = 0; i < 46; i++) {
    const piece = document.createElement("i");
    piece.className = "confetti";
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty("--x", `${(Math.random() - .5) * Math.min(innerWidth, 900)}px`);
    piece.style.setProperty("--y", `${120 + Math.random() * 300}px`);
    piece.style.setProperty("--r", `${Math.random() * 900 - 450}deg`);
    piece.style.animationDelay = `${Math.random() * .18}s`;
    holder.append(piece);
  }
  setTimeout(() => holder.replaceChildren(), 2200);
}

function downloadReport() {
  const report = {
    product: "AliasTrace",
    generatedAt: new Date().toISOString(),
    aliases: state.aliases,
    checkedPlatforms: new Set(state.results.map(item => item.platformId)).size,
    methodology: "Allowlisted public profile and API checks. Confirmed and uncertain results are separated.",
    results: state.results
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aliastrace-${state.aliases.join("-")}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sendEmail(event) {
  event.preventDefault();
  const email = $("#report-email").value.trim();
  const status = $("#email-status");
  if (!$("#email-consent").checked || !$("#report-email").checkValidity()) return;
  const button = $("#send-email-button");
  button.disabled = true;
  status.textContent = "Preparing the report…";
  try {
    const response = await api({ action: "email-report", scanId: state.scanId, scanToken: state.scanToken, email });
    status.style.color = "var(--green)";
    status.textContent = response.message || "Report queued for delivery.";
    setTimeout(() => $("#email-dialog").close(), 1600);
  } catch (error) {
    if (error.status === 503) {
      const subject = encodeURIComponent(`AliasTrace report for ${state.aliases.join(", ")}`);
      const body = encodeURIComponent(`The automatic email provider is not configured. Download your report from AliasTrace and attach it here.\n\nAliases: ${state.aliases.join(", ")}`);
      location.href = `mailto:${email}?subject=${subject}&body=${body}`;
      status.textContent = "Opened your email app as a fallback.";
    } else status.textContent = error.message;
  } finally { button.disabled = false; }
}

async function runDemo() {
  const demoPlatforms = [
    ["github", "GitHub", "Developer", "https://github.com/{}"],
    ["reddit", "Reddit", "Social", "https://www.reddit.com/user/{}"],
    ["youtube", "YouTube", "Creative", "https://www.youtube.com/@{}"],
    ["bluesky", "Bluesky", "Social", "https://bsky.app/profile/{}.bsky.social"],
    ["codeforces", "Codeforces", "Developer", "https://codeforces.com/profile/{}"]
  ];
  const total = 40;
  for (let i = 0; i < total; i += 5) {
    await wait(220, state.controller.signal);
    const incoming = demoPlatforms.map(([platformId, platform, category, url], offset) => ({
      platformId, platform, category, alias: state.aliases[(i + offset) % state.aliases.length],
      status: (i + offset) % 4 === 0 ? "found" : ((i + offset) % 7 === 0 ? "uncertain" : "not_found"),
      profileUrl: url.replace("{}", encodeURIComponent(state.aliases[(i + offset) % state.aliases.length])),
      displayName: (i + offset) % 4 === 0 ? state.aliases[(i + offset) % state.aliases.length] : null,
      metrics: (i + offset) % 4 === 0 ? { followers: 128 + i, publicItems: 7 + offset } : {},
      contentCount: (i + offset) % 4 === 0 ? 7 + offset : 0,
      recentItems: []
    }));
    state.results.push(...incoming);
    updateProgress(Math.min(i + 5, total), total);
    renderLive(incoming);
  }
}

aliasInput.addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); addAlias(); }
  if (event.key === "Backspace" && !aliasInput.value && state.aliases.length) {
    state.aliases.pop(); renderAliases();
  }
});
$("#add-alias").addEventListener("click", () => addAlias());
form.addEventListener("submit", startScan);
$("#stop-scan").addEventListener("click", () => { state.stopped = true; state.controller?.abort(); });
$("#result-filter").addEventListener("input", () => { state.visibleLimit = 24; renderResultCards(); });
$("#status-filter").addEventListener("change", () => { state.visibleLimit = 24; renderResultCards(); });
$("#load-more").addEventListener("click", () => { state.visibleLimit += 24; renderResultCards(); });
$("#download-report-button").addEventListener("click", downloadReport);
$("#email-report-button").addEventListener("click", () => $("#email-dialog").showModal());
$("#email-form").addEventListener("submit", sendEmail);
$("#year").textContent = new Date().getFullYear();

loadCatalogue().catch(error => { formError.textContent = error.message; });
