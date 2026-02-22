"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { clsx } from "clsx";

const NAV = [
  { href: "/dashboard",    label: "Dashboard"     },
  { href: "/options-flow", label: "Options Flow"  },
  { href: "/trades",       label: "Trades"        },
  { href: "/orders",       label: "Orders"        },
  { href: "/accounts",     label: "Accounts"      },
];

export default function Navbar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-gray-950/90 backdrop-blur-sm">
      <div className="max-w-screen-xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
        {/* Brand */}
        <Link href="/dashboard" className="text-[15px] font-black tracking-tight text-gray-900 dark:text-white shrink-0">
          OptionFlow
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "px-3 py-1 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                pathname === href || pathname.startsWith(href + "/")
                  ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800/60",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* User */}
        {user && (
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-gray-400 hidden sm:block">{user.username}</span>
            <button
              onClick={handleLogout}
              className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
