import type { ReportMeta } from "@/lib/api";

const ORDER = ["morning", "evening", "weekend"];
const NAME: Record<string, string> = { morning: "Morning", evening: "Evening", weekend: "Weekend" };
export const rank = (s: string) => (ORDER.indexOf(s) < 0 ? ORDER.length : ORDER.indexOf(s));
export const reportName = (r: Pick<ReportMeta, "slug" | "title">) => NAME[r.slug] ?? r.title;

/** "today 4:52 AM" / "Mon 6:41 PM" / "Nov 3" */
export function reportWhen(iso: string): string {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `today ${t}`;
  if (now.getTime() - d.getTime() < 6 * 86400e3) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${t}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Mon, Nov 9" for a YYYY-MM-DD day (no time-zone shift). */
export function dayLabel(day: string, year = false): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
}
