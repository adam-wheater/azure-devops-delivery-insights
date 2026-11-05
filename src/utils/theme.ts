import * as React from "react";

/**
 * Theme for the Azure DevOps extension family.
 *
 * The visual system lives in src/styles/app.css as CSS custom properties
 * (`--ax-*`). This module:
 *
 *   1. Works out which palette is active and stamps `data-theme="light|dark"`
 *      (and `data-contrast="high"` when applicable) on the root element so the
 *      stylesheet switches.
 *   2. Exposes the same palette as a JavaScript object (`ThemeColors`) for the
 *      places that still set colours inline (SVG charts, dynamic styles). Every
 *      value mirrors a token in app.css — change both together. All pairs are
 *      audited for WCAG AA (4.5:1 text, 3:1 UI) in both palettes.
 *
 * How the host theme reaches us: azure-devops-extension-sdk's `init()` receives
 * the user's current Azure DevOps theme (Light, Dark, High Contrast …) as a map
 * of CSS variables, writes them onto `:root` (`--background-color`,
 * `--text-primary-color`, `--communication-foreground`, …) and dispatches a
 * `themeApplied` window event — again on every later change. That is the
 * signal we follow. The host page's `dark-theme` body class never reaches the
 * extension iframe, so it is only a fallback for tests and dev harnesses.
 *
 * Resolution order:
 *   1. High contrast (host HC theme or OS forced colours) always wins.
 *   2. Explicit user choice (persisted in localStorage under THEME_STORAGE_KEY).
 *   3. "ado" (default): the Azure DevOps theme from the SDK variables.
 *   4. Outside a host: body class, then the OS `prefers-color-scheme`.
 */

/** "ado" follows the user's Azure DevOps theme. "system" is accepted as a legacy alias. */
export type ThemeMode = "ado" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** Per-extension storage key; replace the placeholder with the extension id. */
export const THEME_STORAGE_KEY = "delivery-insights.theme";

export interface ThemeColors {
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentContrast: string;
  /** Filled primary controls: deep blue behind white text in both themes. */
  primary: string;
  primaryStrong: string;
  primaryFg: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textVeryMuted: string;

  bgPage: string;
  bgSurface: string;
  bgSurfaceAlt: string;
  bgProgressTrack: string;

  borderDefault: string;
  /** Borders of interactive controls — clears 3:1 against surfaces. */
  borderInput: string;
  borderRow: string;

  errorBg: string;
  errorText: string;
  successBg: string;
  successText: string;
  warningBg: string;
  warningBorder: string;
  warningText: string;
  infoBg: string;
  infoText: string;
  cleanBg: string;
  cleanBorder: string;

  statGreen: string;
  keyVaultBg: string;
  keyVaultText: string;
  disabledBg: string;
  btnDefaultBg: string;
  btnCancelBg: string;

  /** Categorical palette for charts (series 1..6), each ≥ 3:1 on bgSurface. */
  chart: string[];
}

export const lightTheme: ThemeColors = {
  accent: "#0b6bcb",
  accentStrong: "#0a58a8",
  accentSoft: "rgba(11, 107, 203, 0.09)",
  accentContrast: "#ffffff",
  primary: "#0b6bcb",
  primaryStrong: "#0a58a8",
  primaryFg: "#ffffff",

  textPrimary: "#101623",
  textSecondary: "#414c5e",
  textMuted: "#5a6577",
  textVeryMuted: "#5f6979",

  bgPage: "#f6f7fb",
  bgSurface: "#ffffff",
  bgSurfaceAlt: "#f2f4f8",
  bgProgressTrack: "#e9edf3",

  borderDefault: "#dfe4ec",
  borderInput: "#858e9d",
  borderRow: "#eaeef4",

  errorBg: "rgba(192, 41, 59, 0.1)",
  errorText: "#c0293b",
  successBg: "rgba(21, 111, 54, 0.09)",
  successText: "#156f36",
  warningBg: "rgba(143, 79, 0, 0.1)",
  warningBorder: "#8f4f00",
  warningText: "#8f4f00",
  infoBg: "rgba(11, 107, 203, 0.1)",
  infoText: "#0b6bcb",
  cleanBg: "rgba(21, 111, 54, 0.09)",
  cleanBorder: "#156f36",

  statGreen: "#156f36",
  keyVaultBg: "rgba(11, 107, 203, 0.1)",
  keyVaultText: "#0b6bcb",
  disabledBg: "#e9edf3",
  btnDefaultBg: "#ffffff",
  btnCancelBg: "#f2f4f8",

  chart: ["#0b6bcb", "#156f36", "#8f4f00", "#c0293b", "#6b4fbb", "#0f7a8a"],
};

