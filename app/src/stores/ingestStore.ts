// Ingest workflow state lifted out of PageIngest so the success banner
// (and any in-flight run) survives navigating to another page and back.
//
// PageIngest is otherwise stateless wrt the run itself; form drafts
// (title/body) still live on the page so unrelated typing in another
// tab does not bleed back here.

import { create } from "zustand";

export type IngestStage =
  | "idle"
  | "writing-raw"
  | "claude"
  | "indexing"
  | "done"
  | "error";

interface IngestState {
  stage: IngestStage;
  log: string;
  startedAt: number | null;
  finishedAt: number | null;
  reportPath: string | null;
  vaultPath: string | null;
  setStage: (stage: IngestStage) => void;
  setLog: (next: string | ((prev: string) => string)) => void;
  setStartedAt: (t: number | null) => void;
  setFinishedAt: (t: number | null) => void;
  setReportPath: (p: string | null) => void;
  setVaultPath: (p: string | null) => void;
  reset: () => void;
}

export const useIngestStore = create<IngestState>((set) => ({
  stage: "idle",
  log: "",
  startedAt: null,
  finishedAt: null,
  reportPath: null,
  vaultPath: null,
  setStage: (stage) => set({ stage }),
  setLog: (next) =>
    set((s) => ({ log: typeof next === "function" ? next(s.log) : next })),
  setStartedAt: (startedAt) => set({ startedAt }),
  setFinishedAt: (finishedAt) => set({ finishedAt }),
  setReportPath: (reportPath) => set({ reportPath }),
  setVaultPath: (vaultPath) => set({ vaultPath }),
  reset: () =>
    set({
      stage: "idle",
      log: "",
      startedAt: null,
      finishedAt: null,
      reportPath: null,
    }),
}));
