import { createClient } from "@supabase/supabase-js";
import { PLATFORMS } from "./catalogue.ts";

type JsonRecord = Record<string, unknown>;
type ScanStatus = "found" | "not_found" | "uncertain" | "error";
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_MAP = new Map<string, Platform>(PLATFORMS.map(platform => [platform.id, platform]));
const MAX_ALIASES = 3;
const MAX_BATCH = 10;
const FETCH_TIMEOUT_MS = 7_000;
const MAX_RESPONSE_BYTES = 160_000;
const ALIAS_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,31}$/u;
const ALLOWED_ORIGINS = new Set([
  "https://webscraper.marfeyx.ch",
  "https://marfeyx.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:4173"
]);
const USER_AGENT = "MarfeyxWebscraper/1.1 (+https://webscraper.marfeyx.ch; contact: dev@marfeyx.ch)";

function getSecretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    if (keys.default) return keys.default;
  } catch { /* handled below */ }
  throw new Error("Supabase secret key is unavailable");
}

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getSecretKey(), {
  auth: { persistSession: false, autoRefreshToken: false }
});

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://webscraper.marfeyx.ch";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-id",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
}

function json(origin: string | null, body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), ...extra } });
}

function normalizeAliases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ALIASES) throw new HttpError(400, "Submit between one and three aliases.");
  const aliases = value.map(item => String(item).trim().replace(/^@+/, ""));
  if (aliases.some(alias => !ALIAS_PATTERN.test(alias))) throw new HttpError(400, "An alias has an invalid format.");
  if (new Set(aliases.map(alias => alias.toLowerCase())).size !== aliases.length) throw new HttpError(400, "Duplicate aliases are not allowed.");
  return aliases;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function requestKey(req: Request): Promise<string> {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const client = req.headers.get("x-client-id")?.slice(0, 80) || "none";
  const agent = req.headers.get("user-agent")?.slice(0, 160) || "unknown";
  const salt = Deno.env.get("RATE_LIMIT_SALT") || getSecretKey();
  return sha256(`${salt}|${forwarded}|${client}|${agent}`);
}

function hasValidPublishableKey(req: Request): boolean {
  const supplied = req.headers.get("apikey");
  if (!supplied) return false;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}") as Record<string, string>;
    return Object.values(keys).includes(supplied);
  } catch {
    return supplied === Deno.env.get("SUPABASE_ANON_KEY");
  }
}

async function consumeLimit(key: string, action: string, limit: number, windowSeconds: number): Promise<void> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucket = await sha256(`${key}:${action}:${window}`);
  const expires = new Date((window + 1) * windowSeconds * 1000).toISOString();
  const { data, error } = await supabase.rpc("consume_rate_limit", { p_bucket: bucket, p_limit: limit, p_expires: expires });
  if (error) throw new Error(`Rate-limit storage failed: ${error.message}`);
  if (!data) {
    const retryAfter = Math.max(1, Math.ceil((new Date(expires).getTime() - Date.now()) / 1000));
    throw new HttpError(429, "Too many scan requests. Please wait before trying again.", retryAfter);
  }
}

async function verifyScan(scanId: unknown, token: unknown) {
  if (typeof scanId !== "string" || typeof token !== "string" || token.length < 32) throw new HttpError(400, "Invalid scan credentials.");
  const tokenHash = await sha256(token);
  const { data, error } = await supabase.from("scans").select("id, aliases, platform_count, status, expires_at").eq("id", scanId).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) throw new HttpError(404, "Scan not found or expired.");
  return data;
}

function fillTemplate(value: unknown, alias: string): unknown {
  if (typeof value === "string") return value.replaceAll("{}", alias);
  if (Array.isArray(value)) return value.map(item => fillTemplate(item, alias));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillTemplate(item, alias)]));
  return value;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") return true;
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(host)) return true;
  return false;
}

