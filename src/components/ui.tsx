import * as React from "react";
import { ThemeMode, useThemeMode } from "../utils/theme";
import { openInHost } from "../services/navigation";

/* ── Icons ──────────────────────────────────────────────────────────────────
   Inline SVG so nothing is fetched at runtime (the extension iframe blocks it)
   and everything inherits currentColor. Stroke style matches the brand mark. */

export type IconProps = { size?: number; className?: string };

const svgProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  className,
});

export const IconCheck: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

export const IconX: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconRefresh: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </svg>
);

export const IconPlay: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M7 4.5v15l12-7.5Z" />
  </svg>
);

export const IconStop: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...svgProps(size, className)}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const IconSettings: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...svgProps(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
);

export const IconUsers: React.FC<IconProps> = ({ size = 15, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
  </svg>
);

export const IconAlert: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

export const IconInfo: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...svgProps(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M11 12h1v4h1" />
  </svg>
);

export const IconCopy: React.FC<IconProps> = ({ size = 13, className }) => (
  <svg {...svgProps(size, className)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconTrash: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    <path d="M10 11v5M14 11v5" />
  </svg>
);

export const IconDownload: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 17v3h16v-3" />
  </svg>
);

export const IconChevronRight: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconExternal: React.FC<IconProps> = ({ size = 13, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);

export const IconSun: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M21 13.5A8.5 8.5 0 0 1 10.5 3a7 7 0 1 0 10.5 10.5Z" />
  </svg>
);

export const IconMonitor: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...svgProps(size, className)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

/* ── Shell ──────────────────────────────────────────────────────────────── */

/**
 * Page header shared by every extension: brand mark + title + subtitle on the
 * left, actions (including the theme toggle) on the right.
 */
export const AppShell: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  /** The product glyph from src/brand.tsx, rendered inside the gradient mark. */
  mark: React.ReactNode;
  actions?: React.ReactNode;
  /** Set false to hide the system/light/dark toggle. */
  themeToggle?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, mark, actions, themeToggle = true, children }) => (
  <div className="ax-shell">
    <header className="ax-header">
      <div className="ax-brand">
        <span className="ax-brand-mark" aria-hidden="true">
          {mark}
        </span>
        <div>
          <h1 className="ax-title">{title}</h1>
          {subtitle && <p className="ax-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="ax-header-actions">
        {actions}
        {themeToggle && <ThemeToggle />}
      </div>
    </header>
    {children}
  </div>
);

const THEME_MODES: { mode: ThemeMode; label: string; title: string; icon: React.ReactNode }[] = [
  {
    mode: "ado",
    label: "Azure DevOps",
    title: "Follow your Azure DevOps theme",
    icon: <IconMonitor />,
  },
  { mode: "light", label: "Light", title: "Always light", icon: <IconSun /> },
  { mode: "dark", label: "Dark", title: "Always dark", icon: <IconMoon /> },
];

/**
 * System / light / dark picker. Hidden while the host runs a High Contrast
 * theme (or the OS forces colours): accessibility settings are not something
 * an extension should offer to override.
 */
export const ThemeToggle: React.FC = () => {
  const { mode, highContrast, setMode } = useThemeMode();
  if (highContrast) return null;
  return (
    <div className="ax-segmented ax-theme-toggle" role="group" aria-label="Theme">
      {THEME_MODES.map((item) => (
        <button
          key={item.mode}
          type="button"
          aria-pressed={mode === item.mode}
          onClick={() => setMode(item.mode)}
          title={item.title}
        >
          {item.icon}
          <span className="ax-sr-only">{item.label}</span>
        </button>
      ))}
    </div>
  );
};

/** Tab strip. Tabs are buttons with aria-selected; the panel is rendered by the caller. */
export const Tabs: React.FC<{
  tabs: { id: string; label: React.ReactNode; count?: number; icon?: React.ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  "aria-label"?: string;
}> = ({ tabs, active, onChange, "aria-label": ariaLabel = "Sections" }) => (
  <div className="ax-tabs" role="tablist" aria-label={ariaLabel}>
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        className="ax-tab"
        aria-selected={active === tab.id}
        onClick={() => onChange(tab.id)}
      >
        {tab.icon}
        {tab.label}
        {tab.count !== undefined && <span className="ax-tab__count">{tab.count}</span>}
      </button>
    ))}
  </div>
);

/* ── Primitives ─────────────────────────────────────────────────────────── */

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "sm" | "md";
    icon?: React.ReactNode;
    busy?: boolean;
  }
