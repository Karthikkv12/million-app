/**
 * Sector baskets for the Dashboard's Sectors section: each SPDR sector ETF and the
 * key stocks shown in its heatmap. `weight` ≈ market cap in $B (tile sizing only).
 */
export interface StockTile { symbol: string; name: string; weight: number }

export type SectorKey =
  | "mag7" | "technology" | "finance" | "consumer"
  | "media" | "healthcare" | "telecom" | "energy"
  | "industrials" | "staples" | "materials" | "realestate" | "utilities";

export const SECTORS: Record<SectorKey, { label: string; stocks: StockTile[] }> = {
  mag7: {
    label: "Magnificent 7",
    stocks: [
      { symbol: "AAPL",  name: "Apple",     weight: 3700 },
      { symbol: "MSFT",  name: "Microsoft", weight: 3100 },
      { symbol: "NVDA",  name: "Nvidia",    weight: 2900 },
      { symbol: "AMZN",  name: "Amazon",    weight: 2300 },
      { symbol: "GOOGL", name: "Alphabet",  weight: 2200 },
      { symbol: "META",  name: "Meta",      weight: 1700 },
      { symbol: "TSLA",  name: "Tesla",     weight:  900 },
    ],
  },
  technology: {
    label: "Technology",
    stocks: [
      { symbol: "AAPL",  name: "Apple",      weight: 3700 },
      { symbol: "MSFT",  name: "Microsoft",  weight: 3100 },
      { symbol: "NVDA",  name: "Nvidia",     weight: 2900 },
      { symbol: "TSM",   name: "TSMC",       weight: 1050 },
      { symbol: "AVGO",  name: "Broadcom",   weight:  900 },
      { symbol: "ORCL",  name: "Oracle",     weight:  550 },
      { symbol: "AMD",   name: "AMD",        weight:  320 },
      { symbol: "CRM",   name: "Salesforce", weight:  300 },
      { symbol: "QCOM",  name: "Qualcomm",   weight:  190 },
      { symbol: "INTC",  name: "Intel",      weight:   90 },
    ],
  },
  finance: {
    label: "Financials",
    stocks: [
      { symbol: "BRK-B", name: "Berkshire",   weight: 1000 },
      { symbol: "JPM",   name: "JPMorgan",    weight:  720 },
      { symbol: "V",     name: "Visa",        weight:  570 },
      { symbol: "MA",    name: "Mastercard",  weight:  480 },
      { symbol: "BAC",   name: "Bank of Am.", weight:  370 },
      { symbol: "GS",    name: "Goldman",     weight:  220 },
      { symbol: "MS",    name: "Morgan St.",  weight:  210 },
      { symbol: "WFC",   name: "Wells Fargo", weight:  230 },
      { symbol: "BLK",   name: "BlackRock",   weight:  160 },
      { symbol: "PYPL",  name: "PayPal",      weight:   70 },
    ],
  },
  consumer: {
    label: "Consumer discretionary",
    stocks: [
      { symbol: "AMZN", name: "Amazon",     weight: 2300 },
      { symbol: "TSLA", name: "Tesla",      weight:  900 },
      { symbol: "HD",   name: "Home Depot", weight:  400 },
      { symbol: "MCD",  name: "McDonald's", weight:  215 },
      { symbol: "BKNG", name: "Booking",    weight:  170 },
      { symbol: "TJX",  name: "TJX",        weight:  150 },
      { symbol: "LOW",  name: "Lowe's",     weight:  140 },
      { symbol: "NKE",  name: "Nike",       weight:  110 },
      { symbol: "SBUX", name: "Starbucks",  weight:  100 },
      { symbol: "CMG",  name: "Chipotle",   weight:   60 },
    ],
  },
  staples: {
    label: "Consumer staples",
    stocks: [
      { symbol: "WMT",  name: "Walmart",     weight: 750 },
      { symbol: "COST", name: "Costco",      weight: 430 },
      { symbol: "PG",   name: "P&G",         weight: 390 },
      { symbol: "KO",   name: "Coca-Cola",   weight: 270 },
      { symbol: "PM",   name: "Philip M.",   weight: 240 },
      { symbol: "PEP",  name: "PepsiCo",     weight: 200 },
      { symbol: "MO",   name: "Altria",      weight: 100 },
      { symbol: "MDLZ", name: "Mondelez",    weight:  80 },
      { symbol: "CL",   name: "Colgate",     weight:  70 },
      { symbol: "TGT",  name: "Target",      weight:  45 },
    ],
  },
  industrials: {
    label: "Industrials",
    stocks: [
      { symbol: "GE",   name: "GE Aero",     weight: 300 },
      { symbol: "CAT",  name: "Caterpillar", weight: 250 },
      { symbol: "RTX",  name: "RTX",         weight: 220 },
      { symbol: "UBER", name: "Uber",        weight: 190 },
      { symbol: "HON",  name: "Honeywell",   weight: 130 },
      { symbol: "BA",   name: "Boeing",      weight: 160 },
      { symbol: "UNP",  name: "Union Pac.",  weight: 135 },
      { symbol: "DE",   name: "Deere",       weight: 130 },
      { symbol: "LMT",  name: "Lockheed",    weight: 110 },
      { symbol: "UPS",  name: "UPS",         weight:  80 },
    ],
  },
  materials: {
    label: "Materials",
    stocks: [
      { symbol: "LIN",  name: "Linde",       weight: 210 },
      { symbol: "SHW",  name: "Sherwin-W.",  weight:  85 },
      { symbol: "ECL",  name: "Ecolab",      weight:  75 },
      { symbol: "APD",  name: "Air Prod.",   weight:  60 },
      { symbol: "FCX",  name: "Freeport",    weight:  60 },
      { symbol: "NEM",  name: "Newmont",     weight:  90 },
      { symbol: "CTVA", name: "Corteva",     weight:  45 },
      { symbol: "DOW",  name: "Dow",         weight:  15 },
      { symbol: "NUE",  name: "Nucor",       weight:  35 },
      { symbol: "MP",   name: "MP Materials",weight:  10 },
    ],
  },
  realestate: {
    label: "Real estate",
    stocks: [
      { symbol: "PLD",  name: "Prologis",    weight: 105 },
      { symbol: "WELL", name: "Welltower",   weight: 110 },
      { symbol: "AMT",  name: "Amer. Tower", weight:  85 },
      { symbol: "EQIX", name: "Equinix",     weight:  75 },
      { symbol: "SPG",  name: "Simon Prop.", weight:  60 },
      { symbol: "O",    name: "Realty Inc.", weight:  52 },
      { symbol: "PSA",  name: "Public Stor.",weight:  48 },
      { symbol: "DLR",  name: "Digital Rlty",weight:  55 },
      { symbol: "CCI",  name: "Crown Castle",weight:  42 },
    ],
  },
  utilities: {
    label: "Utilities",
    stocks: [
      { symbol: "NEE",  name: "NextEra",     weight: 160 },
      { symbol: "SO",   name: "Southern",    weight: 100 },
      { symbol: "CEG",  name: "Constell.",   weight: 100 },
      { symbol: "DUK",  name: "Duke",        weight:  95 },
      { symbol: "VST",  name: "Vistra",      weight:  65 },
      { symbol: "AEP",  name: "AEP",         weight:  60 },
      { symbol: "D",    name: "Dominion",    weight:  50 },
      { symbol: "SRE",  name: "Sempra",      weight:  55 },
      { symbol: "EXC",  name: "Exelon",      weight:  45 },
    ],
  },
  media: {
    label: "Media & Entertainment",
    stocks: [
      { symbol: "GOOGL", name: "Alphabet",  weight: 2200 },
      { symbol: "META",  name: "Meta",      weight: 1700 },
      { symbol: "NFLX",  name: "Netflix",   weight:  430 },
      { symbol: "DIS",   name: "Disney",    weight:  200 },
      { symbol: "SPOT",  name: "Spotify",   weight:  100 },
      { symbol: "RBLX",  name: "Roblox",    weight:   90 },
      { symbol: "TTWO",  name: "Take-Two",  weight:   30 },
      { symbol: "LYV",   name: "Live Nat.", weight:   35 },
      { symbol: "TKO",   name: "TKO Group", weight:   30 },
    ],
  },
  healthcare: {
    label: "Healthcare",
    stocks: [
      { symbol: "LLY",  name: "Eli Lilly",  weight: 750 },
      { symbol: "UNH",  name: "UnitedHlth", weight: 450 },
      { symbol: "JNJ",  name: "J&J",        weight: 380 },
      { symbol: "ABBV", name: "AbbVie",     weight: 320 },
      { symbol: "MRK",  name: "Merck",      weight: 240 },
      { symbol: "TMO",  name: "Thermo F.",  weight: 180 },
      { symbol: "ABT",  name: "Abbott",     weight: 175 },
      { symbol: "AMGN", name: "Amgen",      weight: 165 },
      { symbol: "PFE",  name: "Pfizer",     weight: 155 },
      { symbol: "CVS",  name: "CVS",        weight:  75 },
    ],
  },
  telecom: {
    label: "Telecom",
    stocks: [
      { symbol: "TMUS",  name: "T-Mobile",  weight: 280 },
      { symbol: "VZ",    name: "Verizon",   weight: 170 },
      { symbol: "CMCSA", name: "Comcast",   weight: 155 },
      { symbol: "T",     name: "AT&T",      weight: 145 },
      { symbol: "CHTR",  name: "Charter",   weight:  50 },
    ],
  },
  energy: {
    label: "Energy",
    stocks: [
      { symbol: "XOM",  name: "ExxonMobil", weight: 520 },
      { symbol: "CVX",  name: "Chevron",    weight: 280 },
      { symbol: "COP",  name: "ConocoPhil", weight: 145 },
      { symbol: "EOG",  name: "EOG Res.",   weight:  65 },
      { symbol: "SLB",  name: "SLB",        weight:  60 },
      { symbol: "MPC",  name: "Marathon",   weight:  50 },
      { symbol: "PSX",  name: "Phillips66", weight:  45 },
      { symbol: "OXY",  name: "Occidental", weight:  45 },
    ],
  },
};

/** Ranked rows: SPDR sector ETFs, each linked to its stock basket where we have one. */
export const SECTOR_ROWS: { etf: string | null; label: string; baskets?: SectorKey[] }[] = [
  { etf: null,   label: "Magnificent 7",          baskets: ["mag7"] },   // no ETF: cap-weighted basket move
  { etf: "XLK",  label: "Technology",             baskets: ["technology"] },
  { etf: "XLC",  label: "Communication",          baskets: ["media", "telecom"] },
  { etf: "XLY",  label: "Consumer discretionary", baskets: ["consumer"] },
  { etf: "XLF",  label: "Financials",             baskets: ["finance"] },
  { etf: "XLV",  label: "Health care",            baskets: ["healthcare"] },
  { etf: "XLE",  label: "Energy",                 baskets: ["energy"] },
  { etf: "XLI",  label: "Industrials",            baskets: ["industrials"] },
  { etf: "XLP",  label: "Consumer staples",       baskets: ["staples"] },
  { etf: "XLB",  label: "Materials",              baskets: ["materials"] },
  { etf: "XLRE", label: "Real estate",            baskets: ["realestate"] },
  { etf: "XLU",  label: "Utilities",              baskets: ["utilities"] },
];
