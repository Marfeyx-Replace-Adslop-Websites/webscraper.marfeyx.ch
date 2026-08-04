const $ = (selector, root = document) => root.querySelector(selector);
const config = window.WEBSCRAPER_CONFIG || {};
const RESULT_KEY = "marfeyx-completed-scan-v1";
const MAX_AGE = 86_400_000;
const PAGE_SIZE = matchMedia("(max-width: 640px)").matches ? 10 : 18;
const POPULAR_IDS = ["youtube-2", "instagram", "tiktok", "facebook", "twitter-2", "reddit", "snapchat", "threads-2", "discord", "twitch-2", "telegram", "pinterest", "bluesky", "linkedin", "spotify", "steam-community-user", "roblox", "github", "gitlab"];
const POPULAR_ORDER = new Map(POPULAR_IDS.map((id, index) => [id, index]));
const state = { aliases: [], results: [], scanId: null, scanToken: null, platformTotal: 0, checkedTotal: 0, partial: false, activeAlias: "all", visibleLimit: PAGE_SIZE };

function getClientId() {
  const key = "marfeyx-webscraper-client-id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

async function api(body) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") || !config.supabasePublishableKey) throw new Error("The report service is not configured.");
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${config.functionName || "alias-scan"}`, { method: "POST", headers: { "content-type": "application/json", apikey: config.supabasePublishableKey, "x-client-id": getClientId() }, body: JSON.stringify(body) });
  let data; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) { const error = new Error(data.error || `Report service returned ${response.status}.`); error.status = response.status; throw error; }
  return data;
}

function loadSnapshot() {
  let snapshot;
  try { snapshot = JSON.parse(localStorage.getItem(RESULT_KEY) || "null"); } catch { snapshot = null; }
  if (!snapshot || Date.now() - Number(snapshot.savedAt) > MAX_AGE || !Array.isArray(snapshot.aliases) || !Array.isArray(snapshot.results)) {
    localStorage.removeItem(RESULT_KEY); $("#results-empty").hidden = false; return;
  }
  Object.assign(state, snapshot);
  $("#results-section").hidden = false;
  $("#results-kicker").textContent = state.partial ? "Partial scan" : "Scan complete";
  document.title = `${state.aliases.map(alias => `@${alias}`).join(", ")} — scan results`;
  const emailButton = $("#email-report-button");
  if (!state.scanId || !state.scanToken) { emailButton.disabled = true; emailButton.title = "Email delivery is unavailable for demo results."; }
  renderResults();
}

function resultContentCount(result) { return Number.isFinite(result.contentCount) ? result.contentCount : (Array.isArray(result.recentItems) ? result.recentItems.length : 0); }
function renderResults() {
  const found = state.results.filter(item => item.status === "found");
  const uncertain = state.results.filter(item => item.status === "uncertain");
  const checked = state.checkedTotal || new Set(state.results.map(item => item.platformId)).size;
  $("#stat-found").textContent = found.length;
  $("#stat-content").textContent = compactNumber(found.reduce((sum, item) => sum + resultContentCount(item), 0));
  $("#stat-checked").textContent = checked;
  $("#stat-coverage").textContent = `${Math.round(checked / Math.max(state.platformTotal, 1) * 100)}% selected-scan coverage`;
  $("#stat-confidence").textContent = found.length + uncertain.length ? `${Math.round(found.length / (found.length + uncertain.length) * 100)}%` : "—";
  $("#results-summary").textContent = `${state.aliases.map(alias => `@${alias}`).join(", ")} produced ${found.length} confirmed profile${found.length === 1 ? "" : "s"} and ${uncertain.length} uncertain check${uncertain.length === 1 ? "" : "s"}.${state.partial ? " This scan was stopped early." : ""}`;
  renderAliasTabs(); renderCards();
}

function renderAliasTabs() {
  $("#alias-tabs").replaceChildren(...["all", ...state.aliases].map(value => {
    const button = document.createElement("button"); button.type = "button"; button.role = "tab"; button.className = state.activeAlias === value ? "active" : ""; button.setAttribute("aria-selected", String(state.activeAlias === value)); button.textContent = value === "all" ? "All aliases" : `@${value}`;
    button.addEventListener("click", () => { state.activeAlias = value; state.visibleLimit = PAGE_SIZE; renderAliasTabs(); renderCards(); }); return button;
  }));
}

function renderCards() {
  const query = $("#result-filter").value.trim().toLowerCase(); const status = $("#status-filter").value; const rank = { found: 0, uncertain: 1, error: 2, not_found: 3 };
  const results = state.results.filter(item => state.activeAlias === "all" || item.alias === state.activeAlias).filter(item => status === "all" || item.status === status).filter(item => !query || `${item.platform} ${item.alias}`.toLowerCase().includes(query)).sort((a, b) => {
    const ap = POPULAR_ORDER.has(a.platformId), bp = POPULAR_ORDER.has(b.platformId); if (ap !== bp) return ap ? -1 : 1; if (ap && bp) return POPULAR_ORDER.get(a.platformId) - POPULAR_ORDER.get(b.platformId); return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.platform.localeCompare(b.platform);
  });
  const page = results.slice(0, state.visibleLimit); const grid = $("#results-grid");
  if (!page.length) { const empty = document.createElement("div"); empty.className = "empty-results"; empty.textContent = "No results match these filters."; grid.replaceChildren(empty); }
  else grid.replaceChildren(...page.map(createCard));
  $("#load-more").hidden = results.length <= state.visibleLimit;
}

function createCard(result) {
  const card = document.createElement("article"); card.className = `result-card ${result.status}`;
  const main = document.createElement("div"); main.className = "result-card-main";
  const avatar = document.createElement("div"); avatar.className = "platform-avatar"; avatar.textContent = result.platform.slice(0, 1).toUpperCase();
  if (safeUrl(result.avatarUrl)) { const image = document.createElement("img"); image.src = safeUrl(result.avatarUrl); image.alt = ""; image.width = 44; image.height = 44; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer"; image.addEventListener("error", () => image.remove()); avatar.replaceChildren(image); }
  const identity = document.createElement("div"); identity.className = "identity"; const title = document.createElement("h3"); title.textContent = result.platform; const subtitle = document.createElement("p"); subtitle.textContent = result.displayName ? `${result.displayName} · @${result.alias}` : `@${result.alias} · ${result.message || label(result.status)}`; identity.append(title, subtitle);
  const badge = document.createElement("span"); badge.className = `status-badge ${result.status}`; badge.textContent = label(result.status); main.append(avatar, identity, badge); card.append(main);
  if (["found", "uncertain"].includes(result.status)) {
    const evidence = document.createElement("div"); evidence.className = "result-evidence"; const metrics = document.createElement("div"); metrics.className = "metrics";
    Object.entries(result.metrics || {}).slice(0, 4).forEach(([name, value]) => { const item = document.createElement("span"); item.className = "metric"; const strong = document.createElement("strong"); strong.textContent = typeof value === "number" ? compactNumber(value) : String(value); item.append(strong, document.createTextNode(humanize(name))); metrics.append(item); });
    if (metrics.children.length) evidence.append(metrics);
    if (Array.isArray(result.recentItems) && result.recentItems.length) { const recent = document.createElement("div"); recent.className = "recent-items"; result.recentItems.slice(0, 2).forEach(item => { const href = safeUrl(item.url || result.profileUrl); if (!href) return; const link = document.createElement("a"); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = item.title || "Recent public activity"; recent.append(link); }); if (recent.children.length) evidence.append(recent); }
    const href = safeUrl(result.profileUrl); if (href) { const link = document.createElement("a"); link.className = "result-link"; link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open source profile ↗"; evidence.append(link); } card.append(evidence);
  }
  return card;
}

function safeUrl(value) { try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
function label(status) { return ({ found: "Confirmed", uncertain: "Uncertain", not_found: "Not found", error: "Blocked" })[status] || "Unknown"; }
function humanize(value) { return value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim().toLowerCase(); }
function compactNumber(value) { return new Intl.NumberFormat("en", { notation: value >= 1000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }

function downloadReport() {
  const report = { product: "Marfeyx' Webscraper", generatedAt: new Date().toISOString(), aliases: state.aliases, checkedPlatforms: state.checkedTotal, methodology: "Allowlisted public profile and API checks. Confirmed and uncertain results are separated.", results: state.results };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `marfeyx-webscraper-${state.aliases.join("-")}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function sendEmail(event) {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const button = $("#send-email-button"); const status = $("#email-status"); button.disabled = true; status.style.color = ""; status.textContent = "Preparing the report…";
  try { const response = await api({ action: "email-report", scanId: state.scanId, scanToken: state.scanToken, email: $("#report-email").value.trim() }); status.style.color = "var(--green)"; status.textContent = response.message || "Report queued for delivery."; setTimeout(() => $("#email-dialog").close(), 1400); }
  catch (error) { status.style.color = "var(--red)"; status.textContent = error.status === 503 ? "Automatic delivery is temporarily unavailable. Download the JSON report and try again later." : error.message; }
  finally { button.disabled = false; }
}

$("#result-filter").addEventListener("input", () => { state.visibleLimit = PAGE_SIZE; renderCards(); });
$("#status-filter").addEventListener("change", () => { state.visibleLimit = PAGE_SIZE; renderCards(); });
$("#load-more").addEventListener("click", () => { state.visibleLimit += PAGE_SIZE; renderCards(); });
$("#download-report-button").addEventListener("click", downloadReport);
const dialog = $("#email-dialog");
$("#email-report-button").addEventListener("click", () => { $("#email-status").textContent = ""; dialog.showModal(); });
$("#email-dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("cancel", () => dialog.close());
$("#email-form").addEventListener("submit", sendEmail);
$("#year").textContent = new Date().getFullYear();
loadSnapshot();
