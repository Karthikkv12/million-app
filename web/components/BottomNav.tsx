"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Zap, Globe, Settings, Briefcase, Scale } from "lucide-react";
import { clsx } from "clsx";

const TABS = [
  { href: "/dashboard",    label: "Home",    icon: LayoutDashboard },
  { href: "/options-flow", label: "Flow",    icon: Zap             },
  { href: "/hedge",        label: "Hedge",   icon: Scale           },
  { href: "/markets",      label: "Markets", icon: Globe           },
  { href: "/portfolio",    label: "Portfolio", icon: Briefcase     },
  { href: "/settings",     label: "Settings", icon: Settings       },
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
        "md:hidden fixed bottom-0 inset-x-0 z-40 pb-safe transition-transform duration-300 ease-in-out",
        hidden ? "translate-y-full" : "translate-y-0",
      )}
    >
      <div className="mx-3 mb-3 rounded-2xl glass border shadow-[var(--shadow-float)] overflow-hidden">
        <div className="flex items-stretch">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-all relative",
                  active
                    ? "text-foreground"
                    : "text-foreground/50 hover:text-foreground",
                )}
              >
                {active && (
                  <span className="absolute inset-1 bg-foreground/[0.07] rounded-xl" />
                )}
                <Icon size={19} strokeWidth={active ? 2.2 : 1.7} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
