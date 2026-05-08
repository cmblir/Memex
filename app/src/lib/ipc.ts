// Type-safe wrappers around Tauri invoke calls. Keep this file thin: it must
// reflect the Rust command signatures in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface VaultMeta {
  path: string;
  name: string;
}

export type FileNode =
  | { kind: "file"; name: string; path: string }
  | {
      kind: "directory";
      name: string;
      path: string;
      children: FileNode[];
    };

export interface FileContent {
  path: string;
  content: string;
  frontmatter: unknown;
}

export interface Adjacency {
  forward: Record<string, string[]>;
  backward: Record<string, string[]>;
  unresolved: Record<string, string[]>;
  tags: Record<string, string[]>;
}

export const ipc = {
  openVault: (path: string) => invoke<VaultMeta>("open_vault", { path }),
  listFiles: (root: string) => invoke<FileNode[]>("list_files", { root }),
  readFile: (path: string) => invoke<FileContent>("read_file", { path }),
  writeFile: (path: string, content: string) =>
    invoke<null>("write_file", { path, content }),
  parseLinks: (path: string) => invoke<string[]>("parse_links", { path }),
  buildLinkGraph: (root: string) =>
    invoke<Adjacency>("build_link_graph", { root }),
  createFile: (parent: string, name: string) =>
    invoke<string>("create_file", { parent, name }),
  createFolder: (parent: string, name: string) =>
    invoke<string>("create_folder", { parent, name }),
  deletePath: (path: string) => invoke<null>("delete_path", { path }),
  renamePath: (from: string, toName: string) =>
    invoke<string>("rename_path", { from, toName }),
  pickDirectory: async (): Promise<string | null> => {
    const selection = await open({ directory: true, multiple: false });
    return typeof selection === "string" ? selection : null;
  },
};