> = ({ variant = "default", size = "md", icon, busy, className = "", children, ...rest }) => (
  <button
    type="button"
    className={[
      "ax-btn",
      variant !== "default" ? `ax-btn--${variant}` : "",
      size === "sm" ? "ax-btn--sm" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    disabled={busy || rest.disabled}
    {...rest}
  >
    {busy ? <span className="ax-spinner" aria-hidden="true" /> : icon}
    {children}
  </button>
);

export const Card: React.FC<{
  title?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, hint, actions, flush, className = "", testId, children }) => (
  <section className={`ax-card ax-section ${className}`.trim()} data-testid={testId}>
    {(title || actions) && (
      <header className="ax-card__head">
        <div>
          <h2 className="ax-card__title">{title}</h2>
          {hint && <p className="ax-card__hint">{hint}</p>}
        </div>
        {actions && <div className="ax-row">{actions}</div>}
      </header>
    )}
    <div className={`ax-card__body${flush ? " ax-card__body--flush" : ""}`}>{children}</div>
  </section>
);

export type Tone =
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warn"
  | "danger"
  | "critical"
  | "elite"
  | "high"
  | "medium"
  | "low";

export const Pill: React.FC<{ tone?: Tone; title?: string; children: React.ReactNode }> = ({
  tone = "neutral",
  title,
  children,
}) => (
  <span className={`ax-pill ax-pill--${tone}`} title={title}>
    {children}
  </span>
);

/** Summary tile. Use inside `<div className="ax-metrics">`. */
export const Metric: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "accent" | "info" | "success" | "warn" | "danger";
  testId?: string;
}> = ({ label, value, hint, tone = "neutral", testId }) => (
  <div className={`ax-metric ax-metric--${tone}`} data-testid={testId}>
    <div className="ax-metric__label">{label}</div>
    <div className="ax-metric__value">{value}</div>
    {hint && <div className="ax-metric__hint">{hint}</div>}
  </div>
);

