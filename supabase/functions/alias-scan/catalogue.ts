// Generated from the Europe/Americas/global catalogue.
import C0 from "./catalogue-0.ts";
import C1 from "./catalogue-1.ts";
import C2 from "./catalogue-2.ts";
import C3 from "./catalogue-3.ts";
import C4 from "./catalogue-4.ts";
import C5 from "./catalogue-5.ts";
export interface PlatformDefinition { id: string; name: string; category: string; profileUrl: string; probeUrl: string | null; method: "GET" | "POST"; payload: unknown; detection: "message" | "response_url" | "status_code"; errorMessages: readonly string[]; presenceMessages: readonly string[]; errorCode: number; errorUrl: string | null; regex: string | null; region: string; }
export const FOCUSED_SITE_COUNT = 600;
export const PLATFORMS: readonly PlatformDefinition[] = [...C0, ...C1, ...C2, ...C3, ...C4, ...C5];
