// Vault store. Single source of truth for the currently opened vault, file
// tree, and active file. The store mediates all Tauri IPC for vault data.

import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Adjacency, FileContent, FileNode, VaultMeta } from "../lib/ipc";

const LAST_VAULT_KEY = "memex.lastVaultPath";

export interface VaultState {
  currentVault: VaultMeta | null;
  fileTree: FileNode[];
  activeFile: FileContent | null;
  adjacency: Adjacency | null;
  isLoading: boolean;
  error: string | null;
  openVault: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<void>;
  refreshLinkGraph: () => Promise<void>;
  refreshTree: () => Promise<void>;
  createFile: (parentDir: string, name: string) => Promise<string | null>;
  createFolder: (parentDir: string, name: string) => Promise<string | null>;
  deletePath: (path: string) => Promise<void>;
  renamePath: (from: string, toName: string) => Promise<string | null>;
  resolveWikilink: (target: string) => string | null;
  reset: () => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  currentVault: null,
  fileTree: [],
  activeFile: null,
  adjacency: null,
  isLoading: false,
  error: null,

  async openVault(path) {
    set({ isLoading: true, error: null });
    try {
      const meta = await ipc.openVault(path);
      const tree = await ipc.listFiles(meta.path);
      const adjacency = await ipc.buildLinkGraph(meta.path);
      set({
        currentVault: meta,
        fileTree: tree,
        adjacency,
        activeFile: null,
        isLoading: false,
      });
      try {
        localStorage.setItem(LAST_VAULT_KEY, meta.path);
      } catch {
        /* localStorage unavailable */
      }
    } catch (err) {
      set({ error: errorMessage(err), isLoading: false });
    }
  },

  async refreshLinkGraph() {
    const vault = get().currentVault;
    if (!vault) return;
    try {
      const adjacency = await ipc.buildLinkGraph(vault.path);
      set({ adjacency });
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  async openFile(path) {
    set({ isLoading: true, error: null });
    try {
      const file = await ipc.readFile(path);
      set({ activeFile: file, isLoading: false });
    } catch (err) {
      set({ error: errorMessage(err), isLoading: false });
    }
  },

  async saveFile(path, content) {
    try {
      await ipc.writeFile(path, content);
      set((state) =>
        state.activeFile?.path === path
          ? { activeFile: { ...state.activeFile, content }, error: null }
          : { error: null },
      );
      void get().refreshLinkGraph();
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  async refreshTree() {
    const vault = get().currentVault;
    if (!vault) return;
    try {
      const tree = await ipc.listFiles(vault.path);
      set({ fileTree: tree });
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  async createFile(parentDir, name) {
    try {
      const path = await ipc.createFile(parentDir, name);
      await get().refreshTree();
      void get().refreshLinkGraph();
      return path;
    } catch (err) {
      set({ error: errorMessage(err) });
      return null;
    }
  },

  async createFolder(parentDir, name) {
    try {
      const path = await ipc.createFolder(parentDir, name);
      await get().refreshTree();
      return path;
    } catch (err) {
      set({ error: errorMessage(err) });
      return null;
    }
  },

  async deletePath(path) {
    try {
      await ipc.deletePath(path);
      const active = get().activeFile;
      if (active && (active.path === path || active.path.startsWith(`${path}/`))) {
        set({ activeFile: null });
      }
      await get().refreshTree();
      void get().refreshLinkGraph();
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },

  async renamePath(from, toName) {
    try {
      const newPath = await ipc.renamePath(from, toName);
      const active = get().activeFile;
      if (active?.path === from) {
        set({ activeFile: { ...active, path: newPath } });
      }
      await get().refreshTree();
      void get().refreshLinkGraph();
      return newPath;
    } catch (err) {
      set({ error: errorMessage(err) });
      return null;
    }
  },

  resolveWikilink(target) {
    return findFileByStem(get().fileTree, target.toLowerCase());
  },

  reset() {
    set({
      currentVault: null,
      fileTree: [],
      activeFile: null,
      adjacency: null,
      isLoading: false,
      error: null,
    });
  },
}));

export function getLastVaultPath(): string | null {
  try {
    return localStorage.getItem(LAST_VAULT_KEY);
  } catch {
    return null;
  }
}

function findFileByStem(nodes: FileNode[], lowerStem: string): string | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      const stem = stripExtension(node.name).toLowerCase();
      if (stem === lowerStem) return node.path;
    } else {
      const found = findFileByStem(node.children, lowerStem);
      if (found) return found;
    }
  }
  return null;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}