export const Banner: React.FC<{
  tone: "error" | "warn" | "info" | "success";
  title?: React.ReactNode;
  onDismiss?: () => void;
  children: React.ReactNode;
}> = ({ tone, title, onDismiss, children }) => (
  <div className={`ax-banner ax-banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
    {tone === "success" ? <IconCheck size={16} /> : tone === "info" ? <IconInfo /> : <IconAlert />}
    <div className="ax-banner__body">
      {title && <div className="ax-banner__title">{title}</div>}
      <div>{children}</div>
    </div>
    {onDismiss && (
      <button
        type="button"
        className="ax-btn ax-btn--icon ax-btn--ghost"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <IconX size={15} />
      </button>
    )}
  </div>
);

export const Progress: React.FC<{
  label?: React.ReactNode;
  current?: number;
  total?: number;
  /** When true the bar animates without a known total. */
  indeterminate?: boolean;
}> = ({ label, current = 0, total = 0, indeterminate }) => {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div
      className="ax-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
    >
      {(label || total > 0) && (
        <div className="ax-progress__row">
          <span>{label}</span>
          {total > 0 && (
            <span>
              {current} / {total}
            </span>
          )}
        </div>
      )}
      <div className="ax-progress__track">
        <div
          className={`ax-progress__fill${indeterminate ? " ax-progress__fill--indeterminate" : ""}`}
          style={{ width: `${indeterminate ? 35 : pct}%` }}
        />
      </div>
    </div>
  );
};

export const Skeleton: React.FC<{
  variant?: "text" | "value" | "pill";
  style?: React.CSSProperties;
}> = ({ variant = "text", style }) => (
  <div className={`ax-skel ax-skel--${variant}`} style={style} aria-hidden="true" />
);

export const EmptyState: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, icon, action, children }) => (
  <div className="ax-empty">
    {icon && <div className="ax-gate__mark">{icon}</div>}
    <p className="ax-empty__title">{title}</p>
    {children && <div className="ax-empty__body">{children}</div>}
    {action && <div style={{ marginTop: 16 }}>{action}</div>}
  </div>
);

/** Full-page centred card for access-denied, fatal errors and loading. */
export const Gate: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  busy?: boolean;
}> = ({ title, icon, children, busy }) => (
  <div className="ax-gate">
    <div className="ax-gate__card" aria-busy={busy || undefined}>
      {icon && <div className="ax-gate__mark">{icon}</div>}
      <h1 className="ax-gate__title">{title}</h1>
      {children}
    </div>
  </div>
);

/**
 * Modal with a focus trap, Escape-to-close, and focus restoration. Extensions run
 * in an iframe, so a modal that leaks focus is genuinely disorienting.
 */
export const Modal: React.FC<{
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}> = ({ title, onClose, footer, wide, children }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = ref.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;

    const items = [
      ...ref.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="ax-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
    >
      <div
        className="ax-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        style={wide ? { maxWidth: 900 } : undefined}
      >
        <header className="ax-modal__head">
          <h2 className="ax-modal__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="ax-btn ax-btn--icon ax-btn--ghost"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={16} />
          </button>
        </header>
        <div className="ax-modal__body">{children}</div>
        {footer && <footer className="ax-modal__foot">{footer}</footer>}
      </div>
    </div>
  );
};

/** Confirmation dialog built on Modal. */
export const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  );
};

/** Collapsible section with a header row. */
export const Disclosure: React.FC<{
  open: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, onToggle, summary, children }) => (
  <div className={`ax-disclosure${open ? " ax-disclosure--open" : ""}`}>
    <button type="button" className="ax-disclosure__head" onClick={onToggle} aria-expanded={open}>
      <span className="ax-disclosure__chevron">
        <IconChevronRight />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{summary}</span>
    </button>
    {open && <div className="ax-disclosure__body">{children}</div>}
  </div>
);

/** Sortable column header helper. */
export const SortHeader: React.FC<{
  label: React.ReactNode;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  numeric?: boolean;
}> = ({ label, active, direction, onClick, numeric }) => (
  <th
    className={`ax-th-sort${numeric ? " ax-num" : ""}`}
    onClick={onClick}
    aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
  >
    {label}
    {active && <span aria-hidden="true"> {direction === "asc" ? "▲" : "▼"}</span>}
  </th>
);

/** Error boundary with a retry button, rendered inside the gate card. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Gate title="Something went wrong" icon={<IconAlert size={26} />}>
          <p className="ax-gate__body">{this.state.error.message}</p>
          <Button
            variant="primary"
            onClick={() => {
              this.props.onReset?.();
              this.setState({ error: null });
            }}
          >
            Try again
          </Button>
        </Gate>
      );
    }
    return this.props.children;
  }
}

/* ── Delivery Insights specifics ──────────────────────────────────────────
   Product-level pieces that are not part of the shared kit. */

export const IconRocket: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...svgProps(size, className)}>
    <path d="M5 13c0-5 3.5-9.5 9-11 1.5 5.5-1 10-6 13l-3-2Z" />
    <path d="M8 15 5 19l-2-2 4-3M12 8h.01" />
  </svg>
);

export const IconLock: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg {...svgProps(size, className)}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 1 1 8 0v3" />
  </svg>
);

export const IconKey: React.FC<IconProps> = ({ size = 24, className }) => (
  <svg {...svgProps(size, className)}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9M18 12v4M15 12v3" />
  </svg>
);

export type BandName = "Elite" | "High" | "Medium" | "Low";

export const BandPill: React.FC<{ band: BandName; testId?: string }> = ({ band, testId }) => (
  <span className={`ax-pill ax-pill--${band.toLowerCase()}`} data-testid={testId}>
    {band}
  </span>
);

export const StatusPill: React.FC<{ status: "succeeded" | "failed" }> = ({ status }) => (
  <span className={`ax-pill ax-pill--${status === "succeeded" ? "success" : "danger"}`}>
    {status === "succeeded" ? <IconCheck size={12} /> : <IconX size={12} />}
    {status === "succeeded" ? "Succeeded" : "Failed"}
  </span>
);

/** Compact trend line for a metric card. Hand-rolled — no chart dependency. */
export const Sparkline: React.FC<{ values: number[]; label: string }> = ({ values, label }) => {
  const path = React.useMemo(() => {
    if (values.length < 2) return null;
    const width = 100;
    const height = 28;
    const pad = 2;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;
    const points = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - 2 * pad);
      const y = pad + (1 - (v - min) / range) * (height - 2 * pad);
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    });
    return {
      line: points.join(" "),
      area: `${points.join(" ")} ${width - pad},${height} ${pad},${height}`,
    };
  }, [values]);

  if (!path) return null;

  return (
    <svg
      className="ax-metric__spark ax-chart"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon points={path.area} fill="currentColor" opacity={0.1} />
      <polyline
        points={path.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

/**
 * Collapsed technical detail with a one-click copy.
 *
 * The friendly message on an error screen is a guess; this is what actually
 * happened. It stays collapsed so it never competes with the copy that helps most
 * people, and it is one click and one paste for the person who needs it — which
 * is the difference between a bug report naming a file and line, and one that
 * says "some error about a function".
 */
export const Diagnostics: React.FC<{ report: string; summary?: string }> = ({
  report,
  summary = "Technical details",
}) => {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked in some iframe configurations. The text is
      // already on screen and selectable, so there is nothing to fall back to.
      setCopied(false);
    }
  };

  return (
    <details className="ax-diag">
      <summary className="ax-diag__summary">{summary}</summary>
      <pre className="ax-diag__pre">{report}</pre>
      <Button size="sm" variant="ghost" icon={<IconCopy />} onClick={copy}>
        {copied ? "Copied" : "Copy diagnostics"}
      </Button>
    </details>
  );
};

/**
 * Link out to Azure DevOps. Keeps a real href so middle-click and "copy link
 * address" behave normally, but routes the click through the host navigation
 * service, because an extension iframe is sandboxed and may not be permitted to
 * open a window itself. Renders as plain text when no URL could be resolved.
 */
export const HostLink: React.FC<{
  href: string | null;
  title?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ href, title, className, children }) => {
  if (!href) return <>{children}</>;
  return (
    <a
      className={className ?? "ax-link"}
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => {
        // Leave modified clicks to the browser so "open in new tab" still works.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void openInHost(href);
      }}
    >
      {children}
    </a>
  );
};
