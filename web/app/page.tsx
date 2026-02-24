import Link from "next/link";

// ── Feature data ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "⚡",
    title: "Options Flow",
    desc: "Real-time gamma exposure (GEX), dealer positioning, and options flow across any ticker. See where the smart money is positioned before you trade.",
    color: "from-amber-500/20 to-amber-600/5",
    border: "border-amber-500/30",
    tag: "Core Product",
    tagColor: "bg-amber-500/15 text-amber-400",
  },
  {
    icon: "🌍",
    title: "Markets",
    desc: "Sector heatmaps sized by market cap, live VIX + India VIX charts, market breadth, fear & greed proxy, top movers, and all 11 SPDR sector ETFs in one view.",
    color: "from-blue-500/20 to-blue-600/5",
    border: "border-blue-500/30",
    tag: "Market Overview",
    tagColor: "bg-blue-500/15 text-blue-400",
  },
  {
    icon: "📊",
    title: "Trade Journal",
    desc: "Log every trade with instrument, strategy, entry & exit. Track win rate, average win/loss, best trade, and realized P/L — all computed automatically.",
    color: "from-green-500/20 to-green-600/5",
    border: "border-green-500/30",
    tag: "Journal",
    tagColor: "bg-green-500/15 text-green-400",
  },
  {
    icon: "📋",
    title: "Order Management",
    desc: "Place, fill, and cancel orders with a paper broker. Full order lifecycle from PENDING → FILLED, with strategy tagging and limit price support.",
    color: "from-purple-500/20 to-purple-600/5",
    border: "border-purple-500/30",
    tag: "Execution",
    tagColor: "bg-purple-500/15 text-purple-400",
  },
  {
    icon: "🏦",
    title: "Accounts & Cash",
    desc: "Multi-account portfolio management with a double-entry ledger as the source of truth. Deposit cash, track balances, and view full transaction history.",
    color: "from-emerald-500/20 to-emerald-600/5",
    border: "border-emerald-500/30",
    tag: "Portfolio",
    tagColor: "bg-emerald-500/15 text-emerald-400",
  },
  {
    icon: "💰",
    title: "Budget Tracker",
    desc: "Set monthly spending limits across categories. Visual breakdown with a pie chart, progress bars per category, and running totals vs budget.",
    color: "from-orange-500/20 to-orange-600/5",
    border: "border-orange-500/30",
    tag: "Finance",
    tagColor: "bg-orange-500/15 text-orange-400",
  },
  {
    icon: "🔍",
    title: "Stock Search",
    desc: "Search any ticker and get a full detail page — price history with interactive chart, period selection, current price, and one-click order placement.",
    color: "from-sky-500/20 to-sky-600/5",
    border: "border-sky-500/30",
    tag: "Research",
    tagColor: "bg-sky-500/15 text-sky-400",
  },
  {
    icon: "🔐",
    title: "Security",
    desc: "JWT auth with refresh token rotation, PBKDF2 password hashing, session management, per-device revocation, and a full auth event audit log.",
    color: "from-red-500/20 to-red-600/5",
    border: "border-red-500/30",
    tag: "Auth",
    tagColor: "bg-red-500/15 text-red-400",
  },
];

const STATS = [
  { value: "8",    label: "App Pages"         },
  { value: "11",   label: "Sector ETFs"       },
  { value: "500+", label: "Symbols Tracked"   },
  { value: "∞",    label: "Trades Logged"     },
];