function buildPlatformUrl(template: string, alias: string): URL {
  const encoded = encodeURIComponent(alias);
  const url = new URL(template.replaceAll("{}", encoded));
  if (url.protocol !== "https:" || isPrivateHost(url.hostname)) throw new HttpError(400, "Unsafe platform destination rejected.");
  const templateUrl = new URL(template.replaceAll("{}", "aliastrace-safe"));
  if (templateUrl.hostname.includes("aliastrace-safe")) {
    const suffix = templateUrl.hostname.replace("aliastrace-safe", "");
    if (!url.hostname.endsWith(suffix) || url.hostname.length <= suffix.length) throw new HttpError(400, "Unsafe dynamic hostname rejected.");
  } else if (url.hostname !== templateUrl.hostname) throw new HttpError(400, "Platform hostname mismatch.");
  return url;
}

function redirectAllowed(from: URL, to: URL): boolean {
  if (to.protocol !== "https:" || isPrivateHost(to.hostname)) return false;
  const clean = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return clean(from.hostname) === clean(to.hostname);
}

async function readLimited(response: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - size;
      chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
      size += Math.min(value.length, remaining);
      if (value.length > remaining) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

interface Fetched { status: number; body: string; finalUrl: string; headers: Headers; elapsedMs: number; }

async function safeFetch(initial: URL, init: RequestInit = {}, allowCrossHost = false): Promise<Fetched> {
  const started = performance.now();
  let current = initial;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (current.protocol !== "https:" || isPrivateHost(current.hostname)) throw new Error("Unsafe fetch destination");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
        headers: { "accept": "text/html,application/json;q=0.9,*/*;q=0.5", "user-agent": USER_AGENT, ...(init.headers || {}) }
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        const next = new URL(response.headers.get("location")!, current);
        if (!allowCrossHost && !redirectAllowed(current, next)) return { status: 0, body: "", finalUrl: current.href, headers: response.headers, elapsedMs: Math.round(performance.now() - started) };
        current = next;
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      const body = /(?:json|text|html|xml|javascript)/i.test(contentType) ? await readLimited(response) : "";
      return { status: response.status, body, finalUrl: current.href, headers: response.headers, elapsedMs: Math.round(performance.now() - started) };
    } finally { clearTimeout(timer); }
  }
  return { status: 0, body: "", finalUrl: current.href, headers: new Headers(), elapsedMs: Math.round(performance.now() - started) };
}

function metaValue(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']{1,500})["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, "i")
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return decodeEntities(match[1]);
    }
  }
  return null;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

async function checkPlatform(platform: Platform, alias: string): Promise<JsonRecord> {
  const started = performance.now();
  const profileUrl = buildPlatformUrl(platform.profileUrl, alias);
  let probeUrl: URL;
  try { probeUrl = buildPlatformUrl(platform.probeUrl || platform.profileUrl, alias); }
  catch { probeUrl = profileUrl; }
  if (platform.regex) {
    try { if (!new RegExp(platform.regex).test(alias)) return baseResult(platform, alias, profileUrl.href, "not_found", "Alias is invalid on this platform", 0); }
    catch { /* Ignore malformed upstream validation expressions. */ }
  }
  let fetched: Fetched;
  try {
    const init: RequestInit = platform.method === "POST"
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fillTemplate(platform.payload || {}, alias)) }
      : { method: "GET" };
    fetched = await safeFetch(probeUrl, init);
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError" ? "Timed out" : "Platform request failed";
    return baseResult(platform, alias, profileUrl.href, "error", message, Math.round(performance.now() - started));
  }
  let status: ScanStatus = "uncertain";
  let message = `HTTP ${fetched.status || "blocked"}`;
  if (fetched.status === 429) { status = "error"; message = "Rate limited by platform"; }
  else if (fetched.status === 401 || fetched.status === 403 || fetched.status === 0) { status = "uncertain"; message = "Platform blocked verification"; }
  else if (fetched.status === platform.errorCode || fetched.status === 404 || fetched.status === 410) { status = "not_found"; message = "Profile not found"; }
  else if (platform.detection === "message") {
    const missing = platform.errorMessages.some(text => text && fetched.body.includes(text));
    status = missing ? "not_found" : (fetched.status >= 200 && fetched.status < 400 ? "found" : "uncertain");
    message = missing ? "Platform returned its missing-profile marker" : "Public profile response matched";
  } else if (platform.detection === "response_url" && platform.errorUrl) {
    let missing = false;
    try {
      const expected = new URL(String(fillTemplate(platform.errorUrl, alias)), profileUrl).href.replace(/\/$/, "");
      missing = fetched.finalUrl.replace(/\/$/, "") === expected;
    } catch { /* Remain uncertain on invalid upstream error URL. */ }
    status = missing ? "not_found" : (fetched.status >= 200 && fetched.status < 400 ? "found" : "uncertain");
    message = missing ? "Platform redirected to its missing-profile page" : "Public profile response matched";
  } else if (fetched.status >= 200 && fetched.status < 400) { status = "found"; message = "Public profile endpoint exists"; }
  else if (fetched.status >= 500) { status = "error"; message = "Platform unavailable"; }

  const result = baseResult(platform, alias, profileUrl.href, status, message, fetched.elapsedMs);
  if (status === "found") {
    Object.assign(result, genericMetadata(fetched.body));
    const enriched = await enrichPlatform(platform.id, alias).catch(() => ({}));
    Object.assign(result, mergeEnrichment(result, enriched));
  }
  return result;
}

