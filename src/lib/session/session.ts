/**
 * Session: everything the user has entered. It lives in this browser only
 * (localStorage) and can be packed into a share link (#s=…). Anything read
 * back from storage or a link is untrusted, so it is validated field by field.
 */
import { migrateLegacyStorage } from "../util/storage";
import type { Check } from "../check/expectations";
import type { ModelOptions } from "../isa/profile";
import { DEFAULT_PROFILE, getProfile } from "../isa/risc6";
import type { InterruptSpec } from "../sim/simulator";
import { FULL_FORWARDING, type Depth, type ForwardingConfig } from "../pipeline/pipeline";
import { DEFAULT_MAX_STEPS, HARD_MAX_STEPS } from "../sim/simulator";
import { MAX_SOURCE_BYTES } from "../asm/assembler";
import { MAX_MEM_BYTES } from "../asm/memfile";

export interface Session {
  v: 1;
  profileId: string;
  name: string;
  sourceKind: "asm" | "mem";
  source: string;
  options: ModelOptions;
  /** User-entered IN values, keyed by hex address. Overrides values inferred from comments. */
  inputs: Record<string, number[]>;
  interrupts: InterruptSpec[];
  maxSteps: number;
  userChecks: Check[];
  disabledChecks: string[];
  tbCycles: number | null;
  rtlRoot: string;
  /** What the user wants to do; shapes the guidance shown in each step. */
  goal: Goal;
  /** Pipeline depth of the design under test. */
  stages: Depth;
  /** Which results the design forwards; drives timing, the verdict and the review's forwarding checks. */
  forwarding: ForwardingConfig;
  /** VHDL compile order found by Code review; the hardware kit uses it instead of the profile's list. */
  compileOrder: string[] | null;
  /** Final register values reported by the hardware, as typed or uploaded (R1=5, SP=FFE …). */
  finalValues: string;
}

export type Goal = "program" | "hardware" | "sample";
export const MAX_FINAL_VALUES_CHARS = 8_000;

export const STORAGE_KEY = "pipelith:session:v1";
export const MAX_SHARE_CHARS = 200_000;