export const darkTheme: ThemeColors = {
  accent: "#4c9bf0",
  accentStrong: "#6fb1f5",
  accentSoft: "rgba(76, 155, 240, 0.11)",
  accentContrast: "#06121f",
  primary: "#0b6bcb",
  primaryStrong: "#1372d6",
  primaryFg: "#ffffff",

  textPrimary: "#eef1f6",
  textSecondary: "#b9c2d0",
  textMuted: "#a3adbc",
  textVeryMuted: "#98a2b3",

  bgPage: "#14181f",
  bgSurface: "#1b202a",
  bgSurfaceAlt: "#212734",
  bgProgressTrack: "#29303f",

  borderDefault: "#2e3644",
  borderInput: "#6f7a8b",
  borderRow: "#262d3a",

  errorBg: "rgba(255, 139, 139, 0.14)",
  errorText: "#ff8b8b",
  successBg: "rgba(86, 211, 138, 0.14)",
  successText: "#56d38a",
  warningBg: "rgba(240, 180, 94, 0.15)",
  warningBorder: "#f0b45e",
  warningText: "#f0b45e",
  infoBg: "rgba(111, 177, 245, 0.14)",
  infoText: "#6fb1f5",
  cleanBg: "rgba(86, 211, 138, 0.14)",
  cleanBorder: "#56d38a",

  statGreen: "#56d38a",
  keyVaultBg: "rgba(111, 177, 245, 0.14)",
  keyVaultText: "#6fb1f5",
  disabledBg: "#29303f",
  btnDefaultBg: "#1b202a",
  btnCancelBg: "#212734",

  chart: ["#4c9bf0", "#56d38a", "#f0b45e", "#ff8b8b", "#b39df5", "#5fc8d8"],
};

/* ── Host theme detection ────────────────────────────────────────────────── */

interface HostTheme {
  /** True when the SDK has stamped host theme variables on :root. */
  present: boolean;
  resolved: ResolvedTheme;
  highContrast: boolean;
  /** Raw host colours, used to build the high-contrast JS palette. */
  background: string;
  text: string;
  textSecondary: string;
  link: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

function parseColor(value: string): [number, number, number, number] | null {
  const v = value.trim();
  let m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  m = v.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.%]+))?\s*\)$/i);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
    return [+m[1], +m[2], +m[3], a];
  }
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function readVar(name: string): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isPure(rgba: [number, number, number, number] | null): boolean {
  if (!rgba) return false;
  const [r, g, b, a] = rgba;
  if (a < 0.999) return false;
  return (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255);
}

/**
 * Reads the theme Azure DevOps applied through the SDK. Returns `present:false`
 * outside a host (unit tests, local harnesses), where the caller falls back.
 *
 * High contrast heuristic: the host's High Contrast themes use pure black/white
 * for both primary AND secondary text (the regular themes dim secondary text
 * with alpha). OS forced colours are checked separately by the caller.
 */
export function readHostTheme(): HostTheme {
  const background = readVar("--background-color");
  const text = readVar("--text-primary-color");
  const none: HostTheme = {
    present: false,
    resolved: "light",
    highContrast: false,
    background,
    text,
    textSecondary: "",
    link: "",
    success: "",
    warning: "",
    error: "",
    info: "",
  };
  const bg = parseColor(background);
  const fg = parseColor(text);
  if (!bg || !fg) return none;

  const textSecondary = readVar("--text-secondary-color");
  const secondary = parseColor(textSecondary);
  const resolved: ResolvedTheme = relativeLuminance(bg) < 0.4 ? "dark" : "light";
  const highContrast = isPure(fg) && isPure(bg) && isPure(secondary);

  return {
    present: true,
    resolved,
    highContrast,
    background,
    text,
    textSecondary,
    link: readVar("--communication-foreground"),
    success: readVar("--status-success-foreground"),
    warning: readVar("--status-warning-text"),
    error: readVar("--status-error-foreground"),
    info: readVar("--status-info-foreground"),
  };
}

export function forcedColorsActive(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(forced-colors: active)").matches;
}

/** Light/dark as the host (or, failing that, the browser) reports it. */
export function detectHostTheme(): ResolvedTheme {
  const host = readHostTheme();
  if (host.present) return host.resolved;
  if (typeof document !== "undefined" && document.body) {
    if (document.body.classList.contains("dark-theme")) return "dark";
    if (document.body.classList.contains("light-theme")) return "light";
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage may be blocked in the extension iframe */
  }
  return "ado";
}

function persistThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* non-fatal */
  }
}