function baseResult(platform: Platform, alias: string, profileUrl: string, status: ScanStatus, message: string, responseMs: number): JsonRecord {
  return { platformId: platform.id, platform: platform.name, category: platform.category, alias, profileUrl, status, message, responseMs, metrics: {}, recentItems: [], contentCount: 0 };
}

function genericMetadata(body: string): JsonRecord {
  if (!body) return {};
  const title = metaValue(body, ["og:title", "twitter:title"]);
  const description = metaValue(body, ["og:description", "description", "twitter:description"]);
  const avatarUrl = metaValue(body, ["og:image", "twitter:image"]);
  return { ...(title ? { displayName: title.slice(0, 180) } : {}), ...(description ? { description: description.slice(0, 500) } : {}), ...(avatarUrl?.startsWith("https://") ? { avatarUrl } : {}) };
}

function mergeEnrichment(base: JsonRecord, extra: JsonRecord): JsonRecord {
  return {
    ...extra,
    metrics: { ...((base.metrics as JsonRecord) || {}), ...((extra.metrics as JsonRecord) || {}) },
    recentItems: Array.isArray(extra.recentItems) ? extra.recentItems.slice(0, 5) : base.recentItems,
    contentCount: Number(extra.contentCount || base.contentCount || 0)
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || isPrivateHost(parsed.hostname)) throw new Error("Unsafe enrichment URL");
  const result = await safeFetch(parsed, { headers: { accept: "application/json" } }, true);
  if (result.status < 200 || result.status >= 300) throw new Error(`Enrichment returned ${result.status}`);
  return JSON.parse(result.body);
}

