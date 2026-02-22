// Shared UI primitives — SkeletonCard, EmptyState, SectionLabel, StatCard
import { LucideIcon } from "lucide-react";

// ── Skeleton ──────────────────────────────────────────────────────────────────
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
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
        <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-2">
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
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
        <Icon size={26} className="text-gray-400 dark:text-gray-500" strokeWidth={1.5} />
      </div>
      <p className="text-base font-bold text-gray-700 dark:text-gray-300 mb-1">{title}</p>
      {body && <p className="text-sm text-gray-400 max-w-xs">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
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
  onClick?: () => void;
}
export function StatCard({ label, value, sub, icon: Icon, iconColor = "text-blue-500", iconBg = "bg-blue-50 dark:bg-blue-900/30", onClick }: StatCardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 w-full transition group ${onClick ? "hover:border-blue-300 dark:hover:border-blue-700 active:scale-[0.98] cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
        <span className={`p-2 rounded-xl ${iconBg}`}>
          <Icon size={15} className={iconColor} strokeWidth={2} />
        </span>
      </div>
      <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
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
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ── Error banner ──────────────────────────────────────────────────────────────
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl text-sm text-red-600 dark:text-red-400">
      {message}
    </div>
  );
}
