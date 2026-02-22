"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Zap, Search, BarChart2, ClipboardList } from "lucide-react";
import { clsx } from "clsx";

const TABS = [
  { href: "/dashboard",    label: "Home",    icon: LayoutDashboard },
  { href: "/options-flow", label: "Flow",    icon: Zap             },
  { href: "/search",       label: "Search",  icon: Search          },
  { href: "/trades",       label: "Trades",  icon: BarChart2       },
  { href: "/orders",       label: "Orders",  icon: ClipboardList   },
];

export default function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe">
      <div className="mx-3 mb-3 rounded-2xl glass border border-[var(--border)] shadow-xl shadow-black/10 overflow-hidden">
        <div className="flex items-stretch">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex-1 flex flex-col items-center justify-center gap-1 py-3 text-[9px] font-bold uppercase tracking-wide transition-all relative",
                  active
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300",
                )}
              >
                {active && (
                  <span className="absolute inset-0 bg-gradient-to-b from-blue-500/8 to-transparent rounded-2xl" />
                )}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.5 : 1.8}
                />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
