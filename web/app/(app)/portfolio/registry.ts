import { ListChecks, Layers, LineChart, Landmark, Star, type LucideIcon } from "lucide-react";

export interface PortfolioTabDef {
  id: "positions" | "holdings" | "performance" | "accounts" | "watchlist";
  label: string;
  desc: string;
  icon: LucideIcon;
}

export const PORTFOLIO_TABS: PortfolioTabDef[] = [
  { id: "positions",   label: "Positions",   desc: "Options you sold, week by week.",                    icon: ListChecks },
  { id: "holdings",    label: "Holdings",    desc: "Shares you own and how premium lowers their cost.", icon: Layers },
  { id: "performance", label: "Performance", desc: "Premium, realized P&L and your best weeks.",         icon: LineChart },
  { id: "accounts",    label: "Accounts",    desc: "Broker balances and cash in or out.",                icon: Landmark },
  { id: "watchlist",   label: "Watchlist",   desc: "Tickers you follow, with live quotes.",              icon: Star },
];
