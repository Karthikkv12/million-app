"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { SETTINGS_GROUPS, SETTINGS_PAGES } from "./registry";

/** Settings shell: on wide screens a persistent side menu; on phones each page stands alone. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isIndex = pathname === "/settings";
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <div className={clsx("grid grid-cols-1 gap-10", !isIndex && "lg:grid-cols-[200px_minmax(0,1fr)]")}>
        {!isIndex && (
          <nav aria-label="Settings" className="hidden lg:block">
            <div className="sticky top-20 grid gap-5 pt-1">
              <Link href="/settings" className="text-[13px] font-medium text-foreground/60 hover:text-foreground">Settings</Link>
              {SETTINGS_GROUPS.map((g) => (
                <div key={g} className="grid gap-0.5">
                  <p className="eyebrow mb-1 px-3">{g}</p>
                  {SETTINGS_PAGES.filter((p) => p.group === g).map((p) => {
                    const on = pathname === `/settings/${p.id}`;
                    return (
                      <Link key={p.id} href={`/settings/${p.id}`} aria-current={on ? "page" : undefined}
                        className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition",
                          on ? "bg-[var(--surface)] font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)]" : "text-foreground/60 hover:bg-[var(--surface-2)] hover:text-foreground")}>
                        <p.icon size={15} className="shrink-0" />{p.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </nav>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
