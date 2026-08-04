import { readFile } from "node:fs/promises";

const catalogue = JSON.parse(await readFile("data/platforms.json", "utf8"));
if (!Array.isArray(catalogue.sites) || catalogue.sites.length < 1_500) throw new Error("Catalogue must contain at least 1,500 platforms.");
const ids = new Set();
for (const site of catalogue.sites) {
  if (!site.id || ids.has(site.id)) throw new Error(`Duplicate or missing platform ID: ${site.id}`);
  if (!String(site.profileUrl).startsWith("https://")) throw new Error(`Non-HTTPS platform: ${site.name}`);
  if (!JSON.stringify(site).includes("{}")) throw new Error(`Missing alias placeholder: ${site.name}`);
  if (site.profileUrl.includes("127.0.0.1") || site.profileUrl.includes("localhost")) throw new Error(`Unsafe platform: ${site.name}`);
  if (![1, 2, 3, 4].includes(site.priority)) throw new Error(`Invalid priority: ${site.name}`);
  ids.add(site.id);
}
if (catalogue.totalSites !== catalogue.sites.length) throw new Error("Catalogue metadata count is stale.");
if (!Number.isInteger(catalogue.focusedSites) || catalogue.focusedSites < 100 || catalogue.focusedSites > catalogue.sites.length) throw new Error("Focused catalogue count is invalid.");
console.log(`Validated ${catalogue.sites.length} HTTPS platform definitions.`);