// ── Components ───────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-[#0c0e14]/80 border-b border-white/5">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#F59E0B"
            className="drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span className="font-black text-white tracking-tight text-lg">Million</span>
        </div>
        {/* CTA */}
        <div className="flex items-center gap-3">
          <Link href="/login"
            className="text-sm text-gray-400 hover:text-white transition font-medium">
            Sign in
          </Link>
          <Link href="/signup"
            className="text-sm px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 text-white font-semibold hover:opacity-90 transition shadow-lg shadow-blue-900/30">
            Get started
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-5 overflow-hidden">
      {/* Background glow blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute top-1/2 left-1/4 w-[400px] h-[400px] rounded-full bg-violet-600/10 blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-amber-500/8 blur-[100px]" />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "64px 64px" }} />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Pill badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-semibold mb-6 tracking-wide">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="#F59E0B"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          Options Flow · Trade Journal · Market Intelligence
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight mb-6">
          Trade smarter with{" "}
          <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-amber-400 bg-clip-text text-transparent">
            real edge
          </span>
        </h1>

        {/* Sub */}
        <p className="text-base sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Million is a full-stack trading analytics platform — options flow, sector heatmaps,
          trade journaling, order management, and portfolio tracking in one place.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/signup"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold text-base hover:opacity-90 transition shadow-xl shadow-blue-900/40">
            Start for free →
          </Link>
          <Link href="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-white/10 text-gray-300 font-semibold text-base hover:bg-white/5 transition">
            Sign in
          </Link>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-gray-600 animate-bounce">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="py-12 border-y border-white/5 bg-white/[0.02]">
      <div className="max-w-4xl mx-auto px-5 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
        {STATS.map(({ value, label }) => (
          <div key={label}>
            <p className="text-3xl sm:text-4xl font-black text-white mb-1">{value}</p>
            <p className="text-xs text-gray-500 uppercase tracking-widest font-semibold">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="py-24 px-5">
      <div className="max-w-6xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3">Everything you need</p>
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
            Built for serious traders
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto text-base">
            From options flow to double-entry accounting — every feature you need to trade with conviction.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title}
              className={`relative rounded-2xl border ${f.border} bg-gradient-to-b ${f.color} p-5 flex flex-col gap-3 hover:scale-[1.02] transition-transform duration-200`}>
              <div className="text-2xl">{f.icon}</div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="font-bold text-white text-sm">{f.title}</h3>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.tagColor}`}>{f.tag}</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Highlight() {
  return (
    <section className="py-24 px-5 bg-white/[0.015] border-y border-white/5">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: text */}
        <div>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">⚡ Core Product</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
            Options Flow is the edge<br />most traders don&apos;t have
          </h2>
          <p className="text-gray-400 text-base leading-relaxed mb-8">
            Gamma exposure tells you where dealers are hedged and where they&apos;re not.
            Million surfaces GEX across any ticker — so you can see the magnetic levels,
            flip points, and vol regime before you size in.
          </p>
          <ul className="space-y-3">
            {[
              "GEX by strike — see where dealers are long/short gamma",
              "Dealer net positioning across the full options chain",
              "Multi-ticker panels — compare any symbols side by side",
              "Call / put wall identification at a glance",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-gray-300">
                <span className="mt-0.5 text-amber-400 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: mock UI card */}
        <div className="relative rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/10 to-transparent p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#F59E0B"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              <span className="text-sm font-bold text-white">GEX Flow — SPY</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-bold">LIVE</span>
          </div>
          {/* Fake chart bars */}
          <div className="flex items-end gap-1 h-28 mb-3">
            {[40,65,30,80,55,90,45,70,35,60,85,50,75,40,95,60,45,80,55,70].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm"
                style={{ height: `${h}%`, background: i % 3 === 0 ? "#ef444480" : "#22c55e80" }} />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-gray-500 mb-4">
            <span>400</span><span>420</span><span>440</span><span>460</span><span>480</span><span>500</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Net GEX", value: "+$2.4B", color: "text-green-400" },
              { label: "Call Wall", value: "480", color: "text-blue-400" },
              { label: "Put Wall", value: "450", color: "text-red-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/5 rounded-lg p-2 text-center">
                <p className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</p>
                <p className={`text-sm font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeatmapHighlight() {
  return (
    <section className="py-24 px-5">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: mock heatmap */}
        <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-500/10 to-transparent p-6 order-2 lg:order-1">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Technology Sector</p>
          <div className="space-y-2">
            {[
              [{ label: "AAPL", pct: 38, color: "#22c55e" }, { label: "MSFT", pct: 32, color: "#22c55e" }, { label: "NVDA", pct: 30, color: "#ef4444" }],
              [{ label: "GOOGL", pct: 25, color: "#22c55e" }, { label: "META", pct: 22, color: "#22c55e" }, { label: "AMZN", pct: 28, color: "#eab308" }, { label: "TSLA", pct: 15, color: "#ef4444" }],
              [{ label: "AVGO", pct: 18, color: "#22c55e" }, { label: "AMD", pct: 14, color: "#ef4444" }, { label: "ORCL", pct: 12, color: "#22c55e" }, { label: "ADBE", pct: 10, color: "#eab308" }, { label: "CRM", pct: 10, color: "#22c55e" }],
            ].map((row, ri) => (
              <div key={ri} className="flex gap-1 h-10">
                {row.map(({ label, pct, color }) => (
                  <div key={label} className="flex items-center justify-center rounded text-[9px] font-bold text-white"
                    style={{ width: `${pct}%`, background: color + "40", border: `1px solid ${color}60` }}>
                    {label}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-4 text-[9px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500/60 inline-block" /> Gaining</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/60 inline-block" /> Declining</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500/60 inline-block" /> Flat</span>
            <span className="ml-auto">Sized by market cap</span>
          </div>
        </div>

        {/* Right: text */}
        <div className="order-1 lg:order-2">
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3">🌍 Markets Page</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
            The whole market,<br />at a glance
          </h2>
          <p className="text-gray-400 text-base leading-relaxed mb-8">
            Sector heatmaps sized by real market cap weights, live VIX and India VIX charts,
            market breadth, fear & greed, top movers, and SPDR ETF performance — all on one page.
          </p>
          <ul className="space-y-3">
            {[
              "8 sector heatmaps + Magnificent 7",
              "Tiles proportional to market cap ($B)",
              "VIX + India VIX with X/Y axes and regime badges",
              "Top gainers and losers updated in real time",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-gray-300">
                <span className="mt-0.5 text-blue-400 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-24 px-5">
      <div className="max-w-3xl mx-auto text-center">
        <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-blue-600/15 via-violet-600/10 to-transparent p-12 sm:p-16 overflow-hidden">
          {/* Glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 rounded-full bg-blue-600/20 blur-[80px]" />
          </div>
          <div className="relative">
            <div className="text-4xl mb-4">⚡</div>
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4 tracking-tight">
              Ready to trade with edge?
            </h2>
            <p className="text-gray-400 mb-8 text-base">
              Sign up free. No credit card required. Start tracking your trades and options flow in minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/signup"
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold text-base hover:opacity-90 transition shadow-xl shadow-blue-900/40">
                Create free account →
              </Link>
              <Link href="/login"
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl border border-white/10 text-gray-300 font-semibold text-base hover:bg-white/5 transition">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 py-8 px-5">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#F59E0B"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          <span className="font-black text-white text-sm">Million</span>
          <span className="text-gray-600 text-xs ml-2">© 2026</span>
        </div>
        <p className="text-xs text-gray-600">Options Flow · Trade Journal · Market Intelligence · Portfolio Tracking</p>
      </div>
    </footer>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0c0e14] text-white">
      <Nav />
      <main className="pt-14">
        <Hero />
        <Stats />
        <Features />
        <Highlight />
        <HeatmapHighlight />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

