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
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-gray-950/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 pb-safe">
      <div className="flex items-stretch">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold transition-colors relative",
                active
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full bg-blue-500" />
              )}
              <Icon
                size={20}
                strokeWidth={active ? 2.5 : 1.8}
                className={active ? "text-blue-600 dark:text-blue-400" : ""}
              />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
