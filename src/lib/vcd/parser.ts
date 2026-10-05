/**
 * Streaming VCD (IEEE 1364 value change dump) parser.
 *
 * Designed for untrusted, possibly huge files: input is consumed in chunks,
 * only the signals the caller asks for are stored, and hard caps stop
 * runaway memory use. Nothing is ever evaluated or rendered as HTML.
 */

export interface VcdSignalInfo {
  path: string; // scope.scope.name (bus range stripped)
  width: number;
  id: string;
}

export interface VcdChange {
  t: number; // in timescale units × timescale factor → femtoseconds
  v: string; // binary string, "x"/"u"/"z" allowed
}

export interface VcdData {
  timescaleFs: number;
  signals: VcdSignalInfo[];
  changes: Map<string, VcdChange[]>; // by path
  endTime: number;
  truncated: boolean;
}

export const MAX_VCD_BYTES = 512 * 1024 * 1024;
export const MAX_SIGNALS = 200_000;
export const MAX_CHANGES_PER_SIGNAL = 2_000_000;

const UNITS: Record<string, number> = { s: 1e15, ms: 1e12, us: 1e9, ns: 1e6, ps: 1e3, fs: 1 };

export class VcdError extends Error {}

export class VcdParser {
  private buf = "";
  private inHeader = true;
  private scope: string[] = [];
  private kw: string | null = null;
  private kwTokens: string[] = [];
  private idToPaths = new Map<string, string[]>();
  private wantedIds = new Map<string, string[]>();
  private time = 0;
  private timescaleFs = 1;
  private pendingValue: string | null = null;
  private truncated = false;
  readonly signals: VcdSignalInfo[] = [];
  readonly changes = new Map<string, VcdChange[]>();

  /**
   * @param select called once when the header is complete; return the paths to keep.
   */
  constructor(private select: (signals: VcdSignalInfo[]) => Set<string>) {}

  push(chunk: string) {
    const data = this.buf + chunk;
    // Keep a partial trailing token for the next chunk.
    let cut = data.length;
    while (cut > 0 && !/\s/.test(data[cut - 1])) cut--;
    this.buf = data.slice(cut);
    this.consume(data.slice(0, cut));
  }

  end(): VcdData {
    if (this.buf) this.consume(this.buf + " ");
    this.buf = "";
    if (this.inHeader) throw new VcdError("The file ended before $enddefinitions — is this a VCD file?");
    return {
      timescaleFs: this.timescaleFs,
      signals: this.signals,
      changes: this.changes,
      endTime: this.time,
      truncated: this.truncated,
    };
  }

  private consume(text: string) {
    const tokens = text.split(/\s+/);
    for (const tok of tokens) {
      if (!tok) continue;
      if (this.inHeader) this.header(tok);
      else this.body(tok);
    }
  }

  private header(tok: string) {
    if (this.kw) {
      if (tok === "$end") {
        this.finishKeyword();
        this.kw = null;
        this.kwTokens = [];
      } else {
        this.kwTokens.push(tok);
        if (this.kwTokens.length > 1000) throw new VcdError(`Malformed header near ${this.kw}.`);
      }
      return;
    }
    if (tok === "$enddefinitions") {
      this.kw = tok;
      return;
    }
    if (tok.startsWith("$")) {
      this.kw = tok;
      return;
    }
    throw new VcdError(`Unexpected token '${tok.slice(0, 40)}' in the VCD header.`);
  }