async function enrichPlatform(id: string, alias: string): Promise<JsonRecord> {
  const encoded = encodeURIComponent(alias);
  if (id === "github") {
    const user = await fetchJson(`https://api.github.com/users/${encoded}`) as JsonRecord;
    const events = await fetchJson(`https://api.github.com/users/${encoded}/events/public?per_page=5`).catch(() => []) as JsonRecord[];
    return { displayName: user.name || user.login, avatarUrl: user.avatar_url, metrics: { repositories: user.public_repos || 0, followers: user.followers || 0, following: user.following || 0 }, contentCount: Number(user.public_repos || 0), recentItems: events.map(event => ({ title: `${event.type || "Activity"} · ${String((event.repo as JsonRecord)?.name || "GitHub")}`, url: `https://github.com/${String((event.repo as JsonRecord)?.name || alias)}` })) };
  }
  if (id === "gitlab") {
    const users = await fetchJson(`https://gitlab.com/api/v4/users?username=${encoded}`) as JsonRecord[];
    const user = users.find(item => String(item.username).toLowerCase() === alias.toLowerCase()) || users[0];
    if (!user) return {};
    const projects = await fetchJson(`https://gitlab.com/api/v4/users/${user.id}/projects?per_page=5&order_by=last_activity_at`).catch(() => []) as JsonRecord[];
    return { displayName: user.name, avatarUrl: user.avatar_url, metrics: { publicProjects: projects.length }, contentCount: projects.length, recentItems: projects.map(project => ({ title: project.name_with_namespace || project.name, url: project.web_url })) };
  }
  if (id === "bluesky") {
    const actor = alias.includes(".") ? alias : `${alias}.bsky.social`;
    const profile = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`) as JsonRecord;
    const feed = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=5`).catch(() => ({ feed: [] })) as JsonRecord;
    const items = Array.isArray(feed.feed) ? feed.feed as JsonRecord[] : [];
    return { displayName: profile.displayName || profile.handle, avatarUrl: profile.avatar, metrics: { followers: profile.followersCount || 0, follows: profile.followsCount || 0, posts: profile.postsCount || 0 }, contentCount: Number(profile.postsCount || 0), recentItems: items.map(item => { const post = item.post as JsonRecord; const record = post?.record as JsonRecord; return { title: String(record?.text || "Bluesky post").slice(0, 100), url: `https://bsky.app/profile/${profile.handle}/post/${String(post?.uri || "").split("/").pop()}` }; }) };
  }
  if (id === "dev-community") {
    const user = await fetchJson(`https://dev.to/api/users/by_username?url=${encoded}`) as JsonRecord;
    const articles = await fetchJson(`https://dev.to/api/articles?username=${encoded}&per_page=5`).catch(() => []) as JsonRecord[];
    return { displayName: user.name || user.username, avatarUrl: user.profile_image, metrics: { articles: articles.length }, contentCount: articles.length, recentItems: articles.map(article => ({ title: article.title, url: article.url })) };
  }
  if (id === "hackernews") {
    const user = await fetchJson(`https://hacker-news.firebaseio.com/v0/user/${encoded}.json`) as JsonRecord;
    const submitted = Array.isArray(user.submitted) ? user.submitted as unknown[] : [];
    return { displayName: user.id, metrics: { karma: user.karma || 0, submissions: submitted.length }, contentCount: submitted.length, recentItems: submitted.slice(0, 5).map(item => ({ title: `Hacker News item ${item}`, url: `https://news.ycombinator.com/item?id=${item}` })) };
  }
  if (id === "codeforces") {
    const info = await fetchJson(`https://codeforces.com/api/user.info?handles=${encoded}`) as JsonRecord;
    const user = Array.isArray(info.result) ? (info.result as JsonRecord[])[0] : null;
    if (!user) return {};
    return { displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.handle, avatarUrl: user.titlePhoto || user.avatar, metrics: { rating: user.rating || 0, maxRating: user.maxRating || 0, contribution: user.contribution || 0 }, contentCount: 0 };
  }
  if (id === "chess") {
    const profile = await fetchJson(`https://api.chess.com/pub/player/${encoded}`) as JsonRecord;
    const stats = await fetchJson(`https://api.chess.com/pub/player/${encoded}/stats`).catch(() => ({})) as JsonRecord;
    const rapid = (stats.chess_rapid as JsonRecord)?.last as JsonRecord;
    const blitz = (stats.chess_blitz as JsonRecord)?.last as JsonRecord;
    return { displayName: profile.name || profile.username, avatarUrl: profile.avatar, metrics: { followers: profile.followers || 0, rapid: rapid?.rating || 0, blitz: blitz?.rating || 0 }, contentCount: 0 };
  }
  if (id === "reddit") {
    const about = await fetchJson(`https://www.reddit.com/user/${encoded}/about.json?raw_json=1`) as JsonRecord;
    const user = (about.data || {}) as JsonRecord;
    const submitted = await fetchJson(`https://www.reddit.com/user/${encoded}/submitted.json?limit=5&raw_json=1`).catch(() => ({ data: { children: [] } })) as JsonRecord;
    const children = ((((submitted.data || {}) as JsonRecord).children || []) as JsonRecord[]);
    return { displayName: user.subreddit ? ((user.subreddit as JsonRecord).title || user.name) : user.name, avatarUrl: user.snoovatar_img || user.icon_img, metrics: { postKarma: user.link_karma || 0, commentKarma: user.comment_karma || 0, postsLoaded: children.length }, contentCount: children.length, recentItems: children.map(child => { const post = child.data as JsonRecord; return { title: post.title || "Reddit post", url: `https://www.reddit.com${post.permalink || ""}` }; }) };
  }
  if (id === "scratch") {
    const user = await fetchJson(`https://api.scratch.mit.edu/users/${encoded}`) as JsonRecord;
    const projects = await fetchJson(`https://api.scratch.mit.edu/users/${encoded}/projects?limit=5&offset=0`).catch(() => []) as JsonRecord[];
    const images = user.profile as JsonRecord;
    return { displayName: user.username, avatarUrl: images?.images ? (images.images as JsonRecord)["90x90"] : null, metrics: { projects: projects.length }, contentCount: projects.length, recentItems: projects.map(project => ({ title: project.title, url: `https://scratch.mit.edu/projects/${project.id}` })) };
  }
  if (id === "docker-hub") {
    const user = await fetchJson(`https://hub.docker.com/v2/users/${encoded}/`) as JsonRecord;
    return { displayName: user.full_name || user.username, avatarUrl: user.gravatar_url, metrics: {}, contentCount: 0 };
  }
  if (id === "mastodon-social") {
    const account = await fetchJson(`https://mastodon.social/api/v1/accounts/lookup?acct=${encoded}`) as JsonRecord;
    const statuses = await fetchJson(`https://mastodon.social/api/v1/accounts/${account.id}/statuses?limit=5&exclude_replies=true`).catch(() => []) as JsonRecord[];
    return { displayName: account.display_name || account.username, avatarUrl: account.avatar_static, metrics: { followers: account.followers_count || 0, follows: account.following_count || 0, posts: account.statuses_count || 0 }, contentCount: Number(account.statuses_count || 0), recentItems: statuses.map(item => ({ title: String(item.content || "Mastodon post").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100), url: item.url })) };
  }
  return {};
}

