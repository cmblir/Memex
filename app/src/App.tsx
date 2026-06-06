import { useEffect, useState } from "react";
import type { JSX } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import CommandBar from "./components/CommandBar";
import DialogHost from "./components/DialogHost";
import PageOverview from "./pages/PageOverview";
import PageIngest from "./pages/PageIngest";
import PageQuery from "./pages/PageQuery";
import PageGraph from "./pages/PageGraph";
import PageHistory from "./pages/PageHistory";
import PageProvenance from "./pages/PageProvenance";
import PageSettings from "./pages/PageSettings";
import PageReader from "./pages/PageReader";
import { STRINGS } from "./lib/i18n";
import { useUIStore } from "./stores/uiStore";
import { useSettingsStore } from "./stores/settingsStore";
import { getLastVaultPath, useVaultStore } from "./stores/vaultStore";
import { ipc } from "./lib/ipc";

// Matches the seeded accent in uiStore. While it's the active value we let the
// [data-theme] stylesheet own --accent instead of overriding it inline.
const DEFAULT_ACCENT = "#181715";

export default function App(): JSX.Element {
  const route = useUIStore((s) => s.route);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const lang = useUIStore((s) => s.lang);
  const theme = useUIStore((s) => s.theme);
  const density = useUIStore((s) => s.density);
  const accent = useUIStore((s) => s.accent);
  const toggleCmd = useUIStore((s) => s.toggleCmd);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const currentVault = useVaultStore((s) => s.currentVault);
  const openVault = useVaultStore((s) => s.openVault);
  const loadSettings = useSettingsStore((s) => s.load);

  const t = STRINGS[lang] ?? STRINGS.en;

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Track the OS colour scheme live so the "System" appearance option follows
  // light/dark changes at runtime (not just on app launch).
  const [sysDark, setSysDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setSysDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const effectiveTheme =
    theme === "system" ? (sysDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    const r = document.documentElement;
    if (density === "compact") {
      r.style.setProperty("--top-h", "40px");
      r.style.setProperty("--side-w", "240px");
      document.body.style.fontSize = "13px";
    } else if (density === "spacious") {
      r.style.setProperty("--top-h", "52px");
      r.style.setProperty("--side-w", "280px");
      document.body.style.fontSize = "15px";
    } else {
      r.style.setProperty("--top-h", "44px");
      r.style.setProperty("--side-w", "264px");
      document.body.style.fontSize = "14px";
    }
  }, [density]);

  useEffect(() => {
    const el = document.documentElement;
    // Only override the theme's --accent when the user actually picked a custom
    // accent. Otherwise the seeded default (#181715) would clobber the dark
    // theme's --accent and render accent-on-accent UI (e.g. the timelapse play
    // button) invisible.
    if (accent && accent.toLowerCase() !== DEFAULT_ACCENT) {
      el.style.setProperty("--accent", accent);
    } else {
      el.style.removeProperty("--accent");
    }
  }, [accent]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleCmd();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCmd, toggleSidebar]);

  // Auto-restore or create default vault on first mount.
  //
  // We always run ensureDefaultVault first — it's idempotent and seeds
  // the canonical ~/Documents/Memex scaffold. This repairs any missing
  // subdirectories or seed files (e.g. if the user manually deleted
  // raw/ from Finder).
  //
  // Then we open the user's last vault if any (which may be the default
  // OR an external folder like an existing Obsidian vault). If the
  // saved path no longer exists, fall through to the default so the
  // app is never stuck without a vault.
  useEffect(() => {
    if (currentVault) return;
    void (async () => {
      // Dev-only escape hatch — `?vault=/some/path` lets us point the
      // app at an arbitrary directory for quick visual testing.
      const urlVault = new URLSearchParams(window.location.search).get(
        "vault",
      );
      if (urlVault) {
        await openVault(urlVault);
        if (useVaultStore.getState().currentVault) return;
      }
      let defaultVault: string | null = null;
      try {
        defaultVault = await ipc.ensureDefaultVault();
      } catch {
        /* keep going — user may have a different vault saved */
      }
      const last = getLastVaultPath();
      if (last) {
        await openVault(last);
        if (useVaultStore.getState().currentVault) return;
      }
      if (defaultVault) {
        await openVault(defaultVault);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: JSX.Element;
  if (route === "overview") body = <PageOverview t={t} />;
  else if (route === "ingest") body = <PageIngest t={t} />;
  else if (route === "query") body = <PageQuery t={t} />;
  else if (route === "graph") body = <PageGraph t={t} />;
  else if (route === "history") body = <PageHistory t={t} />;
  else if (route === "provenance") body = <PageProvenance t={t} />;
  else if (route === "settings") body = <PageSettings t={t} />;
  else if (route.startsWith("page:"))
    body = <PageReader t={t} pageRoute={route.slice(5)} />;
  else body = <PageOverview t={t} />;

  return (
    <div className={"app" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
      <Sidebar t={t} />
      <main>
        <Topbar t={t} />
        {body}
      </main>
      <CommandBar t={t} />
      <DialogHost />
    </div>
  );
}
