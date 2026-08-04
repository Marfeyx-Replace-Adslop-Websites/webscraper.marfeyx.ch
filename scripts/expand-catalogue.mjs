import { readFile, rm, writeFile } from "node:fs/promises";

const MAIGRET_DATA = "https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json";
const WESTERN_TAGS = new Set([
  "us", "ca", "mx", "br", "ar", "cl", "co", "pe", "uy",
  "gb", "uk", "de", "fr", "es", "it", "nl", "be", "ch", "at", "ie", "pt",
  "se", "no", "dk", "fi", "pl", "cz", "sk", "hu", "ro", "bg", "gr", "hr",
  "si", "ee", "lv", "lt", "lu", "is"
]);
const AMERICAS_TAGS = new Set(["us", "ca", "mx", "br", "ar", "cl", "co", "pe", "uy"]);
const EUROPE_TAGS = new Set([...WESTERN_TAGS].filter(tag => !AMERICAS_TAGS.has(tag)));
const ADULT_TAGS = new Set(["porn", "erotic", "dating", "adult", "xxx"]);
const TOPICAL_TAGS = new Set([
  "social", "gaming", "tech", "coding", "business", "music", "blog", "news", "art",
  "shopping", "photo", "design", "video", "networking", "streaming", "freelance",
  "writing", "messaging", "professional", "links", "education", "forum", "discussion"
]);
const MAJOR_DOMAINS = new Set([
  "facebook.com", "youtube.com", "instagram.com", "x.com", "twitter.com", "linkedin.com",
  "github.com", "reddit.com", "tiktok.com", "discord.com", "pinterest.com", "twitch.tv",
  "spotify.com", "soundcloud.com", "medium.com", "tumblr.com", "vimeo.com", "gitlab.com",
  "stackoverflow.com", "stackexchange.com", "etsy.com", "ebay.com", "amazon.com", "flickr.com",
  "behance.net", "deviantart.com", "telegram.me", "t.me", "bsky.app", "substack.com",
  "mastodon.social", "threads.net", "snapchat.com", "steamcommunity.com", "xbox.com",
  "playstation.com", "chess.com", "lichess.org", "codepen.io", "npmjs.com", "docker.com"
]);

function slug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "site";
}

function replaceTemplate(value, site) {
  if (typeof value !== "string") return null;
  return value
    .replaceAll("{urlMain}", site.urlMain || "")
    .replaceAll("{urlSubpath}", site.urlSubpath || "")
    .replaceAll("{username}", "{}")
    .replaceAll("{id}", "{}");
}

