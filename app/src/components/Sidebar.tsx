// Sidebar renders the vault file tree with right-click context menu and
// header actions for creating files and folders. Pure presentation: it reads
// from the stores and emits onSelect for leaf clicks.

import { useState } from "react";
import type { JSX, MouseEvent } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useUIStore } from "../stores/uiStore";
import { ipc } from "../lib/ipc";
import type { FileNode } from "../lib/ipc";

export interface SidebarProps {
  onSelect?: (path: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  target: FileNode | "vault";
}

export default function Sidebar({ onSelect }: SidebarProps): JSX.Element {
  const fileTree = useVaultStore((s) => s.fileTree);
  const currentVault = useVaultStore((s) => s.currentVault);
  const openVault = useVaultStore((s) => s.openVault);
  const [menu, setMenu] = useState<MenuState | null>(null);

  async function handleOpen() {
    const path = await ipc.pickDirectory();
    if (path) await openVault(path);
  }

  function showMenu(e: MouseEvent, target: FileNode | "vault") {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }

  return (
    <aside
      className="memex-sidebar"
      aria-label="Vault file tree"
      onClick={() => setMenu(null)}
    >
      <header className="memex-sidebar__header">
        <span
          className="memex-sidebar__title"
          onContextMenu={(e) => showMenu(e, "vault")}
        >
          {currentVault?.name ?? "No vault"}
        </span>
        <div className="memex-sidebar__actions">
          {currentVault ? (
            <NewFileButton parentDir={currentVault.path} />
          ) : null}
          {currentVault ? (
            <NewFolderButton parentDir={currentVault.path} />
          ) : null}
          <button
            type="button"
            className="memex-sidebar__open"
            onClick={() => void handleOpen()}
          >
            Open…
          </button>
        </div>
      </header>
      {fileTree.length === 0 ? (
        <p className="memex-sidebar__empty">Open a vault to see files.</p>
      ) : (
        <ul className="memex-sidebar__tree" role="tree">
          {fileTree.map((node) => (
            <NodeRow
              key={node.path}
              node={node}
              depth={0}
              onSelect={onSelect}
              onContextMenu={(e) => showMenu(e, node)}
            />
          ))}
        </ul>
      )}
      {menu ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}
    </aside>
  );
}

function NodeRow({
  node,
  depth,
  onSelect,
  onContextMenu,
}: {
  node: FileNode;
  depth: number;
  onSelect?: (path: string) => void;
  onContextMenu: (e: MouseEvent) => void;
}): JSX.Element {
  if (node.kind === "file") {
    return (
      <li role="treeitem" className="memex-sidebar__leaf">
        <button
          type="button"
          className="memex-sidebar__file"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onSelect?.(node.path)}
          onContextMenu={onContextMenu}
        >
          {node.name}
        </button>
      </li>
    );
  }
  return (
    <DirectoryRow
      node={node}
      depth={depth}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
    />
  );
}

function DirectoryRow({
  node,
  depth,
  onSelect,
  onContextMenu,
}: {
  node: Extract<FileNode, { kind: "directory" }>;
  depth: number;
  onSelect?: (path: string) => void;
  onContextMenu: (e: MouseEvent) => void;
}): JSX.Element {
  const expanded = useUIStore((s) => s.expandedFolders[node.path] ?? true);
  const toggle = useUIStore((s) => s.toggleFolder);

  return (
    <li
      role="treeitem"
      aria-expanded={expanded}
      className="memex-sidebar__group"
    >
      <button
        type="button"
        className="memex-sidebar__dir"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => toggle(node.path)}
        onContextMenu={onContextMenu}
      >
        <span className="memex-sidebar__chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        {node.name}
      </button>
      {expanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <NodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              onContextMenu={(e) => {
                e.stopPropagation();
                onContextMenu(e);
              }}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState;
  onClose: () => void;
}): JSX.Element {
  const currentVault = useVaultStore((s) => s.currentVault);
  const createFile = useVaultStore((s) => s.createFile);
  const createFolder = useVaultStore((s) => s.createFolder);
  const deletePath = useVaultStore((s) => s.deletePath);
  const renamePath = useVaultStore((s) => s.renamePath);

  function parentDir(): string {
    if (menu.target === "vault") return currentVault?.path ?? "";
    if (menu.target.kind === "directory") return menu.target.path;
    const parts = menu.target.path.split(/[\\/]/);
    parts.pop();
    return parts.join("/");
  }

  async function handleNewFile() {
    const name = window.prompt("New file name (e.g. note.md)", "untitled.md");
    if (!name) return;
    await createFile(parentDir(), name);
    onClose();
  }

  async function handleNewFolder() {
    const name = window.prompt("New folder name");
    if (!name) return;
    await createFolder(parentDir(), name);
    onClose();
  }

  async function handleRename() {
    if (menu.target === "vault") return;
    const oldName = menu.target.name;
    const newName = window.prompt("Rename to", oldName);
    if (!newName || newName === oldName) {
      onClose();
      return;
    }
    await renamePath(menu.target.path, newName);
    onClose();
  }

  async function handleDelete() {
    if (menu.target === "vault") return;
    const ok = window.confirm(
      `Delete "${menu.target.name}"? This cannot be undone.`,
    );
    if (!ok) {
      onClose();
      return;
    }
    await deletePath(menu.target.path);
    onClose();
  }

  return (
    <ul
      className="memex-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <li>
        <button type="button" onClick={() => void handleNewFile()}>
          New note
        </button>
      </li>
      <li>
        <button type="button" onClick={() => void handleNewFolder()}>
          New folder
        </button>
      </li>
      {menu.target !== "vault" ? (
        <>
          <li className="memex-menu__sep" />
          <li>
            <button type="button" onClick={() => void handleRename()}>
              Rename…
            </button>
          </li>
          <li>
            <button
              type="button"
              className="memex-menu__danger"
              onClick={() => void handleDelete()}
            >
              Delete
            </button>
          </li>
        </>
      ) : null}
    </ul>
  );
}

function NewFileButton({ parentDir }: { parentDir: string }): JSX.Element {
  const createFile = useVaultStore((s) => s.createFile);
  return (
    <button
      type="button"
      className="memex-sidebar__icon"
      title="New note"
      onClick={async () => {
        const name = window.prompt("New file name (e.g. note.md)", "untitled.md");
        if (name) await createFile(parentDir, name);
      }}
    >
      +
    </button>
  );
}

function NewFolderButton({ parentDir }: { parentDir: string }): JSX.Element {
  const createFolder = useVaultStore((s) => s.createFolder);
  return (
    <button
      type="button"
      className="memex-sidebar__icon"
      title="New folder"
      onClick={async () => {
        const name = window.prompt("New folder name");
        if (name) await createFolder(parentDir, name);
      }}
    >
      +/
    </button>
  );
}
