// Shared UI primitives
import React, { useState } from "react";
import { LucideIcon, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { useTheme } from "@/lib/theme";

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
      <div className="skeleton h-4 w-2/5" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-3 flex-1" />
      <div className="skeleton h-3 w-16" />
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 space-y-2">
          <div className="skeleton h-2.5 w-16" />
          <div className="skeleton h-6 w-24" />
          <div className="skeleton h-2 w-12" />
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
interface EmptyProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}
export function EmptyState({ icon: Icon, title, body, action }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center mb-4 shadow-inner">
        <Icon size={28} className="text-foreground/50" strokeWidth={1.4} />
      </div>
      <p className="text-base font-semibold text-foreground mb-1">{title}</p>
      {body && <p className="text-sm text-foreground/70 max-w-xs leading-relaxed">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="eyebrow mb-3 flex items-center gap-2">
      <span className="h-px w-4 bg-foreground/30" />
      {children}
    </h2>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
}
export function StatCard({
  label, value, sub, icon: Icon,
  iconColor = "text-foreground/60",
  iconBg    = "bg-foreground/[0.05]",
  trend,
  onClick,
}: StatCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={clsx(
        "text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 w-full transition-all duration-200 group",
        onClick
          ? "hover:border-[var(--border-strong)] active:scale-[0.98] cursor-pointer"
          : "card-hover",
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="font-mono text-[11px] text-foreground/55 uppercase tracking-[0.16em]">{label}</p>
        <span className={clsx("p-2 rounded-xl", iconBg)}>
          <Icon size={14} className={iconColor} strokeWidth={2} />
        </span>
      </div>
      <p className={clsx(
        "text-xl sm:text-2xl font-semibold tracking-tight tabular-nums leading-tight",
        trend === "up"   ? "text-gain" :
        trend === "down" ? "text-loss"      :
        "text-foreground",
      )}>{value}</p>
      {sub && <p className="text-xs text-foreground/70 mt-1.5">{sub}</p>}
    </Tag>
  );
}

// ── Page header ───────────────────────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  eyebrow?: string;
}
export function PageHeader({ title, sub, action, eyebrow }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between mb-8 gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />{eyebrow}</p>
        )}
        <h1 className="text-3xl sm:text-[40px] font-semibold text-foreground tracking-[-0.035em] leading-[1.05]">{title}</h1>
        {sub && <p className="text-[15px] text-foreground/60 mt-2 leading-relaxed">{sub}</p>}
      </div>
      {action && <div className="shrink-0 mt-0.5">{action}</div>}
    </div>
  );
}

