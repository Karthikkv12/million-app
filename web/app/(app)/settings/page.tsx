"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { SETTINGS_GROUPS, visiblePages } from "./registry";

export default function SettingsIndex() {
  const { user, isAdmin } = useAuth();
  const pages = visiblePages(isAdmin);
  const { theme } = useTheme();
  const summary: Record<string, string | undefined> = {
    profile: user?.username,
    appearance: theme === "dark" ? "Dark" : "Light",
  };
  return (
    <>
      <div className="mb-8">
        <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Account</p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-[40px]">Settings</h1>
      </div>
      <div className="grid grid-cols-1 gap-8">
        {SETTINGS_GROUPS.filter((g) => pages.some((p) => p.group === g)).map((g) => (
          <section key={g}>
            <h2 className="eyebrow mb-2 px-1">{g}</h2>
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              {pages.filter((p) => p.group === g).map((p) => (
                <li key={p.id}>
                  <Link href={`/settings/${p.id}`} className="flex items-center gap-4 px-4 py-3.5 transition hover:bg-[var(--surface-2)]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-foreground/70">
                      <p.icon size={17} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-foreground">{p.label}</span>
                      <span className="block truncate text-[13px] text-foreground/55">{p.desc}</span>
                    </span>
                    {summary[p.id] && <span className="hidden font-mono text-[12px] text-foreground/50 sm:inline">{summary[p.id]}</span>}
                    <ChevronRight size={17} className="shrink-0 text-foreground/35" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
