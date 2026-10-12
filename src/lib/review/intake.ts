/**
 * Codebase intake for Code review: a .zip, a picked folder, or loose files,
 * in VHDL, Verilog or SystemVerilog (or a mix).
 *
 * Everything is read in the browser. ZIP entries are inflated with the
 * platform's DecompressionStream and every size is capped, so a crafted
 * archive (zip bomb, path tricks, thousands of entries) cannot exhaust the tab.
 * Paths are only ever used as display labels.
 */

import { hdlOfPath } from "../hdl";

export interface SourceFile {
  path: string;
  text: string;
}

export interface IntakeResult {
  /** HDL sources: .vhd/.vhdl/.vho, .v/.vh, .sv/.svh. */
  files: SourceFile[];
  /** Files present but not reviewed (binaries, too large, encrypted). */
  skipped: { path: string; reason: string }[];
  /** Assembly test programs found alongside the RTL. */
  programs: SourceFile[];
  /** Names of other files in the upload (documents, scripts, images …), for the AI restructuring prompt. */
  ignored: string[];
}

export const REVIEW_LIMITS = {
  zipBytes: 50 * 1024 * 1024,
  entries: 5000,
  files: 1500,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 40 * 1024 * 1024,
};

export class IntakeError extends Error {}

const ASM = /\.(asm|s)$/i;
const IGNORE_DIRS = /(^|\/)(\.git|node_modules|__MACOSX|work|\.Xil|xsim\.dir|db|incremental_db|obj_dir|sim_build)\//i;

/** Normalise a path for display: forward slashes, no leading ./ or /, no .. segments. */
export function cleanPath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join("/")
    .slice(0, 300);
}

function classify(path: string): "hdl" | "asm" | "skip" {
  if (IGNORE_DIRS.test("/" + path)) return "skip";
  if (hdlOfPath(path)) return "hdl";
  if (ASM.test(path)) return "asm";
  return "skip";
}

function looksBinary(text: string) {
  return text.slice(0, 4096).includes("\u0000");
}

const MAX_IGNORED = 2000;

class Collector {
  out: IntakeResult = { files: [], skipped: [], programs: [], ignored: [] };
  total = 0;
  /** Note a file that isn't read, unless it is tool output or version control. */
  ignore(path: string) {
    if (path && !IGNORE_DIRS.test("/" + path) && this.out.ignored.length < MAX_IGNORED) this.out.ignored.push(path);
  }
  add(path: string, text: string) {
    const kind = classify(path);
    if (kind === "skip") return;
    if (looksBinary(text)) {
      this.out.skipped.push({ path, reason: "Not a text file" });
      return;
    }
    this.total += text.length;
    if (this.total > REVIEW_LIMITS.totalBytes) throw new IntakeError("The codebase is larger than 40 MB of source. Upload the RTL folder only.");
    if (kind === "asm") this.out.programs.push({ path, text });
    else {
      if (this.out.files.length >= REVIEW_LIMITS.files) throw new IntakeError(`More than ${REVIEW_LIMITS.files} HDL files. Upload the RTL folder only.`);
      this.out.files.push({ path, text });
    }
  }
  wants(path: string) {
    return classify(path) !== "skip";
  }
}

/** Loose files or a folder picked with <input webkitdirectory>. */
export async function readFileList(list: Iterable<File>): Promise<IntakeResult> {
  const c = new Collector();
  for (const f of list) {
    const path = cleanPath((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    if (/\.zip$/i.test(f.name)) {
      const inner = await readZip(f);
      for (const x of inner.files) c.add(x.path, x.text);
      for (const x of inner.programs) c.add(x.path, x.text);
      c.out.skipped.push(...inner.skipped);
      for (const x of inner.ignored) c.ignore(x);
      continue;
    }
    if (!c.wants(path)) {
      c.ignore(path);
      continue;
    }
    if (f.size > REVIEW_LIMITS.fileBytes) {
      c.out.skipped.push({ path, reason: "Larger than 2 MB" });
      continue;
    }
    c.add(path, await f.text());
  }
  return finish(c.out);
}

function finish(r: IntakeResult): IntakeResult {
  r.files.sort((a, b) => a.path.localeCompare(b.path));
  r.programs.sort((a, b) => a.path.localeCompare(b.path));
  r.ignored.sort((a, b) => a.localeCompare(b));
  return r;
}

/* ---------- ZIP ---------- */

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) {
      await reader.cancel().catch(() => {});
      throw new IntakeError("too-large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (const ch of chunks) {
    out.set(ch, p);
    p += ch.length;
  }
  return out;
}

export async function readZip(blob: Blob): Promise<IntakeResult> {
  if (blob.size > REVIEW_LIMITS.zipBytes) throw new IntakeError("The .zip is larger than 50 MB. Zip the RTL folder only.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: last 22..65557 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new IntakeError("This is not a .zip file, or it is damaged.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count > REVIEW_LIMITS.entries) throw new IntakeError(`The .zip has more than ${REVIEW_LIMITS.entries} entries.`);
  const c = new Collector();
  const dec = new TextDecoder("utf-8", { fatal: false });
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || view.getUint32(p, true) !== 0x02014b50) throw new IntakeError("The .zip's file list is damaged.");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true);
    const xlen = view.getUint16(p + 30, true);
    const clen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const rawName = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const path = cleanPath(rawName);
    if (!path || rawName.endsWith("/")) continue;
    if (!c.wants(path)) {
      c.ignore(path);
      continue;
    }
    if (flags & 1) {
      c.out.skipped.push({ path, reason: "Encrypted" });
      continue;
    }
    if (usize > REVIEW_LIMITS.fileBytes || csize > REVIEW_LIMITS.zipBytes) {
      c.out.skipped.push({ path, reason: "Larger than 2 MB" });
      continue;
    }
    if (local + 30 > buf.length || view.getUint32(local, true) !== 0x04034b50) throw new IntakeError("The .zip is damaged.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buf.subarray(start, start + csize);
    let bytes: Uint8Array;
    if (method === 0) bytes = data;
    else if (method === 8) {
      try {
        bytes = await inflateRaw(data, REVIEW_LIMITS.fileBytes);
      } catch (e) {
        c.out.skipped.push({ path, reason: e instanceof IntakeError ? "Larger than 2 MB when unpacked" : "Could not be unpacked" });
        continue;
      }
    } else {
      c.out.skipped.push({ path, reason: `Unsupported compression method ${method}` });
      continue;
    }
    c.add(path, dec.decode(bytes));
  }
  return finish(c.out);
}

/** Drop a common leading folder ("project-main/src/rtl/x.vhd" → "src/rtl/x.vhd" when all share it). */
export function stripCommonRoot(files: SourceFile[]): SourceFile[] {
  if (files.length < 2) return files;
  const first = files[0].path.split("/");
  let k = 0;
  while (k < first.length - 1 && files.every((f) => f.path.split("/")[k] === first[k])) k++;
  return k ? files.map((f) => ({ ...f, path: f.path.split("/").slice(k).join("/") })) : files;
}
