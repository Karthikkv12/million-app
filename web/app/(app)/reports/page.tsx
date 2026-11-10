"use client";
/**
 * Reports: the daily pages (morning, evening, weekend) a scheduled task publishes to /reports/ingest.
 * One page is kept per report per day: pick the report in the tabs and the day in the date control.
 * Each page is shown as it was built, inside a sandboxed frame: its scripts (charts, tabs) run, but it can't
 * reach the app, its storage or the login. The frame fills the screen and scrolls on its own.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { fetchReport, fetchReports } from "@/lib/api";
import { dayLabel, rank, reportName } from "@/lib/reports";
import { useTheme } from "@/lib/theme";

/** Opens the page's outside links in a new tab (they can't load inside the frame). */
const LINKS = `<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");` +
  `if(a&&/^https?:/i.test(a.getAttribute("href"))){a.target="_blank";a.rel="noopener noreferrer"}},true)</script>`;

function frameDoc(html: string, theme: string): string {
  return `<!doctype html><html data-theme="${theme === "light" ? "light" : "dark"}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}</style></head><body>${html}${LINKS}</body></html>`;
}

function Reports() {
  const router = useRouter();
  const params = useSearchParams();
  const want = params.get("r"), wantDay = params.get("d");
  const { theme } = useTheme();
  const list = useQuery({ queryKey: ["reports"], queryFn: fetchReports, refetchInterval: 5 * 60_000 });
  const reports = useMemo(() => [...(list.data ?? [])].sort((a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title)), [list.data]);
  // default: the report published last
  const latest = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.published_at.localeCompare(a.published_at))[0], [list.data]);
  const current = reports.find((r) => r.slug === want) ?? latest;
  const days = current?.days ?? [];                                   // newest first
  const day = wantDay && days.includes(wantDay) ? wantDay : days[0];
  const at = days.indexOf(day);
  const go = (slug: string, d?: string) => router.replace(`/reports?r=${encodeURIComponent(slug)}${d ? `&d=${d}` : ""}`);
  const page = useQuery({
    // the latest day can be republished during the day; older days don't change
    queryKey: ["report", current?.slug, day, at === 0 ? current?.published_at : null],
    queryFn: () => fetchReport(current!.slug, day), enabled: !!current && !!day, staleTime: Infinity,
  });
  const doc = useMemo(() => (page.data ? frameDoc(page.data.html, theme) : null), [page.data, theme]);

  // the frame takes the rest of the screen (above the phone's bottom bar)
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(600);
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current) return;
      const phone = window.matchMedia("(max-width: 767px)").matches;
      // phone: stop above the floating bottom bar; desktop: leave the shell's bottom padding
      const bar = phone ? (document.querySelector("nav[data-bottom-nav]")?.getBoundingClientRect().height ?? 84) + 4 : 40;
      setH(Math.max(320, window.innerHeight - box.current.getBoundingClientRect().top - bar));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [reports.length, current?.slug, day]);
  useEffect(() => { window.scrollTo(0, 0); }, [current?.slug, day]);

  if (list.isLoading) return <div className="mx-4 mt-5 h-40 animate-pulse bg-foreground/[0.03] sm:mx-8" />;
  if (list.error) return <p className="px-4 py-8 text-[14px] text-loss sm:px-8">{(list.error as Error).message || "Couldn't load the reports."}</p>;
  if (!reports.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">Reports</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-foreground/65">
          No report has arrived yet. The morning report is published before the open and the evening report after the close;
          each shows here as soon as it is built.
        </p>
      </div>
    );
  }

  return (
    <>
      <nav aria-label="Reports" className="border-b border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center gap-x-1 px-4 sm:px-6">
          {reports.map((r) => {
            const on = r.slug === current?.slug;
            return (
              // keep the day when the other report has a page for it
              <button key={r.slug} onClick={() => go(r.slug, day && r.days.includes(day) ? day : undefined)} aria-current={on ? "page" : undefined}
                className={clsx("-mb-px shrink-0 border-b-2 px-3 py-3 text-[13.5px] transition",
                  on ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/55 hover:text-foreground")}>
                {reportName(r)}
              </button>
            );
          })}
          {current && day && (
            <div className="ml-auto flex shrink-0 items-center gap-0.5 py-1.5">
              <button onClick={() => go(current.slug, days[at + 1])} disabled={at >= days.length - 1} aria-label="Earlier report"
                className="rounded-lg p-1.5 text-foreground/60 hover:text-foreground disabled:opacity-25"><ChevronLeft size={16} /></button>
              <select value={day} onChange={(e) => go(current.slug, e.target.value)} aria-label="Report date"
                className="rounded-lg border border-[var(--border)] bg-background px-2 py-1.5 font-mono text-[12px] text-foreground">
                {days.map((d, i) => <option key={d} value={d}>{dayLabel(d, d.slice(0, 4) !== days[0].slice(0, 4))}{i === 0 ? " · latest" : ""}</option>)}
              </select>
              <button onClick={() => go(current.slug, days[at - 1])} disabled={at <= 0} aria-label="Later report"
                className="rounded-lg p-1.5 text-foreground/60 hover:text-foreground disabled:opacity-25"><ChevronRight size={16} /></button>
              {page.data?.source_url && (at === 0 || page.data.source_url !== current.source_url) && (
                <a href={page.data.source_url} target="_blank" rel="noopener noreferrer" title="Open the original page"
                  className="ml-1 flex items-center gap-1.5 p-1.5 font-mono text-[11px] text-foreground/45 hover:text-foreground">
                  <ExternalLink size={13} /><span className="hidden sm:inline">Original</span>
                </a>
              )}
            </div>
          )}
        </div>
      </nav>
      <div ref={box} style={{ height: h }} className="w-full">
        {page.error ? <p className="px-4 py-8 text-[14px] text-loss sm:px-8">{(page.error as Error).message || "Couldn't load this report."}</p>
          : !doc ? <div className="mx-4 mt-5 h-40 animate-pulse bg-foreground/[0.03] sm:mx-8" />
          : <iframe key={current!.slug + day + page.data!.published_at + theme} title={page.data!.title} srcDoc={doc}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
              className="block h-full w-full border-0 bg-background" />}
      </div>
    </>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={null}><Reports /></Suspense>;
}