async function pool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function handleStart(req: Request, body: JsonRecord, key: string) {
  const aliases = normalizeAliases(body.aliases);
  const platformCount = Math.min(Math.max(Number(body.platformCount) || 0, 1), PLATFORMS.length);
  await consumeLimit(key, "start", 3, 900);
  await consumeLimit("global", "start", 120, 3600);
  const token = randomToken();
  const tokenHash = await sha256(token);
  const { data, error } = await supabase.from("scans").insert({ token_hash: tokenHash, client_hash: key, aliases, alias_count: aliases.length, platform_count: platformCount, status: "running" }).select("id, expires_at").single();
  if (error) throw new Error(error.message);
  return { scanId: data.id, scanToken: token, expiresAt: data.expires_at, maxBatchSize: MAX_BATCH };
}

async function handleBatch(body: JsonRecord, key: string) {
  const scan = await verifyScan(body.scanId, body.scanToken);
  const aliases = normalizeAliases(body.aliases);
  if (JSON.stringify(aliases) !== JSON.stringify(scan.aliases)) throw new HttpError(403, "Aliases do not match this scan.");
  if (!Array.isArray(body.platformIds) || body.platformIds.length < 1 || body.platformIds.length > MAX_BATCH) throw new HttpError(400, `Each batch must contain 1–${MAX_BATCH} platform IDs.`);
  const ids = [...new Set(body.platformIds.map(String))];
  if (ids.length !== body.platformIds.length) throw new HttpError(400, "Duplicate platform IDs are not allowed.");
  const platforms = ids.map(id => PLATFORM_MAP.get(id));
  if (platforms.some(item => !item)) throw new HttpError(400, "Unknown platform ID.");
  await consumeLimit(key, "batch", 80, 900);
  await consumeLimit("global", "batch", 900, 60);
  const tasks = (platforms as Platform[]).flatMap(platform => aliases.map(alias => ({ platform, alias })));
  const results = await pool(tasks, 3, task => checkPlatform(task.platform, task.alias));
  const rows = results.map(result => ({ scan_id: scan.id, alias: result.alias, platform_id: result.platformId, status: result.status, profile_url: result.profileUrl, response_ms: result.responseMs, result_data: result }));
  const { error } = await supabase.from("scan_results").upsert(rows, { onConflict: "scan_id,alias,platform_id" });
  if (error) throw new Error(error.message);
  return { results, retryAfterMs: 450 };
}

