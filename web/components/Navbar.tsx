"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useSidebar } from "@/lib/sidebar";
import { clsx } from "clsx";
import {
  LayoutDashboard, Zap, BarChart2, ClipboardList,
  Wallet, PiggyBank, BookOpen, Settings, LogOut, Menu, X,
  ChevronRight, PanelLeftClose, PanelLeftOpen, Globe, Sun, Moon,
  Users, ShieldCheck,
} from "lucide-react";
import { useTheme } from "@/lib/theme";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { href: "/options-flow", label: "Options Flow", icon: Zap             },
  { href: "/markets",      label: "Markets",      icon: Globe           },
  { href: "/trades",       label: "Trades",       icon: BarChart2       },
  // shelved – uncomment to restore:
  // { href: "/orders",       label: "Orders",       icon: ClipboardList   },
  // { href: "/accounts",     label: "Accounts",     icon: Wallet          },
  // { href: "/ledger",       label: "Ledger",       icon: BookOpen        },
  { href: "/budget",       label: "Budget",       icon: PiggyBank       },
  { href: "/settings",     label: "Settings",     icon: Settings        },
  { href: "/admin/users",  label: "Users",        icon: Users,  adminOnly: true },
];

export default function Navbar() {
  const pathname             = usePathname();
  const router               = useRouter();
  const { user, logout, isAdmin }  = useAuth();
  const { collapsed, toggle }      = useSidebar();
  const { theme, toggle: toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    setMobileOpen(false);
    await logout();
    router.push("/");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const NavLink = ({
    href, label, icon: Icon, onClick,
  }: { href: string; label: string; icon: typeof LayoutDashboard; onClick?: () => void }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        onClick={onClick}
        title={collapsed ? label : undefined}
        className={clsx(
          "group flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-150 relative",
          collapsed ? "px-0 py-2.5 justify-center" : "px-3 py-2.5",
          active
            ? "nav-active font-semibold"
            : "text-foreground/70 hover:bg-[var(--surface-2)] dark:hover:bg-white/5 hover:text-foreground dark:hover:text-white",
        )}
      >
        {active && !collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-[var(--foreground)]/40" />
        )}
        {active && collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-[var(--foreground)]/40" />
        )}
        {Icon === Zap ? (
          <svg
            width={17} height={17}
            viewBox="0 0 24 24"
            fill="#F59E0B"
            className="shrink-0 transition-colors drop-shadow-[0_0_4px_rgba(245,158,11,0.6)]"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        ) : (
          <Icon
            size={17}
            strokeWidth={active ? 2.2 : 1.8}
            className={clsx(
              "shrink-0 transition-colors",
              active
                ? "text-foreground"
                : "text-foreground/70 group-hover:text-foreground dark:group-hover:text-foreground",
            )}
          />
        )}
        {!collapsed && (
          <>
            <span className="flex-1">{label}</span>
            {active && <ChevronRight size={13} className="text-foreground/30" />}
          </>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside
        className={clsx(
          "hidden md:flex flex-col fixed top-0 left-0 h-[100dvh] border-r border-[var(--border)] bg-[var(--surface)] z-30 shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out",
          collapsed ? "w-[64px]" : "w-[240px]",
        )}
      >
        {/* Logo row + collapse toggle */}
        <div className={clsx(
          "flex items-center h-16 border-b border-[var(--border)] shrink-0",
          collapsed ? "justify-center px-0" : "justify-between px-4",
        )}>
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="#F59E0B" className="drop-shadow-[0_0_3px_rgba(245,158,11,0.8)]">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </span>
              <span className="text-[15px] font-black tracking-tight text-foreground">OptionFlow</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/dashboard" title="Dashboard" className="w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="#F59E0B" className="drop-shadow-[0_0_3px_rgba(245,158,11,0.8)]">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </Link>
          )}
          {/* Collapse toggle — only shown when not collapsed (appears at right) */}
          {!collapsed && (
            <button
              onClick={toggle}
              title="Collapse sidebar"
              className="p-1.5 rounded-lg text-foreground/70 hover:bg-[var(--surface-2)] hover:text-foreground dark:hover:text-foreground transition"
            >
              <PanelLeftClose size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>

        {/* Nav links */}
        <nav className={clsx(
          "flex-1 min-h-0 overflow-hidden py-4 space-y-0.5",
          collapsed ? "px-2" : "px-3",
        )}>
          {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
          ))}
        </nav>

        {/* Expand button when collapsed (at bottom of nav) */}
        {collapsed && (
          <div className="px-2 pb-2">
            <button
              onClick={toggle}
              title="Expand sidebar"
              className="w-full flex items-center justify-center py-2.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] hover:text-foreground dark:hover:text-foreground transition"
            >
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            </button>
          </div>
        )}

        {/* User + logout */}
        <div className={clsx(
          "pb-4 pt-2 border-t border-[var(--border)] space-y-1",
          collapsed ? "px-2" : "px-3",
        )}>
          {!collapsed && user?.username && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-foreground uppercase">{user.username[0]}</span>
              </div>
              <span className="text-xs font-semibold text-foreground truncate flex-1">{user.username}</span>
              {isAdmin && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20 shrink-0">
                  <ShieldCheck size={8} />
                  ADMIN
                </span>
              )}
            </div>
          )}
          {collapsed && user?.username && (
            <div className="flex justify-center py-2 mb-1" title={user.username}>
              <div className="w-7 h-7 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                <span className="text-[10px] font-black text-foreground uppercase">{user.username[0]}</span>
              </div>
            </div>
          )}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className={clsx(
              "w-full flex items-center gap-3 rounded-xl text-sm font-medium text-foreground/70 hover:bg-[var(--surface-2)] hover:text-foreground transition-all",
              collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
            )}
          >
            {theme === "dark"
              ? <Sun size={16} strokeWidth={1.8} className="shrink-0" />
              : <Moon size={16} strokeWidth={1.8} className="shrink-0" />}
            {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
          </button>
          <button
            onClick={handleLogout}
            title={collapsed ? "Sign out" : undefined}
            className={clsx(
              "w-full flex items-center gap-3 rounded-xl text-sm font-medium text-foreground/70 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-all",
              collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
            )}
          >
            <LogOut size={16} strokeWidth={1.8} className="shrink-0" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 border-b border-[var(--border)] glass">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <span className="w-7 h-7 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
            <Zap size={13} className="text-white" strokeWidth={2.5} />
          </span>
          <span className="text-[14px] font-black tracking-tight text-foreground">OptionFlow</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] dark:hover:bg-white/5 transition"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* ── Mobile slide-out drawer ──────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 h-full max-h-full bg-[var(--surface)] border-r border-[var(--border)] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--border)] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                  <span className="text-[10px] font-black text-foreground uppercase">{user?.username?.[0] ?? "U"}</span>
                </div>
                <span className="text-sm font-bold text-foreground">{user?.username ?? "Menu"}</span>
                {isAdmin && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20">
                    <ShieldCheck size={8} />
                    ADMIN
                  </span>
                )}
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-foreground/70 hover:bg-[var(--surface-2)] dark:hover:bg-white/5 transition"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-contain py-4 px-3 space-y-0.5" style={{ WebkitOverflowScrolling: 'touch' }}>
              {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>
            <div className="px-3 pb-6 pt-2 border-t border-[var(--border)] space-y-1">
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/70 hover:bg-[var(--surface-2)] hover:text-foreground transition-all"
              >
                {theme === "dark"
                  ? <Sun size={16} strokeWidth={1.8} />
                  : <Moon size={16} strokeWidth={1.8} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/70 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-all"
              >
                <LogOut size={16} strokeWidth={1.8} />Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
