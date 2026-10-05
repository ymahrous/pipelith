"use client";

import { createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CompareReport, SignalMapping } from "@/lib/compare/compare";
import { autoMap, compareTrace, mappedPaths } from "@/lib/compare/compare";
import { compareFinalValues, parseFinalValues, type FinalParse, type FinalReport } from "@/lib/compare/finalValues";
import { analyze, type Analysis } from "@/lib/session/analyze";
import { decodeShare, emptySession, loadStoredSession, storeSession, type Session } from "@/lib/session/session";
import type { VcdData, VcdSignalInfo } from "@/lib/vcd/parser";
import { parseVcdFile, VcdError } from "@/lib/vcd/parser";

export interface WaveState {
  blob: Blob | null;
  name: string;
  origin: "upload" | "sample";
  signals: VcdSignalInfo[];
  vcd: VcdData | null;
  mapping: SignalMapping | null;
  progress: number | null;
  error: string | null;
}

const emptyWave: WaveState = {
  blob: null,
  name: "",
  origin: "upload",
  signals: [],
  vcd: null,
  mapping: null,
  progress: null,
  error: null,
};

interface Ctx {
  ready: boolean;
  session: Session;
  update: (patch: Partial<Session> | ((s: Session) => Session)) => void;
  analysis: Analysis;
  wave: WaveState;
  /** `stages` overrides the depth used for signal auto-mapping (when the session is changing in the same tick). */
  loadWave: (blob: Blob, name: string, origin: WaveState["origin"], stages?: Session["stages"]) => Promise<void>;
  remap: (m: SignalMapping) => Promise<void>;
  clearWave: () => void;
  report: CompareReport | null;
  finalParse: FinalParse;
  finalReport: FinalReport | null;
  pendingShare: Session | null;
  acceptShare: () => void;
  dismissShare: () => void;
  toast: (msg: string) => void;
  /**
   * Files dropped on one page for another (quick start → Code review). Held in
   * memory for this tab only; the receiving page takes them once.
   */
  takeHandoff: () => File[] | null;
  setHandoff: (files: File[] | null) => void;
}

const SessionContext = createContext<Ctx | null>(null);

export function useWorkbench(): Ctx {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useWorkbench must be used inside <SessionProvider>");
  return c;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session>(emptySession);
  const [wave, setWave] = useState<WaveState>(emptyWave);
  const [pendingShare, setPendingShare] = useState<Session | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoff = useRef<File[] | null>(null);

  // Load from this browser, then look for a share link in the URL fragment —
  // on first load and whenever a link is pasted into an already-open tab.
  useEffect(() => {
    // Browser storage only exists after hydration, so the stored session is applied on mount.
    const stored = loadStoredSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after hydration
    if (stored) setSession(stored);
    setReady(true);
    let current = stored;
    const importFromHash = () => {
      const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(window.location.hash);
      if (!m && /[#&]s=/.test(window.location.hash)) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setToastMsg("That share link is damaged, so it was ignored.");
        return;
      }
      if (!m) return;
      decodeShare(m[1]).then((s) => {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        if (!s) {
          setToastMsg("That share link is damaged or too large, so it was ignored.");
          return;
        }
        // Never silently replace someone's work: ask when a program is already open.
        current = loadStoredSession() ?? current;
        if (!current || !current.source.trim()) setSession(s);
        else setPendingShare(s);
      });
    };
    importFromHash();
    window.addEventListener("hashchange", importFromHash);
    return () => window.removeEventListener("hashchange", importFromHash);
  }, []);

  // Remember the session in this browser: debounced while typing, flushed when the page is hidden or left.
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
    if (!ready) return;
    const t = setTimeout(() => storeSession(session), 300);
    return () => clearTimeout(t);
  }, [session, ready]);
  useEffect(() => {
    if (!ready) return;
    const flush = () => storeSession(latest.current);
    const onVis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready]);

  const update = useCallback((patch: Partial<Session> | ((s: Session) => Session)) => {
    setSession((s) => (typeof patch === "function" ? patch(s) : { ...s, ...patch }));
  }, []);

  // Deferred so typing in the editor stays responsive while the model re-runs.
  const deferredSession = useDeferredValue(session);
  const analysis = useMemo(() => analyze(deferredSession), [deferredSession]);

  const toast = useCallback((msg: string) => setToastMsg(msg), []);
  useEffect(() => {
    if (!toastMsg) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3600);
  }, [toastMsg]);

  const parse = useCallback(
    async (blob: Blob, name: string, origin: WaveState["origin"], mapping: SignalMapping | null, stages?: Session["stages"]) => {
      setWave((w) => ({ ...w, blob, name, origin, progress: 0, error: null }));
      try {
        let chosen: SignalMapping | null = mapping;
        let allSignals: VcdSignalInfo[] = [];
        const vcd = await parseVcdFile(
          blob,
          (signals) => {
            allSignals = signals;
            chosen ??= autoMap(signals, analysis.profile.hardware, stages ?? deferredSession.stages);
            return mappedPaths(chosen);
          },
          (p) => setWave((w) => ({ ...w, progress: p })),
          { gzip: /\.gz$/i.test(name) },
        );
        setWave({ blob, name, origin, signals: allSignals, vcd, mapping: chosen, progress: null, error: null });
      } catch (e) {
        const msg =
          e instanceof VcdError
            ? e.message
            : e instanceof Error
              ? `Could not read the file: ${e.message}`
              : "Could not read the file.";
        setWave({ ...emptyWave, name, error: msg });
      }
    },
    [analysis.profile.hardware, deferredSession.stages],
  );

  const loadWave = useCallback(
    (blob: Blob, name: string, origin: WaveState["origin"], stages?: Session["stages"]) => parse(blob, name, origin, null, stages),
    [parse],
  );
  const remap = useCallback(
    async (m: SignalMapping) => {
      if (wave.blob) await parse(wave.blob, wave.name, wave.origin, m);
    },
    [parse, wave.blob, wave.name, wave.origin],
  );
  const clearWave = useCallback(() => setWave(emptyWave), []);

  const report = useMemo(() => {
    if (!wave.vcd || !wave.mapping || !analysis.sim) return null;
    return compareTrace(analysis.sim, wave.vcd, wave.mapping, analysis.profile.registerCount, new Set(analysis.memory.keys()));
  }, [wave.vcd, wave.mapping, analysis]);

  const finalParse = useMemo(
    () => parseFinalValues(session.finalValues, analysis.profile.registerCount),
    [session.finalValues, analysis.profile.registerCount],
  );
  const finalReport = useMemo(
    () => (analysis.sim && finalParse.entries.length ? compareFinalValues(analysis.sim, finalParse.entries) : null),
    [analysis.sim, finalParse],
  );

  const value: Ctx = {
    ready,
    session,
    update,
    analysis,
    wave,
    loadWave,
    remap,
    clearWave,
    report,
    finalParse,
    finalReport,
    pendingShare,
    acceptShare: () => {
      if (pendingShare) setSession(pendingShare);
      setPendingShare(null);
      setWave(emptyWave);
    },
    dismissShare: () => setPendingShare(null),
    toast,
    takeHandoff: () => {
      const f = handoff.current;
      handoff.current = null;
      return f;
    },
    setHandoff: (files) => {
      handoff.current = files;
    },
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="visually-hidden">
        {toastMsg}
      </div>
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </SessionContext.Provider>
  );
}
