// Generated from the Europe/Americas/global catalogue.
import C0 from "./catalogue-0.ts";
import C1 from "./catalogue-1.ts";
import C2 from "./catalogue-2.ts";
import C3 from "./catalogue-3.ts";
import C4 from "./catalogue-4.ts";
import C5 from "./catalogue-5.ts";
export interface PlatformDefinition { id: string; name: string; category: string; profileUrl: string; probeUrl: string | null; method: "GET" | "POST"; payload: unknown; detection: "message" | "response_url" | "status_code"; errorMessages: readonly string[]; presenceMessages: readonly string[]; errorCode: number; errorUrl: string | null; regex: string | null; region: string; }
export const FOCUSED_SITE_COUNT = 600;
const TRACKER_MARKERS = ["trn-profile-highlighted-content", "profile-header", "profile-segment"] as const;
const CURATED_GAMING: readonly PlatformDefinition[] = [
  { id: "battlefield-2042-tracker", name: "Battlefield 2042 Tracker", category: "Gaming", profileUrl: "https://tracker.gg/bf2042/profile/origin/{}/overview", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" },
  { id: "battlefield-v-tracker", name: "Battlefield V Tracker", category: "Gaming", profileUrl: "https://tracker.gg/bfv/profile/origin/{}", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" },
  { id: "battlefield-1-tracker", name: "Battlefield 1 Tracker", category: "Gaming", profileUrl: "https://tracker.gg/bf1/profile/origin/{}", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" },
  { id: "halo-infinite-tracker", name: "Halo Infinite Tracker", category: "Gaming", profileUrl: "https://halotracker.com/halo-infinite/profile/xbl/{}/overview", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" },
  { id: "rocket-league-tracker", name: "Rocket League Tracker", category: "Gaming", profileUrl: "https://rocketleague.tracker.network/rocket-league/profile/epic/{}/overview", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" },
  { id: "rainbow-six-siege-tracker", name: "Rainbow Six Siege Tracker", category: "Gaming", profileUrl: "https://r6.tracker.network/r6siege/profile/ubi/{}/overview", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" },
  { id: "cs2-tracker", name: "Counter-Strike 2 Tracker", category: "Gaming", profileUrl: "https://tracker.gg/cs2/profile/steam/{}/overview", probeUrl: null, method: "GET", payload: null, detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS, errorCode: 404, errorUrl: null, regex: null, region: "Global" }
];
const GAMING_OVERRIDES: Record<string, Partial<PlatformDefinition>> = {
  fortnitetracker: { name: "Fortnite Tracker", category: "Gaming", detection: "message", errorMessages: ["PLAYER NOT FOUND", "Profile Not Found"], presenceMessages: TRACKER_MARKERS },
  minecraft: { name: "Minecraft Java", category: "Gaming", profileUrl: "https://namemc.com/profile/{}", probeUrl: "https://api.mojang.com/users/profiles/minecraft/{}", regex: "^[A-Za-z0-9_]{3,16}$" },
  mcuuid: { name: "Minecraft PlayerDB", category: "Gaming", errorMessages: ["minecraft.api_failure", "minecraft.invalid_username", "No Minecraft user could be found"] },
  "psnprofiles-com": { name: "PlayStation Network", category: "Gaming" },
  runescape: { category: "Gaming" },
  "tetr-io": { category: "Gaming" }
};
const BASE_CATALOGUE: readonly PlatformDefinition[] = [...C0, ...C1, ...C2, ...C3, ...C4, ...C5];
export const PLATFORMS: readonly PlatformDefinition[] = [
  ...CURATED_GAMING,
  ...BASE_CATALOGUE.map(platform => GAMING_OVERRIDES[platform.id] ? { ...platform, ...GAMING_OVERRIDES[platform.id] } : platform)
];
