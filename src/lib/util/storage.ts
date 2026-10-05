/**
 * localStorage keys from before the rename to Pipelith ("processor-workbench:…").
 * They are moved to the new keys once, so returning visitors keep their work
 * and their analytics opt-out.
 */
export const LEGACY_STORAGE_KEYS: ReadonlyArray<readonly [from: string, to: string]> = [
  ["processor-workbench:session:v1", "pipelith:session:v1"],
  ["processor-workbench:analytics-opt-out", "pipelith:analytics-opt-out"],
];

let migrated = false;

export function migrateLegacyStorage(storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage) {
  if (migrated || !storage) return;
  migrated = true;
  for (const [from, to] of LEGACY_STORAGE_KEYS) {
    try {
      const old = storage.getItem(from);
      if (old === null) continue;
      if (storage.getItem(to) === null) storage.setItem(to, old);
      storage.removeItem(from);
    } catch {
      /* storage unavailable or full: leave the old key alone */
    }
  }
}

/** Test hook: allow the migration to run again. */
export function resetLegacyMigrationForTests() {
  migrated = false;
}