export function emptySession(): Session {
  return {
    v: 1,
    profileId: DEFAULT_PROFILE.id,
    name: "Untitled program",
    sourceKind: "asm",
    source: "",
    options: { ...DEFAULT_PROFILE.defaultOptions },
    inputs: {},
    interrupts: [],
    maxSteps: DEFAULT_MAX_STEPS,
    userChecks: [],
    disabledChecks: [],
    tbCycles: null,
    rtlRoot: "src/rtl",
    goal: "hardware",
    stages: 6,
    forwarding: { ...FULL_FORWARDING },
    finalValues: "",
    compileOrder: null,
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const u32 = (x: unknown): number | null =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffffffff ? x : null;
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.length <= max ? x : null);

function validCheck(x: unknown): Check | null {
  if (!isObj(x)) return null;
  const kinds = ["reg", "sp", "mem", "flag", "flags-unchanged", "not-executed", "branch", "out"];
  if (typeof x.kind !== "string" || !kinds.includes(x.kind)) return null;
  const id = str(x.id, 64);
  if (!id) return null;
  const when = x.when === "end" ? "end" : "after-line";
  const line = u32(x.line) ?? 0;
  const value = x.value === "unchanged" ? "unchanged" : (u32(x.value) ?? undefined);
  const flag = x.flag === "Z" || x.flag === "N" || x.flag === "C" ? x.flag : undefined;
  const reg = u32(x.reg);
  return {
    id,
    line,
    when,
    kind: x.kind as Check["kind"],
    reg: reg !== null && reg < 8 ? reg : undefined,
    addr: u32(x.addr) ?? undefined,
    flag,
    value,
    taken: typeof x.taken === "boolean" ? x.taken : undefined,
    origin: "user",
    enabled: x.enabled !== false,
  };
}

/** Validate untrusted data into a Session; unknown or malformed fields fall back to defaults. */
export function parseSession(raw: unknown): Session | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const s = emptySession();
  const profileId = str(raw.profileId, 32);
  if (profileId && getProfile(profileId)) s.profileId = profileId;
  s.name = (str(raw.name, 120) ?? s.name).replace(/[\u0000-\u001f]/g, "");
  s.sourceKind = raw.sourceKind === "mem" ? "mem" : "asm";
  s.source = str(raw.source, Math.max(MAX_SOURCE_BYTES, MAX_MEM_BYTES)) ?? "";
  if (isObj(raw.options)) {
    const o = raw.options;
    s.options = {
      iaddSignExtend: o.iaddSignExtend === true,
      subCarry: o.subCarry === "borrow" ? "borrow" : "notBorrow",
      inUpdatesFlags: o.inUpdatesFlags === true,
      extIntPushesFlags: o.extIntPushesFlags === true,
    };
  }
  if (isObj(raw.inputs)) {
    for (const [k, v] of Object.entries(raw.inputs).slice(0, 4096)) {
      if (!/^[0-9A-F]{1,8}$/.test(k) || !Array.isArray(v)) continue;
      const vals = v.slice(0, 64).map(u32).filter((n): n is number => n !== null);
      s.inputs[k] = vals;
    }
  }
  if (Array.isArray(raw.interrupts)) {
    s.interrupts = raw.interrupts
      .slice(0, 32)
      .filter(isObj)
      .map((i) => ({ pc: u32(i.pc) ?? -1, occurrence: u32(i.occurrence) ?? 1 }))
      .filter((i) => i.pc >= 0 && i.occurrence >= 1);
  }
  const ms = u32(raw.maxSteps);
  if (ms) s.maxSteps = Math.min(Math.max(1, ms), HARD_MAX_STEPS);
  if (Array.isArray(raw.userChecks)) {
    s.userChecks = raw.userChecks.slice(0, 500).map(validCheck).filter((c): c is Check => c !== null);
  }
  if (Array.isArray(raw.disabledChecks)) {
    s.disabledChecks = raw.disabledChecks.slice(0, 5000).filter((x): x is string => typeof x === "string" && x.length <= 64);
  }
  const cyc = u32(raw.tbCycles);
  s.tbCycles = cyc && cyc <= 1_000_000 ? cyc : null;
  if (raw.goal === "program" || raw.goal === "hardware" || raw.goal === "sample") s.goal = raw.goal;
  s.finalValues = str(raw.finalValues, MAX_FINAL_VALUES_CHARS) ?? "";
  if (raw.stages === 5 || raw.stages === 6) s.stages = raw.stages;
  if (isObj(raw.forwarding)) {
    const f = raw.forwarding;
    const paths = Array.isArray(f.paths)
      ? f.paths.filter((x): x is string => typeof x === "string" && /^[A-Z0-9]{2,4}\/[A-Z0-9]{2,4}$/.test(x)).slice(0, 8)
      : "all";
    s.forwarding = { enabled: f.enabled !== false, paths, writeThrough: f.writeThrough !== false };
  }
  if (Array.isArray(raw.compileOrder)) {
    const files = raw.compileOrder
      .slice(0, 2000)
      .filter((f): f is string => typeof f === "string" && /^[A-Za-z0-9._/-]{1,256}$/.test(f) && !f.split("/").includes(".."));
    s.compileOrder = files.length ? files : null;
  }
  const root = str(raw.rtlRoot, 256);
  if (root && /^[A-Za-z0-9._/-]+$/.test(root) && !root.split("/").includes("..")) s.rtlRoot = root;
  return s;
}

/**
 * A new program in an existing session. Everything about the program resets;
 * settings that describe the design under test (and the model options) stay.
 */
export function withProgram(
  s: Session,
  p: { name: string; source: string; sourceKind?: Session["sourceKind"]; goal?: Goal },
): Session {
  return {
    ...emptySession(),
    profileId: s.profileId,
    options: s.options,
    maxSteps: s.maxSteps,
    goal: p.goal ?? s.goal,
    stages: s.stages,
    forwarding: s.forwarding,
    compileOrder: s.compileOrder,
    rtlRoot: s.rtlRoot,
    name: p.name,
    source: p.source,
    sourceKind: p.sourceKind ?? "asm",
  };
}

export function loadStoredSession(): Session | null {
  try {
    migrateLegacyStorage();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 4_000_000) return null;
    return parseSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function storeSession(s: Session) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private mode or quota: the session simply isn't remembered.
  }
}

/* ---------- share links ---------- */

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) throw new Error("Shared data is too large.");
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function encodeShare(s: Session): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ ...s, rtlRoot: undefined }));
  const packed = await pipe(json, new CompressionStream("deflate-raw"), 8_000_000);
  return toBase64Url(packed);
}

export async function decodeShare(token: string): Promise<Session | null> {
  if (!token || token.length > MAX_SHARE_CHARS || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    // Cap the inflated size so a tiny "zip bomb" link cannot exhaust memory.
    const raw = await pipe(fromBase64Url(token), new DecompressionStream("deflate-raw"), 4_000_000);
    return parseSession(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return null;
  }
}

export const addrKey = (a: number) => a.toString(16).toUpperCase();
