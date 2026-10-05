"use client";

import { useSyncExternalStore } from "react";
import { analyticsBlocked, setAnalyticsOptOut, ANALYTICS_OPT_OUT_KEY } from "@/lib/util/privacy";
import { migrateLegacyStorage } from "@/lib/util/storage";

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("pipelith-optout", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("pipelith-optout", cb);
  };
};
const readOptOut = () => {
  try {
    migrateLegacyStorage();
    return window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
};

/** Lets visitors turn the anonymous Vercel measurements off in this browser. */
export function AnalyticsOptOut() {
  const optedOut = useSyncExternalStore(subscribe, readOptOut, () => false);
  const signal = useSyncExternalStore(subscribe, () => analyticsBlocked() && !readOptOut(), () => false);
  return (
    <div className="panel stack stack--tight" role="group" aria-label="Analytics preference">
      <label className="check-row">
        <input
          type="checkbox"
          checked={optedOut || signal}
          disabled={signal}
          onChange={(e) => {
            setAnalyticsOptOut(e.target.checked);
            window.dispatchEvent(new Event("pipelith-optout"));
          }}
        />
        <span>
          <strong>Don&apos;t measure my visits in this browser</strong>
          <span className="muted xsmall"> — stops page-view and speed measurements from now on.</span>
        </span>
      </label>
      {signal && <p className="small">Your browser sends Do Not Track or Global Privacy Control, so nothing is measured already.</p>}
    </div>
  );
}