/** Palette for high-contrast: the host's own colours, with the base palette as fallback. */
function highContrastPalette(base: ThemeColors, host: HostTheme): ThemeColors {
  const text = host.text || base.textPrimary;
  const bg = host.background || base.bgPage;
  const link = host.link || base.accent;
  const success = host.success || text;
  const warning = host.warning || text;
  const error = host.error || text;
  const info = host.info || link;
  return {
    ...base,
    accent: link,
    accentStrong: link,
    accentSoft: "transparent",
    accentContrast: bg,
    primary: link,
    primaryStrong: link,
    primaryFg: bg,
    textPrimary: text,
    textSecondary: text,
    textMuted: host.textSecondary || text,
    textVeryMuted: host.textSecondary || text,
    bgPage: bg,
    bgSurface: bg,
    bgSurfaceAlt: bg,
    bgProgressTrack: bg,
    borderDefault: text,
    borderInput: text,
    borderRow: text,
    errorBg: "transparent",
    errorText: error,
    successBg: "transparent",
    successText: success,
    warningBg: "transparent",
    warningBorder: warning,
    warningText: warning,
    infoBg: "transparent",
    infoText: info,
    cleanBg: "transparent",
    cleanBorder: success,
    statGreen: success,
    keyVaultBg: "transparent",
    keyVaultText: info,
    disabledBg: bg,
    btnDefaultBg: bg,
    btnCancelBg: bg,
    chart: [link, success, warning, error, text, host.textSecondary || text],
  };
}

/* ── Provider ────────────────────────────────────────────────────────────── */

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  highContrast: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({
  mode: "ado",
  resolved: "light",
  highContrast: false,
  colors: lightTheme,
  setMode: () => undefined,
});

interface HostSnapshot {
  host: HostTheme;
  fallback: ResolvedTheme;
  forced: boolean;
}

function snapshot(): HostSnapshot {
  return { host: readHostTheme(), fallback: detectHostTheme(), forced: forcedColorsActive() };
}

export const ThemeProvider: React.FC<{
  children: React.ReactNode;
  onModeChange?: (mode: ThemeMode) => void;
}> = ({ children, onModeChange }) => {
  const [mode, setModeState] = React.useState<ThemeMode>(() => readStoredThemeMode());
  const [snap, setSnap] = React.useState<HostSnapshot>(() => snapshot());

  React.useEffect(() => {
    const update = () => setSnap(snapshot());

    // The SDK dispatches this after writing the host theme variables, both on
    // the initial handshake and on every later theme change in Azure DevOps.
    window.addEventListener("themeApplied", update);

    const queries: MediaQueryList[] = [];
    if (typeof window.matchMedia === "function") {
      queries.push(
        window.matchMedia("(prefers-color-scheme: dark)"),
        window.matchMedia("(forced-colors: active)")
      );
    }
    for (const mq of queries) mq.addEventListener?.("change", update);

    let observer: MutationObserver | null = null;
    if (document.body && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(update);
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }

    // In case the SDK applied the theme between the first render and this effect.
    update();

    return () => {
      window.removeEventListener("themeApplied", update);
      for (const mq of queries) mq.removeEventListener?.("change", update);
      observer?.disconnect();
    };
  }, []);

  const highContrast = snap.forced || snap.host.highContrast;
  const hostResolved = snap.host.present ? snap.host.resolved : snap.fallback;
  // High contrast follows the host palette regardless of the user's light/dark pick.
  const resolved: ResolvedTheme = highContrast || mode === "ado" ? hostResolved : mode;

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
    if (highContrast) root.setAttribute("data-contrast", "high");
    else root.removeAttribute("data-contrast");
  }, [resolved, highContrast]);

  const setMode = React.useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      persistThemeMode(next);
      onModeChange?.(next);
    },
    [onModeChange]
  );

  const value = React.useMemo<ThemeContextValue>(() => {
    const base = resolved === "dark" ? darkTheme : lightTheme;
    return {
      mode,
      resolved,
      highContrast,
      colors: highContrast ? highContrastPalette(base, snap.host) : base,
      setMode,
    };
  }, [mode, resolved, highContrast, snap.host, setMode]);

  return React.createElement(ThemeContext.Provider, { value }, children);
};

/** The active palette, for inline styles and SVG. */
export function useTheme(): ThemeColors {
  return React.useContext(ThemeContext).colors;
}

/** Mode control for the theme toggle in the header. */
export function useThemeMode(): Pick<
  ThemeContextValue,
  "mode" | "resolved" | "highContrast" | "setMode"
> {
  const { mode, resolved, highContrast, setMode } = React.useContext(ThemeContext);
  return { mode, resolved, highContrast, setMode };
}

/**
 * A ticking clock for relative timestamps. Without this, "2m ago" freezes until an
 * unrelated state change happens to re-render the tree.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}
