import { headers } from "next/headers";
import { DISPLAY_SCRIPT } from "@/lib/util/display";

/**
 * Applies the visitor's display preferences before the first paint (see
 * lib/util/display.ts). The script is a compile-time constant — nothing from
 * the request or the visitor is interpolated — and carries the CSP nonce.
 */
export async function DisplayScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      nonce={nonce}
      // eslint-disable-next-line react/no-danger -- constant script, no user input; see lib/util/display.ts
      dangerouslySetInnerHTML={{ __html: DISPLAY_SCRIPT }}
    />
  );
}