  private finishKeyword() {
    const t = this.kwTokens;
    switch (this.kw) {
      case "$timescale": {
        const m = /^(\d+)\s*(s|ms|us|ns|ps|fs)$/.exec(t.join(""));
        if (!m) throw new VcdError(`Unrecognised timescale '${t.join(" ")}'.`);
        this.timescaleFs = Number(m[1]) * UNITS[m[2]];
        break;
      }
      case "$scope":
        this.scope.push(t[1] ?? "?");
        break;
      case "$upscope":
        this.scope.pop();
        break;
      case "$var": {
        // $var type width id ref [range] $end
        if (t.length < 4) throw new VcdError("Malformed $var declaration.");
        const width = Number(t[1]);
        const id = t[2];
        const ref = t[3].replace(/\[.*$/, "");
        const path = [...this.scope, ref].join(".");
        if (this.signals.length >= MAX_SIGNALS) throw new VcdError(`More than ${MAX_SIGNALS} signals in the file.`);
        this.signals.push({ path, width: Number.isFinite(width) ? width : 1, id });
        const list = this.idToPaths.get(id);
        if (list) list.push(path);
        else this.idToPaths.set(id, [path]);
        break;
      }
      case "$enddefinitions": {
        this.inHeader = false;
        const keep = this.select(this.signals);
        for (const [id, paths] of this.idToPaths) {
          const kept = paths.filter((p) => keep.has(p));
          if (kept.length) this.wantedIds.set(id, kept);
        }
        for (const paths of this.wantedIds.values()) for (const p of paths) this.changes.set(p, []);
        break;
      }
      default:
        break; // $date, $version, $comment …
    }
  }

  private skipping = false;

  private body(tok: string) {
    if (this.skipping) {
      if (tok === "$end") this.skipping = false;
      return;
    }
    if (this.pendingValue !== null) {
      this.record(tok, this.pendingValue);
      this.pendingValue = null;
      return;
    }
    const c = tok[0];
    if (c === "#") {
      const t = Number(tok.slice(1));
      if (!Number.isFinite(t)) throw new VcdError(`Bad timestamp '${tok.slice(0, 40)}'.`);
      this.time = t * this.timescaleFs;
      return;
    }
    if (c === "$") {
      if (tok === "$comment") this.skipping = true;
      return; // $dumpvars, $dumpall, $end, …
    }
    if (c === "b" || c === "B" || c === "r" || c === "R") {
      this.pendingValue = tok.slice(1).toLowerCase();
      return;
    }
    if ("01xXzZuUwWlLhH-".includes(c)) {
      this.record(tok.slice(1), c.toLowerCase());
      return;
    }
    throw new VcdError(`Unexpected token '${tok.slice(0, 40)}' at time ${this.time}.`);
  }

  private record(id: string, value: string) {
    const paths = this.wantedIds.get(id);
    if (!paths) return;
    for (const p of paths) {
      const list = this.changes.get(p)!;
      const last = list[list.length - 1];
      if (last && last.t === this.time) {
        last.v = value; // several changes in one time step: keep the settled value
      } else if (list.length < MAX_CHANGES_PER_SIGNAL) {
        list.push({ t: this.time, v: value });
      } else {
        this.truncated = true;
      }
    }
  }
}

/** Convert a VCD vector value to a number; null if it contains X/U/Z bits. */
export function vcdToNumber(v: string): number | null {
  if (!/^[01]+$/.test(v)) {
    // Verilog-style left extension: "x" or "z" alone means all bits unknown.
    return null;
  }
  const s = v.length > 32 ? v.slice(-32) : v;
  return parseInt(s, 2) >>> 0;
}

/** Parse a whole File in the browser, chunk by chunk. `.vcd.gz` files are inflated on the fly. */
export async function parseVcdFile(
  file: Blob,
  select: (signals: VcdSignalInfo[]) => Set<string>,
  onProgress?: (fraction: number) => void,
  opts: { gzip?: boolean } = {},
): Promise<VcdData> {
  if (file.size > MAX_VCD_BYTES) {
    throw new VcdError(`The file is ${(file.size / 1e6).toFixed(0)} MB; the limit is ${MAX_VCD_BYTES / 1024 / 1024} MB. Dump fewer signals or a shorter run.`);
  }
  const parser = new VcdParser(select);
  // Count compressed bytes for progress, and inflated characters against the limit.
  let compressedRead = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      compressedRead += chunk.length;
      ctl.enqueue(chunk);
    },
  });
  let bytes: ReadableStream<Uint8Array> = file.stream().pipeThrough(counter);
  if (opts.gzip) bytes = bytes.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = (bytes as unknown as ReadableStream<BufferSource>).pipeThrough(new TextDecoderStream()).getReader();
  let inflated = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      inflated += value.length;
      if (inflated > MAX_VCD_BYTES) {
        throw new VcdError(`The waveform is larger than ${MAX_VCD_BYTES / 1024 / 1024} MB once unpacked. Dump fewer signals or a shorter run.`);
      }
      parser.push(value);
      onProgress?.(Math.min(1, compressedRead / Math.max(1, file.size)));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof VcdError) throw e;
    throw new VcdError(opts.gzip ? "The .gz file could not be unpacked. Is it a gzipped VCD?" : "The file could not be read as text.");
  }
  return parser.end();
}
