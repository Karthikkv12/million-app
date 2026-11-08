"use client";
import { PageHeader } from "@/components/ui";
import EconomicCalendar from "@/components/catalyst/EconomicCalendar";

export default function CatalystCalendarPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <PageHeader eyebrow="Catalyst" title="Economic calendar" sub="US events that move the whole market: Fed, CPI, jobs, GDP, retail sales." />
      <EconomicCalendar />
    </div>
  );
}
