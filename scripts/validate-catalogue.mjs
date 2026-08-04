import { readFile } from "node:fs/promises";

const catalogue = JSON.parse(await readFile("data/platforms.json", "utf8"));
if (!Array.isArray(catalogue.sites) || catalogue.sites.length < 400) throw new Error("Catalogue must contain at least 400 platforms.");
const ids = new Set();
for (const site of catalogue.sites) {
  if (!site.id || ids.has(site.id)) throw new Error(`Duplicate or missing platform ID: ${site.id}`);
  if (!String(site.profileUrl).startsWith("https://")) throw new Error(`Non-HTTPS platform: ${site.name}`);
  if (site.profileUrl.includes("127.0.0.1") || site.profileUrl.includes("localhost")) throw new Error(`Unsafe platform: ${site.name}`);
  ids.add(site.id);
}
if (catalogue.meta.count !== catalogue.sites.length) throw new Error("Catalogue metadata count is stale.");
console.log(`Validated ${catalogue.sites.length} HTTPS platform definitions.`);