// ── Refresh button ───────────────────────────────────────────────────────────
export function RefreshButton({ onRefresh, isRefreshing = false }: {
  onRefresh: () => void;
  isRefreshing?: boolean;
}) {
  const [spinning, setSpinning] = useState(false);

  const handleClick = () => {
    if (spinning || isRefreshing) return;
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 800);
  };

  const active = spinning || isRefreshing;

  return (
    <button
      onClick={handleClick}
      aria-label="Refresh"
      className={clsx(
        "relative flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200",
        "bg-[var(--surface)] border border-[var(--border)]",
        "hover:border-[var(--border-strong)]",
        "active:scale-90",
        active && "border-[var(--border-strong)]",
      )}
    >
      {/* outer glow ring */}
      <span
        className={clsx(
          "absolute inset-0 rounded-full transition-opacity duration-300",
          active
            ? "opacity-100 animate-[refresh-pulse_1s_ease-out_infinite]"
            : "opacity-0 group-hover:opacity-100",
        )}
        style={{ boxShadow: "0 0 0 0 rgba(99,130,251,0.5)" }}
      />
      <RefreshCw
        size={15}
        strokeWidth={2.2}
        className={clsx(
          "text-foreground/70 transition-colors duration-200",
          active ? "text-foreground animate-[spin_0.7s_linear_infinite]" : "hover:text-foreground",
        )}
      />
    </button>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-4 bg-loss/[0.06] border border-loss/20 rounded-2xl text-sm text-loss leading-relaxed">
      {message}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
interface TabsProps {
  tabs: { key: string; label: React.ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={clsx("overflow-x-auto scrollbar-none -mx-1 px-1", className)}>
      <div className="flex gap-1 border border-[var(--border)] bg-[var(--surface)] p-1 rounded-xl w-max min-w-full sm:w-fit sm:min-w-0">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={clsx(
              "px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 whitespace-nowrap",
              active === key
                ? "bg-foreground text-background"
                : "text-foreground/60 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ children, variant = "default", className }: {
  children: React.ReactNode;
  variant?: "default" | "success" | "danger" | "warning" | "info";
  className?: string;
}) {
  const styles = {
    default: "bg-foreground/[0.06] text-foreground/80",
    success: "bg-gain/10 text-gain",
    danger:  "bg-loss/10 text-loss",
    warning: "bg-warm/10 text-warm",
    info:    "bg-accent/10 text-accent",
  };
  return (
    <span className={clsx("inline-flex items-center font-mono text-[11px] px-2 py-0.5 rounded-md uppercase tracking-[0.1em]", styles[variant], className)}>
      {children}
    </span>
  );
}

// ── Surface card ──────────────────────────────────────────────────────────────
export function Card({ children, className, onClick }: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={clsx(
        "bg-[var(--surface)] border border-[var(--border)] rounded-2xl transition-all duration-200",
        onClick && "hover:border-[var(--border-strong)] active:scale-[0.99] w-full text-left cursor-pointer",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared card system — every card in the app is a Panel.
// ══════════════════════════════════════════════════════════════════════════════

/** Section heading above a group of panels: "— LABEL" with optional right-side meta. */
export function SectionHeader({ label, meta, className }: { label: string; meta?: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-3 flex flex-wrap items-center justify-between gap-2", className)}>
      <h2 className="eyebrow flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />{label}</h2>
      {meta && <div className="flex items-center gap-2 text-[12px] text-foreground/55">{meta}</div>}
    </div>
  );
}

/**
 * Panel — the one card. Hairline border, 16px radius, optional header row with
 * a mono uppercase title (and window dots when `chrome`), right-side actions.
 */
export function Panel({
  title, sub, actions, chrome = false, padded = true, className, bodyClassName, children,
}: {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  chrome?: boolean;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={clsx("min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]", className)}>
      {(title || actions) && (
        <header className="flex min-h-[44px] items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {chrome && (
              <span className="hidden shrink-0 gap-1.5 sm:flex" aria-hidden>
                <i className="h-2 w-2 rounded-full bg-foreground/15" />
                <i className="h-2 w-2 rounded-full bg-foreground/15" />
                <i className="h-2 w-2 rounded-full bg-foreground/15" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/70">{title}</h3>}
              {sub && <p className="truncate text-[12px] text-foreground/50">{sub}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Gain/loss text: ▲ +1.23 (+0.45%). Neutral grey at exactly zero. */
export function Change({ value, pct, className, digits = 2 }: { value?: number | null; pct?: number | null; className?: string; digits?: number }) {
  const v = pct ?? value ?? 0;
  const tone = v > 0 ? "text-gain" : v < 0 ? "text-loss" : "text-foreground/55";
  const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "■";
  const fmt = (n: number) => (n > 0 ? "+" : "") + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <span className={clsx("inline-flex items-center gap-1 font-mono text-[12px] tabular-nums", tone, className)}>
      <span className="text-[9px]">{arrow}</span>
      {value != null && <span>{fmt(value)}</span>}
      {pct != null && <span>{value != null ? `(${fmt(pct)}%)` : `${fmt(pct)}%`}</span>}
    </span>
  );
}

const PILL_TONE = {
  neutral: "border-[var(--border-strong)] text-foreground/70",
  good:    "border-gain/30 bg-gain/10 text-gain",
  bad:     "border-loss/30 bg-loss/10 text-loss",
  warn:    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  accent:  "border-accent/30 bg-accent/10 text-accent",
};
/** Small rounded label for state: role, status, regime. */
export function Pill({ tone = "neutral", children, className, dot = false }: {
  tone?: keyof typeof PILL_TONE; children: React.ReactNode; className?: string; dot?: boolean;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em]", PILL_TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Compact segmented control (e.g. 1D / 5D / 30D). */
export function Segmented<T extends string>({ options, value, onChange, className, label }: {
  options: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={clsx("inline-flex rounded-lg border border-[var(--border)] p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md px-2.5 py-1 font-mono text-[11px] transition",
            value === o.value ? "bg-foreground text-background" : "text-foreground/55 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Diverging heat colour for % changes (tiles, bars). Intensity grows with |pct|
 * up to `cap`; near-zero changes stay a quiet neutral.
 */
export function heatColor(pct: number | null | undefined, cap = 3): { bg: string; fg: string } {
  if (pct == null || Number.isNaN(pct)) return { bg: "rgb(var(--foreground-rgb) / 0.06)", fg: "rgb(var(--foreground-rgb) / 0.6)" };
  const a = Math.min(Math.abs(pct) / cap, 1);
  if (Math.abs(pct) < 0.05) return { bg: "rgb(var(--foreground-rgb) / 0.08)", fg: "rgb(var(--foreground-rgb) / 0.8)" };
  const strong = a > 0.55;
  return pct > 0
    ? { bg: `rgb(var(--gain-rgb) / ${0.12 + a * 0.68})`, fg: strong ? "#ffffff" : "rgb(var(--foreground-rgb) / 0.9)" }
    : { bg: `rgb(var(--loss-rgb) / ${0.12 + a * 0.68})`, fg: strong ? "#ffffff" : "rgb(var(--foreground-rgb) / 0.9)" };
}

/**
 * Concrete colours for SVG/canvas charts. SVG presentation attributes don't
 * reliably resolve CSS variables in every browser, so charts take real values.
 */
export function useChartColors() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    accent: dark ? "#7aa2ff" : "#2f5bea",
    ink:    dark ? "#e6e9ef" : "#0e0f12",
    muted:  dark ? "rgba(203,213,225,0.5)" : "rgba(14,15,18,0.45)",
    grid:   dark ? "rgba(148,163,184,0.10)" : "rgba(14,15,18,0.07)",
    gain:   dark ? "#3fb37f" : "#15803d",
    loss:   dark ? "#e55d5d" : "#dc2626",
    gainSoft: dark ? "rgba(63,179,127,0.35)" : "rgba(21,128,61,0.28)",
    lossSoft: dark ? "rgba(229,93,93,0.35)" : "rgba(220,38,38,0.25)",
    surface: dark ? "#141a22" : "#ffffff",
    border:  dark ? "rgba(148,163,184,0.18)" : "rgba(14,15,18,0.12)",
  };
}
