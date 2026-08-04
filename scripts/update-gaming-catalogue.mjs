import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../data/platforms.json", import.meta.url);
const catalogue = JSON.parse(await readFile(path, "utf8"));
const trackerMarkers = ["trn-profile-highlighted-content", "profile-header", "profile-segment"];
const tracker = (id, name, profileUrl) => ({
  id, name, category: "Gaming", profileUrl, probeUrl: null, method: "GET", payload: null,
  detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"],
  presenceMessages: trackerMarkers, errorCode: 404, errorUrl: null, regex: null,
  priority: 1, rank: null, region: "Global", tags: ["gaming", "major-game"], source: "Marfeyx curated"
});
const additions = [
  tracker("battlefield-2042-tracker", "Battlefield 2042 Tracker", "https://tracker.gg/bf2042/profile/origin/{}/overview"),
  tracker("battlefield-v-tracker", "Battlefield V Tracker", "https://tracker.gg/bfv/profile/origin/{}"),
  tracker("battlefield-1-tracker", "Battlefield 1 Tracker", "https://tracker.gg/bf1/profile/origin/{}"),
  tracker("halo-infinite-tracker", "Halo Infinite Tracker", "https://halotracker.com/halo-infinite/profile/xbl/{}/overview"),
  tracker("rocket-league-tracker", "Rocket League Tracker", "https://rocketleague.tracker.network/rocket-league/profile/epic/{}/overview"),
  tracker("rainbow-six-siege-tracker", "Rainbow Six Siege Tracker", "https://r6.tracker.network/r6siege/profile/ubi/{}/overview"),
  tracker("cs2-tracker", "Counter-Strike 2 Tracker", "https://tracker.gg/cs2/profile/steam/{}/overview")
];
const upgrades = {
  fortnitetracker: { name: "Fortnite Tracker", category: "Gaming", detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: trackerMarkers, priority: 1, tags: ["gaming", "major-game"] },
  minecraft: { name: "Minecraft Java", category: "Gaming", profileUrl: "https://namemc.com/profile/{}", probeUrl: "https://api.mojang.com/users/profiles/minecraft/{}", regex: "^[A-Za-z0-9_]{3,16}$", priority: 1, tags: ["gaming", "major-game"] },
  mcuuid: { name: "Minecraft PlayerDB", category: "Gaming", errorMessages: ["minecraft.api_failure", "minecraft.invalid_username", "No Minecraft user could be found"], priority: 1, tags: ["gaming", "major-game"] },
  apexlegends: { name: "Apex Legends Tracker", priority: 1, tags: ["gaming", "major-game"] },
  faceit: { name: "FACEIT / Counter-Strike", priority: 1, tags: ["gaming", "major-game"] },
  "psnprofiles-com": { name: "PlayStation Network", category: "Gaming", priority: 1, tags: ["gaming", "major-game"] },
  "op-gg-pubg": { name: "PUBG", priority: 1, tags: ["gaming", "major-game"] },
  "op-gg-valorant": { name: "Valorant", priority: 1, tags: ["gaming", "major-game"] },
  runescape: { category: "Gaming", priority: 1, tags: ["gaming", "major-game"] },
  osu: { priority: 1, tags: ["gaming", "major-game"] },
  "tetr-io": { category: "Gaming", priority: 1, tags: ["gaming", "major-game"] }
};

const sites = catalogue.sites.filter(site => !additions.some(addition => addition.id === site.id));
for (const site of sites) if (upgrades[site.id]) Object.assign(site, upgrades[site.id]);
const insertAt = Math.max(0, sites.findIndex(site => site.category === "Gaming"));
sites.splice(insertAt, 0, ...additions);
catalogue.sites = sites;
catalogue.totalSites = sites.length;
catalogue.generatedAt = new Date().toISOString();
await writeFile(path, `${JSON.stringify(catalogue)}\n`);
console.log(`Updated gaming catalogue: ${additions.length} new definitions, ${sites.length} total.`);
