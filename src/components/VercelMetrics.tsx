"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { analyticsBlocked, scrubUrl } from "@/lib/util/privacy";

/**
 * Vercel Web Analytics + Speed Insights, privacy-first:
 * cookieless, URLs reduced to origin + path, and nothing is sent when the
 * visitor has Do Not Track / Global Privacy Control on or opted out.
 */
export function VercelMetrics() {
  return (
    <>
      <Analytics
        beforeSend={(event) => {
          if (analyticsBlocked()) return null;
          const url = scrubUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
      <SpeedInsights
        beforeSend={(event) => {
          if (analyticsBlocked()) return null;
          const url = scrubUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
    </>
  );
}
