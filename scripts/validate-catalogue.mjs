import { readFile } from "node:fs/promises";
import { isPrivateHost } from "../supabase/functions/alias-scan/url-safety.js";

const catalogue = JSON.parse(await readFile("data/platforms.json", "utf8"));
const edgeSource = await readFile("supabase/functions/alias-scan/index.ts", "utf8");
if (!Array.isArray(catalogue.sites) || catalogue.sites.length < 1_200) throw new Error("Catalogue must contain at least 1,200 platforms.");
const ids = new Set();
const russianDestination = /https:\/\/[^/?#]*\.(?:ru|su)(?:[/:?#]|$)/i;
for (const site of catalogue.sites) {
  if (site.tags?.some(tag => String(tag).toLowerCase() === "ru") || russianDestination.test([site.profileUrl, site.probeUrl, site.errorUrl].filter(Boolean).join(" "))) throw new Error(`Russian-focused platform leaked into catalogue: ${site.name}`);
  if (!site.id || ids.has(site.id)) throw new Error(`Duplicate or missing platform ID: ${site.id}`);
  if (!String(site.profileUrl).startsWith("https://")) throw new Error(`Non-HTTPS platform: ${site.name}`);
  if (!JSON.stringify(site).includes("{}")) throw new Error(`Missing alias placeholder: ${site.name}`);
  for (const template of [site.profileUrl, site.probeUrl].filter(Boolean)) {
    const url = new URL(String(template).replaceAll("{}", "catalogue-safety-check"));
    if (url.protocol !== "https:" || isPrivateHost(url.hostname)) throw new Error(`Unsafe platform: ${site.name}`);
  }
  if (![1, 2, 3, 4].includes(site.priority)) throw new Error(`Invalid priority: ${site.name}`);
  ids.add(site.id);
}
if (catalogue.totalSites !== catalogue.sites.length) throw new Error("Catalogue metadata count is stale.");
const requiredGamingIds = [
  "fortnitetracker", "battlefield-2042-tracker", "battlefield-v-tracker", "battlefield-1-tracker",
  "minecraft", "mcuuid", "halo-infinite-tracker", "rocket-league-tracker",
  "rainbow-six-siege-tracker", "cs2-tracker", "apexlegends", "faceit", "psnprofiles-com"
];
for (const id of requiredGamingIds) {
  const platform = catalogue.sites.find(site => site.id === id);
  if (!platform || platform.category !== "Gaming") throw new Error(`Required gaming platform is missing: ${id}`);
  if (!edgeSource.includes(`"${id}"`)) throw new Error(`Gaming platform is not prioritized by the Edge scanner: ${id}`);
}
if (!Number.isInteger(catalogue.focusedSites) || catalogue.focusedSites < 100 || catalogue.focusedSites > catalogue.sites.length) throw new Error("Focused catalogue count is invalid.");
for (const hostname of ["localhost", "api.localhost", "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "[fc00::1]", "[fe80::1]"]) {
  if (!isPrivateHost(hostname)) throw new Error(`Private host regression: ${hostname}`);
}
for (const hostname of ["fclmnews.ru", "fediverse.party", "fd.nl"]) {
  if (isPrivateHost(hostname)) throw new Error(`Public host rejected as private: ${hostname}`);
}
console.log(`Validated ${catalogue.sites.length} HTTPS platform definitions.`);
