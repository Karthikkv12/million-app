"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { clsx } from "clsx";
import {
  LayoutDashboard, Zap, Search, BarChart2, ClipboardList,
  Wallet, PiggyBank, BookOpen, Settings, LogOut, Menu, X,
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
  const pathname        = usePathname();
  const router          = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen]  = useState(false);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    router.push("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0" onClick={() => setOpen(false)}>
            <span className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Zap size={14} className="text-white" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-black tracking-tight text-gray-900 dark:text-white">OptionFlow</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-0.5 flex-1 justify-center">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
                  isActive(href)
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800/70",
                )}>
                <Icon size={14} strokeWidth={2} />
                {label}
              </Link>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            {user?.username && <span className="text-xs text-gray-400 font-medium">{user.username}</span>}
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <LogOut size={14} strokeWidth={2} />Sign out
            </button>
          </div>

          <button onClick={() => setOpen((v) => !v)}
            className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" aria-label="Toggle menu">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative ml-auto w-72 h-full bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-bold text-gray-900 dark:text-white">{user?.username ?? "Menu"}</span>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3 px-2">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} onClick={() => setOpen(false)}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 transition-colors",
                    isActive(href)
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                  )}>
                  <Icon size={17} strokeWidth={2} />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="px-2 py-3 border-t border-gray-100 dark:border-gray-800">
              <button onClick={handleLogout}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <LogOut size={17} strokeWidth={2} />Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