function canonical(value) {
  try {
    const url = new URL(value.replaceAll("{}", "username"));
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/username/gi, "{}").replace(/\/$/, "")}${url.search.replace(/username/gi, "{}").toLowerCase()}`;
  } catch { return value.toLowerCase(); }
}

function hostname(value) {
  try { return new URL(value.replaceAll("{}", "username")).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function categoryFor(tags) {
  const set = new Set(tags);
  if (["coding", "tech", "apps", "hacking"].some(tag => set.has(tag))) return "Developer";
  if (["music", "video", "photo", "art", "design", "streaming", "3d"].some(tag => set.has(tag))) return "Creative";
  if (["gaming", "esports"].some(tag => set.has(tag))) return "Gaming";
  if (["blog", "writing", "news", "wiki", "books", "documents", "education"].some(tag => set.has(tag))) return "Publishing";
  if (["social", "messaging", "networking", "forum", "discussion", "professional"].some(tag => set.has(tag))) return "Social";
  return "Other";
}

function regionFor(tags) {
  if (tags.some(tag => EUROPE_TAGS.has(tag))) return "Europe";
  if (tags.some(tag => AMERICAS_TAGS.has(tag))) return "Americas";
  return "Global";
}

function priorityFor(site, profileUrl, tags, source) {
  const host = hostname(profileUrl);
  if ([...MAJOR_DOMAINS].some(domain => host === domain || host.endsWith(`.${domain}`))) return 1;
  const rank = Number(site.alexaRank);
  const western = tags.some(tag => WESTERN_TAGS.has(tag));
  if (Number.isFinite(rank) && rank <= 10_000) return 1;
  if ((Number.isFinite(rank) && rank <= 1_000_000) || western) return 2;
  if (source === "Sherlock" || tags.some(tag => TOPICAL_TAGS.has(tag))) return 3;
  return 4;
}

function uniqueStrings(values, limit = 10) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && value.length > 0))].slice(0, limit);
}

function normalizeCore(site) {
  const tags = uniqueStrings(site.tags || []);
  const region = site.region || "Global";
  return {
    ...site,
    presenceMessages: uniqueStrings(site.presenceMessages || []),
    priority: Number(site.priority) || priorityFor({}, site.profileUrl, tags, "Sherlock"),
    region,
    tags,
    source: site.source || "Sherlock"
  };
}

function normalizeMaigret(name, raw, engines) {
  const engine = raw.engine ? engines[raw.engine]?.site || {} : {};
  const site = { ...engine, ...raw };
  const tags = uniqueStrings(site.tags || [], 20).map(tag => tag.toLowerCase());
  if (site.disabled || (site.type && site.type !== "username") || tags.some(tag => ADULT_TAGS.has(tag))) return null;
  const profileUrl = replaceTemplate(site.url, site);
  if (!profileUrl || !profileUrl.includes("{}") || !profileUrl.startsWith("https://") || /\{[^}]+\}/.test(profileUrl)) return null;
  const rawProbe = replaceTemplate(site.urlProbe, site);
  const probeUrl = rawProbe?.startsWith("https://") && rawProbe.includes("{}") && !/\{[^}]+\}/.test(rawProbe) ? rawProbe : null;
  const errorMessages = uniqueStrings(site.absenceStrs);
  const presenceMessages = uniqueStrings(site.presenseStrs);
  const errorUrl = replaceTemplate(site.errorUrl, site);
  const checkType = site.checkType || (errorMessages.length || presenceMessages.length ? "message" : "status_code");
  const detection = checkType === "message" ? "message" : (checkType === "response_url" && errorUrl ? "response_url" : "status_code");
  return {
    id: slug(name),
    name,
    category: categoryFor(tags),
    profileUrl,
    probeUrl,
    method: "GET",
    payload: null,
    detection,
    errorMessages,
    presenceMessages,
    errorCode: Number(site.errorCode) || 404,
    errorUrl: errorUrl || null,
    regex: typeof site.regexCheck === "string" ? site.regexCheck : null,
    priority: priorityFor(site, profileUrl, tags, "Maigret"),
    rank: Number.isFinite(Number(site.alexaRank)) ? Number(site.alexaRank) : null,
    region: regionFor(tags),
    tags,
    source: "Maigret"
  };
}

const core = JSON.parse(await readFile("data/platforms-core.json", "utf8"));
const response = await fetch(MAIGRET_DATA);
if (!response.ok) throw new Error(`Maigret catalogue returned HTTP ${response.status}`);
const maigret = await response.json();
const sites = core.sites.map(normalizeCore);
const keys = new Set(sites.map(site => canonical(site.profileUrl)));
const ids = new Set(sites.map(site => site.id));

for (const [name, raw] of Object.entries(maigret.sites || {})) {
  const site = normalizeMaigret(name, raw, maigret.engines || {});
  if (!site || keys.has(canonical(site.profileUrl))) continue;
  const baseId = site.id;
  let suffix = 2;
  while (ids.has(site.id)) site.id = `${baseId}-${suffix++}`;
  ids.add(site.id);
  keys.add(canonical(site.profileUrl));
  sites.push(site);
}

sites.sort((a, b) => a.priority - b.priority || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
const output = {
  version: 2,
  generatedAt: new Date().toISOString(),
  totalSites: sites.length,
  focusedSites: Math.min(600, sites.length),
  sources: [
    { name: "Sherlock Project", license: "MIT", url: "https://github.com/sherlock-project/sherlock" },
    { name: "Maigret", license: "MIT", url: "https://github.com/soxoj/maigret" }
  ],
  sites
};

await writeFile("data/platforms.json", `${JSON.stringify(output)}\n`);

const runtimeSites = sites.map(site => ({
  id: site.id, name: site.name, category: site.category, profileUrl: site.profileUrl,
  probeUrl: site.probeUrl, method: site.method, payload: site.payload,
  detection: site.detection, errorMessages: site.errorMessages,
  presenceMessages: site.presenceMessages, errorCode: site.errorCode,
  errorUrl: site.errorUrl, regex: site.regex, region: site.region
}));
const chunkSize = 300;
const chunks = [];
for (let index = 0; index < runtimeSites.length; index += chunkSize) {
  const number = chunks.length;
  chunks.push(number);
  await writeFile(`supabase/functions/alias-scan/catalogue-${number}.ts`, `// Generated by scripts/expand-catalogue.mjs.\nexport default ${JSON.stringify(runtimeSites.slice(index, index + chunkSize))} as readonly import(\"./catalogue.ts\").PlatformDefinition[];\n`);
}
for (let index = chunks.length; index < 20; index++) {
  await rm(`supabase/functions/alias-scan/catalogue-${index}.ts`, { force: true });
}
const imports = chunks.map(index => `import C${index} from \"./catalogue-${index}.ts\";`).join("\n");
const spreads = chunks.map(index => `...C${index}`).join(", ");
await writeFile("supabase/functions/alias-scan/catalogue.ts", `// Generated by scripts/expand-catalogue.mjs.\n${imports}\nexport interface PlatformDefinition { id: string; name: string; category: string; profileUrl: string; probeUrl: string | null; method: \"GET\" | \"POST\"; payload: unknown; detection: \"message\" | \"response_url\" | \"status_code\"; errorMessages: readonly string[]; presenceMessages: readonly string[]; errorCode: number; errorUrl: string | null; regex: string | null; region: string; }\nexport const FOCUSED_SITE_COUNT = ${output.focusedSites};\nexport const PLATFORMS: readonly PlatformDefinition[] = [${spreads}];\n`);
console.log(`Expanded catalogue: ${core.sites.length} core + ${sites.length - core.sites.length} additional = ${sites.length} sites (${output.focusedSites} focused).`);
