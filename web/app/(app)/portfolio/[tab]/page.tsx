"use client";
import type { JSX } from "react";
import { notFound, useParams } from "next/navigation";
import { PositionsTab } from "@/components/portfolio/PositionsTab";
import { HoldingsTab } from "@/components/portfolio/HoldingsTab";
import { PerformanceTab } from "@/components/portfolio/PerformanceTab";
import { AccountsTab } from "@/components/portfolio/AccountsTab";
import { WatchlistTab } from "@/components/portfolio/WatchlistTab";

const COMPONENTS: Record<string, () => JSX.Element> = {
  positions: PositionsTab,
  holdings: HoldingsTab,
  performance: PerformanceTab,
  accounts: AccountsTab,
  watchlist: WatchlistTab,
};

export default function PortfolioTabPage() {
  const { tab } = useParams<{ tab: string }>();
  const Body = COMPONENTS[tab];
  if (!Body) notFound();
  return <Body />;
}
