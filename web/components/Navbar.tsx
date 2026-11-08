"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LogOut, Menu, X, Sun, Moon, ShieldCheck, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const NAV = [
  { href: "/dashboard",    label: "Dashboard" },
  { href: "/options-flow", label: "Flow" },
  { href: "/portfolio",    label: "Portfolio" },
  { href: "/unusual",      label: "Unusual" },
  { href: "/markets",      label: "Markets" },
  { href: "/catalyst",     label: "Catalyst" },
  { href: "/settings",     label: "Settings" },
  { href: "/admin/users",  label: "Users", adminOnly: true },
];

export function Logo({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 shrink-0">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-foreground text-background">
        <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="absolute -inset-1 -z-10 rounded-xl bg-warm/25 blur-md" />
      </span>
      <span className="font-mono text-[13px] font-medium uppercase tracking-[0.2em] text-foreground">OptionFlow</span>
    </Link>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-foreground/70 transition hover:text-foreground"
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [pathname]);

  const items = NAV.filter((i) => !i.adminOnly || isAdmin);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const initial = user?.username?.[0]?.toUpperCase() ?? "U";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-6 px-4 sm:px-6">
        <Logo />

        <nav className="hidden md:flex items-center gap-1">
          {items.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "rounded-xl px-3.5 py-2 text-[14px] transition",
                isActive(href) ? "bg-foreground/[0.07] font-semibold text-foreground" : "text-foreground/60 hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeButton />

          <div className="relative hidden md:block" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1 pl-1 pr-2.5 text-sm text-foreground transition hover:border-[var(--border-strong)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">{initial}</span>
              <span className="max-w-[140px] truncate font-medium">{user?.username}</span>
              <ChevronDown size={14} className="text-foreground/50" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-float)]">
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-semibold text-foreground">{user?.username}</p>
                  {isAdmin && (
                    <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-warm">
                      <ShieldCheck size={11} /> Admin
                    </p>
                  )}
                </div>
                <div className="my-1 h-px bg-[var(--border)]" />
                <button
                  onClick={() => logout()}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground/70 transition hover:bg-loss/10 hover:text-loss"
                >
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-foreground md:hidden"
            aria-label="Menu"
          >
            {mobileOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-[var(--border)] bg-background px-4 pb-5 pt-3 md:hidden">
          <nav className="flex flex-col">
            {items.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "rounded-xl px-3 py-3 text-base",
                  isActive(href) ? "bg-foreground/[0.07] font-semibold text-foreground" : "text-foreground/70",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-4">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">{initial}</span>
              {user?.username}
            </span>
            <button onClick={() => logout()} className="btn-ghost h-9 text-xs"><LogOut size={14} /> Sign out</button>
          </div>
        </div>
      )}
    </header>
  );
}
