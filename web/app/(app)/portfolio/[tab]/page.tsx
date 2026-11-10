"use client";
import type { JSX } from "react";
import { notFound, useParams } from "next/navigation";
import { OverviewTab } from "@/components/portfolio/OverviewTab";
import { HoldingsTab } from "@/components/portfolio/HoldingsTab";
import { OptionsTab } from "@/components/portfolio/OptionsTab";
import { IncomeTab } from "@/components/portfolio/IncomeTab";
import { CalendarTab } from "@/components/portfolio/CalendarTab";
import { ActivityTab } from "@/components/portfolio/ActivityTab";
import { WatchlistTab } from "@/components/portfolio/WatchlistTab";

const COMPONENTS: Record<string, () => JSX.Element | null> = {
  overview: OverviewTab,
  holdings: HoldingsTab,
  options: OptionsTab,
  income: IncomeTab,
  calendar: CalendarTab,
  activity: ActivityTab,
  watchlist: WatchlistTab,
};

export default function PortfolioTabPage() {
  const { tab } = useParams<{ tab: string }>();
  const Body = COMPONENTS[tab];
  if (!Body) notFound();
  return <Body />;
}