async function handleFinish(body: JsonRecord) {
  const scan = await verifyScan(body.scanId, body.scanToken);
  const { error } = await supabase.from("scans").update({ status: "complete", finished_at: new Date().toISOString() }).eq("id", scan.id);
  if (error) throw new Error(error.message);
  return { complete: true };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

function emailHtml(aliases: string[], results: JsonRecord[]): string {
  const found = results.filter(item => item.status === "found");
  const cards = found.map(item => `<tr><td style="padding:14px;border-bottom:1px solid #272a45"><strong>${escapeHtml(item.platform)}</strong><br><span style="color:#969ab4">@${escapeHtml(item.alias)}</span></td><td style="padding:14px;border-bottom:1px solid #272a45"><a style="color:#b9a6ff" href="${escapeHtml(item.profileUrl)}">Open profile</a></td></tr>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#080914;color:#f4f3fb;font:15px Arial,sans-serif"><div style="max-width:680px;margin:auto;padding:40px 20px"><p style="color:#c3b3ff;text-transform:uppercase;letter-spacing:2px;font-size:11px">Marfeyx' Webscraper report</p><h1 style="font-size:38px;margin:8px 0">${found.length} confirmed profiles</h1><p style="color:#9b9db3">Aliases: ${aliases.map(alias => `@${escapeHtml(alias)}`).join(", ")}. A matching alias does not prove common ownership; verify important findings at the source.</p><table style="width:100%;border-collapse:collapse;background:#111329;border:1px solid #272a45;border-radius:16px">${cards || `<tr><td style="padding:20px">No confirmed profiles were found.</td></tr>`}</table><p style="color:#70738b;font-size:12px;margin-top:24px">Generated from public sources. Scan data expires within 24 hours. Questions: dev@marfeyx.ch</p></div></body></html>`;
}

async function handleEmail(body: JsonRecord, key: string) {
  const scan = await verifyScan(body.scanId, body.scanToken);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw new HttpError(400, "Enter a valid email address.");
  await consumeLimit(key, "email", 2, 3600);
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new HttpError(503, "Automatic email delivery is not configured.");
  const { data, error } = await supabase.from("scan_results").select("result_data").eq("scan_id", scan.id).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const results = (data || []).map((row: { result_data: JsonRecord }) => row.result_data);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ from: Deno.env.get("REPORT_FROM") || "Marfeyx Webscraper <reports@marfeyx.ch>", to: [email], subject: `Marfeyx' Webscraper report for ${(scan.aliases as string[]).join(", ")}`, html: emailHtml(scan.aliases as string[], results) })
  });
  if (!response.ok) throw new HttpError(502, "The email provider rejected the delivery request.");
  return { message: "Report sent. Check your inbox and spam folder." };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: "Origin not allowed" }, 403);
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return json(origin, { error: "Method not allowed" }, 405);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: "Origin not allowed" }, 403);
  if (!hasValidPublishableKey(req)) return json(origin, { error: "Invalid application key" }, 401);
  try {
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 16_384) throw new HttpError(413, "Request body is too large.");
    const body = await req.json() as JsonRecord;
    const action = String(body.action || "");
    const key = await requestKey(req);
    let result: unknown;
    if (action === "start") result = await handleStart(req, body, key);
    else if (action === "scan-batch") result = await handleBatch(body, key);
    else if (action === "finish") result = await handleFinish(body);
    else if (action === "email-report") result = await handleEmail(body, key);
    else throw new HttpError(400, "Unknown action.");
    return json(origin, result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown error");
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "The scan service encountered an internal error.";
    const extra: Record<string, string> = error instanceof HttpError && error.retryAfter ? { "retry-after": String(error.retryAfter) } : {};
    return json(origin, { error: message }, status, extra);
  }
});
