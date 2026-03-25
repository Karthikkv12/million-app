// ── THIS FILE IS AUTO-SPLIT — edit components in /web/components/trades/ ──────
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWeeks, getOrCreateWeek, WeeklySnapshot } from "@/lib/api";
import { BarChart2 } from "lucide-react";
import { PageHeader, EmptyState, Tabs, RefreshButton } from "@/components/ui";

import { PositionsTab } from "@/components/trades/PositionsTab";
import { SymbolsTab } from "@/components/trades/SymbolsTab";
import { YearTab } from "@/components/trades/YearTab";
import { PremiumTab } from "@/components/trades/PremiumTab";
import { AccountTab } from "@/components/trades/AccountTab";
import { HoldingsTab } from "@/components/trades/HoldingsTab";
import { WatchlistTab } from "@/components/trades/WatchlistTab";

export default function PortfolioPage() {
  const qc = useQueryClient();
  const {
    data: weeks = [],
    isLoading: weeksLoading,
    refetch: refetchWeeks,
    isFetching: weeksFetching,
  } = useQuery({ queryKey: ["weeks"], queryFn: fetchWeeks, staleTime: 30_000 });

  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [tab, setTab] = useState<"account" | "holdings" | "positions" | "symbols" | "premium" | "year" | "watchlist">("account");
  const [autoSelected, setAutoSelected] = useState(false);

  if (!autoSelected && weeks.length > 0) {
    setSelectedWeekId(weeks[0].id);
    setAutoSelected(true);
  }

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId) ?? weeks[0] ?? null;

  // Find the next Friday not yet in the weeks list, so "New Week" always
  // creates a genuinely new week rather than idempotently returning the current one.
  function nextUnusedFriday(): string {
    const existingEnds = new Set(weeks.map((w) => w.week_end.slice(0, 10)));
    // Start from today; walk forward day-by-day until we hit a Friday not in the list.
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      if (d.getDay() === 5) { // 5 = Friday
        const iso = d.toISOString().slice(0, 10);
        if (!existingEnds.has(iso)) return iso;
      }
      d.setDate(d.getDate() + 1);
    }
    // Fallback: 7 days after the latest week_end
    const latest = weeks[0]?.week_end;
    if (latest) {
      const next = new Date(latest);
      next.setDate(next.getDate() + 7);
      return next.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }

  const newWeekMut = useMutation({
    mutationFn: () => getOrCreateWeek(nextUnusedFriday()),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      setSelectedWeekId(w.id);
    },
    onError: (e: Error) => alert(`Could not create week: ${e.message}`),
  });

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto w-full overflow-x-hidden">
      <PageHeader
        title="Portfolio"
        sub="Weekly tracker — sell options, track premium, manage assignments"
        action={
          <RefreshButton
            onRefresh={() => { refetchWeeks(); qc.invalidateQueries({ queryKey: ["portfolioSummary"] }); }}
            isRefreshing={weeksFetching}
          />
        }
      />



      {!weeksLoading && (
        <div className="mb-5">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as "account" | "holdings" | "positions" | "symbols" | "premium" | "year" | "watchlist")}
            tabs={[
              { key: "account",   label: "Account"     },
              { key: "holdings",  label: "Holdings"    },
              { key: "positions", label: "Positions"   },
              { key: "symbols",   label: "Activity"    },
              { key: "premium",   label: "Premium"     },
              { key: "year",      label: "Performance" },
              { key: "watchlist", label: "Watchlist"   },
            ]}
          />
        </div>
      )}

      {tab === "holdings" && <HoldingsTab />}

      {tab === "positions" && (
        selectedWeek
          ? <PositionsTab week={selectedWeek} />
          : !weeksLoading && (
            <EmptyState
              icon={BarChart2}
              title="No weeks yet"
              body='Click "New Week" to create your first week and start logging positions.'
            />
          )
      )}

      {tab === "symbols"    && <SymbolsTab />}
      {tab === "year"       && <YearTab />}
      {tab === "premium"    && <PremiumTab />}
      {tab === "watchlist"  && <WatchlistTab />}
      {tab === "account"  && <AccountTab weeks={weeks} weeksLoading={weeksLoading} selectedWeekId={selectedWeek?.id ?? null} onSelectWeek={setSelectedWeekId} onNewWeek={() => newWeekMut.mutate()} />}
    </div>
  );
}
