import { readFile } from "node:fs/promises";
import { CLAIM_PLATFORMS } from "../claim-platforms.js";
import { isPrivateHost } from "../supabase/functions/alias-scan/url-safety.js";

const catalogue = JSON.parse(await readFile("data/platforms.json", "utf8"));
const claimServerSource = await readFile("supabase/functions/alias-scan/claim-platform-ids.ts", "utf8");
if (!Array.isArray(catalogue.sites) || catalogue.sites.length < 1_500) throw new Error("Catalogue must contain at least 1,500 platforms.");
const ids = new Set();
for (const site of catalogue.sites) {
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
if (!Number.isInteger(catalogue.focusedSites) || catalogue.focusedSites < 100 || catalogue.focusedSites > catalogue.sites.length) throw new Error("Focused catalogue count is invalid.");
if (CLAIM_PLATFORMS.length < 40 || CLAIM_PLATFORMS.length > 100) throw new Error("Username Sniper must expose 40 to 100 curated platforms.");
const claimIds = new Set();
for (const platform of CLAIM_PLATFORMS) {
  if (!ids.has(platform.id) || claimIds.has(platform.id)) throw new Error(`Invalid claim platform: ${platform.id}`);
  if (!String(platform.claimUrl).startsWith("https://")) throw new Error(`Unsafe claim URL: ${platform.name}`);
  claimIds.add(platform.id);
}
const serverClaimIds = [...claimServerSource.matchAll(/"([a-z0-9-]+)"/g)].map(match => match[1]);
if (serverClaimIds.length !== claimIds.size || serverClaimIds.some(id => !claimIds.has(id))) throw new Error("Browser and Edge claim platform allowlists differ.");
for (const hostname of ["localhost", "api.localhost", "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "[fc00::1]", "[fe80::1]"]) {
  if (!isPrivateHost(hostname)) throw new Error(`Private host regression: ${hostname}`);
}
for (const hostname of ["fclmnews.ru", "fediverse.party", "fd.nl"]) {
  if (isPrivateHost(hostname)) throw new Error(`Public host rejected as private: ${hostname}`);
}
console.log(`Validated ${catalogue.sites.length} HTTPS platform definitions.`);
