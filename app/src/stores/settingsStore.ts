// Mirror of the Rust-persisted Memex settings (~/Library/Application Support/
// dev.cmblir.memex/settings.json). Loaded once on app start; mutations write
// straight back to disk so every window reflects the latest state.

import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { MemexSettings } from "../lib/ipc";

interface SettingsState {
  settings: MemexSettings | null;
  loading: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<MemexSettings>) => Promise<void>;
  setProviderConnected: (
    key: keyof MemexSettings["providers"],
    on: boolean,
  ) => Promise<void>;
  /** Mirror the live ollama daemon state into the connection flag, so a
   * running daemon shows up in the model picker automatically and a stopped
   * one disappears. */
  syncOllama: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const s = await ipc.getSettings();
      set({ settings: s, loading: false });
      void get().syncOllama();
    } catch {
      set({ loading: false });
    }
  },
  update: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      await ipc.setSettings(next);
    } catch {
      /* swallow; UI already updated */
    }
  },
  setProviderConnected: async (key, on) => {
    const current = get().settings;
    if (!current) return;
    const next: MemexSettings = {
      ...current,
      providers: { ...current.providers, [key]: on },
    };
    set({ settings: next });
    try {
      await ipc.setSettings(next);
    } catch {
      /* swallow */
    }
  },

  syncOllama: async () => {
    const current = get().settings;
    if (!current) return;
    try {
      const st = await ipc.ollamaStatus();
      const on = st.daemon_running && st.models.length > 0;
      if (current.providers.ollama !== on) {
        await get().setProviderConnected("ollama", on);
      }
    } catch {
      /* daemon unreachable — leave the flag as-is */
    }
  },
}));
