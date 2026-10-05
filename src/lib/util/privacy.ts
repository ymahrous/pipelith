/** Client-side privacy controls for the optional Vercel analytics. */

import { migrateLegacyStorage } from "./storage";

export const ANALYTICS_OPT_OUT_KEY = "pipelith:analytics-opt-out";

/** True when the visitor asked not to be measured: Global Privacy Control, Do Not Track, or the opt-out switch. */
export function analyticsBlocked(): boolean {
  if (typeof window === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (nav.globalPrivacyControl === true) return true;
  const dnt = nav.doNotTrack ?? (window as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  if (dnt === "1" || dnt === "yes") return true;
  try {
    migrateLegacyStorage();
    return window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAnalyticsOptOut(out: boolean) {
  try {
    if (out) window.localStorage.setItem(ANALYTICS_OPT_OUT_KEY, "1");
    else window.localStorage.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

/**
 * Remove everything but origin + path. Share links keep the program in the
 * fragment (#s=…) and must never be reported anywhere.
 */
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return "";
  }
}
