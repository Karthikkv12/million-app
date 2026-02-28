"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Zap, Search, BarChart2, Globe } from "lucide-react";
import { clsx } from "clsx";

const TABS = [
  { href: "/dashboard",    label: "Home",    icon: LayoutDashboard },
  { href: "/options-flow", label: "Flow",    icon: Zap             },
  { href: "/search",       label: "Search",  icon: Search          },
  { href: "/trades",       label: "Trades",  icon: BarChart2       },
  { href: "/markets",      label: "Markets", icon: Globe           },
];

export default function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY.current + 4) {
        // scrolling down — hide
        setHidden(true);
      } else if (y < lastY.current - 4) {
        // scrolling up — show immediately
        setHidden(false);
      }
      lastY.current = y;

      // always show again after scroll stops for 300 ms
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setHidden(false), 300);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <nav
      className={clsx(
        "lg:hidden fixed bottom-0 inset-x-0 z-40 pb-safe transition-transform duration-300 ease-in-out",
        hidden ? "translate-y-full" : "translate-y-0",
      )}
    >
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
                    ? "text-foreground"
                    : "text-foreground/50 hover:text-foreground",
                )}
              >
                {active && (
                  <span className="absolute inset-0 bg-[var(--foreground)]/5 rounded-2xl" />
                )}
                {Icon === Zap ? (
                  <svg
                    width={20} height={20}
                    viewBox="0 0 24 24"
                    fill="#F59E0B"
                    className="drop-shadow-[0_0_4px_rgba(245,158,11,0.6)]"
                  >
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                ) : (
                  <Icon
                    size={20}
                    strokeWidth={active ? 2.5 : 1.8}
                  />
                )}
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
