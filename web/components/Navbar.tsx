"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { clsx } from "clsx";
import {
  LayoutDashboard, Zap, Search, BarChart2, ClipboardList,
  Wallet, PiggyBank, BookOpen, Settings, LogOut, Menu, X, ChevronRight,
} from "lucide-react";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { href: "/options-flow", label: "Options Flow", icon: Zap             },
  { href: "/search",       label: "Search",       icon: Search          },
  { href: "/trades",       label: "Trades",       icon: BarChart2       },
  { href: "/orders",       label: "Orders",       icon: ClipboardList   },
  { href: "/accounts",     label: "Accounts",     icon: Wallet          },
  { href: "/budget",       label: "Budget",       icon: PiggyBank       },
  { href: "/ledger",       label: "Ledger",       icon: BookOpen        },
  { href: "/settings",     label: "Settings",     icon: Settings        },
];

export default function Navbar() {
  const pathname         = usePathname();
  const router           = useRouter();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    setMobileOpen(false);
    await logout();
    router.push("/login");
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
        className={clsx(
          "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative",
          active
            ? "nav-active font-semibold"
            : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white",
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-blue-500" />
        )}
        <Icon
          size={17}
          strokeWidth={active ? 2.2 : 1.8}
          className={active
            ? "text-blue-500 dark:text-blue-400"
            : "text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors"}
        />
        <span className="flex-1">{label}</span>
        {active && <ChevronRight size={13} className="text-blue-400 opacity-60" />}
      </Link>
    );
  };

  return (
    <>
      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-[240px] shrink-0 h-screen sticky top-0 border-r border-[var(--border)] bg-[var(--surface)] z-30">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-[var(--border)] shrink-0">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Zap size={15} className="text-white" strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-black tracking-tight text-gray-900 dark:text-white">OptionFlow</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-3 pb-4 pt-2 border-t border-[var(--border)] space-y-1">
          {user?.username && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-black text-white uppercase">{user.username[0]}</span>
              </div>
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 truncate">{user.username}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-all"
          >
            <LogOut size={16} strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar ────────────────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 border-b border-[var(--border)] glass">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <Zap size={13} className="text-white" strokeWidth={2.5} />
          </span>
          <span className="text-[14px] font-black tracking-tight text-gray-900 dark:text-white">OptionFlow</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 transition"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {/* ── Mobile slide-out drawer ────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 h-full bg-[var(--surface)] border-r border-[var(--border)] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--border)] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
                  <span className="text-[10px] font-black text-white uppercase">{user?.username?.[0] ?? "U"}</span>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{user?.username ?? "Menu"}</span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
              {NAV.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>
            <div className="px-3 pb-6 pt-2 border-t border-[var(--border)]">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-all"
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
