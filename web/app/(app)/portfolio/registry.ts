import { ArrowLeftRight, CalendarDays, Coins, Layers, LayoutGrid, ListChecks, Star, type LucideIcon } from "lucide-react";

export interface PortfolioTabDef {
  id: "overview" | "holdings" | "watchlist" | "options" | "income" | "calendar" | "activity";
  label: string;
  desc: string;
  icon: LucideIcon;
}

/** Every tab except Watchlist reads only Robinhood-synced data; nothing is typed in. */
export const PORTFOLIO_TABS: PortfolioTabDef[] = [
  { id: "overview",  label: "Overview",  desc: "Account value, change since the last sync, and where your money sits.", icon: LayoutGrid },
  { id: "holdings",  label: "Holdings",  desc: "Shares you own, live prices and unrealized P&L.",                     icon: Layers },
  { id: "watchlist", label: "Watchlist", desc: "Tickers you follow, with live quotes.",                              icon: Star },
  { id: "options",   label: "Options",   desc: "Open contracts, premium held and how close each strike is.",         icon: ListChecks },
  { id: "income",    label: "Income",    desc: "Premium collected and realized P&L by week, month and symbol.",       icon: Coins },
  { id: "calendar",  label: "Calendar",  desc: "Realized P&L day by day: what closed, how many trades and how many won.", icon: CalendarDays },
  { id: "activity",  label: "Activity",  desc: "Every option fill and closed trade, from Robinhood.",                icon: ArrowLeftRight },
];
