// Shared UI primitives
import React, { useState } from "react";
import { LucideIcon, RefreshCw } from "lucide-react";
import { clsx } from "clsx";

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
        <p className="font-mono text-[10px] text-foreground/55 uppercase tracking-[0.16em]">{label}</p>
        <span className={clsx("p-2 rounded-xl", iconBg)}>
          <Icon size={14} className={iconColor} strokeWidth={2} />
        </span>
      </div>
      <p className={clsx(
        "text-xl sm:text-2xl font-semibold tracking-tight tabular-nums leading-tight",
        trend === "up"   ? "text-emerald-500" :
        trend === "down" ? "text-red-500"      :
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
}
export function PageHeader({ title, sub, action }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between mb-8 gap-4">
      <div>
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
    <div className="p-4 bg-red-500/[0.06] border border-red-500/20 rounded-2xl text-sm text-red-600 dark:text-red-400 leading-relaxed">
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
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    danger:  "bg-red-500/10 text-red-600 dark:text-red-400",
    warning: "bg-warm/10 text-warm",
    info:    "bg-accent/10 text-accent",
  };
  return (
    <span className={clsx("inline-flex items-center font-mono text-[10px] px-2 py-0.5 rounded-md uppercase tracking-[0.12em]", styles[variant], className)}>
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
