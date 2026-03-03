"use client";
import Link from "next/link";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// TODO: PAYWALL
//
// Gate authenticated app routes behind a subscription check.
// Suggested implementation:
//
//  1. Plans & Pricing
//     - Free tier  : landing page only (read-only demo data)
//     - Pro  ($X/mo): full platform access (live flow, GEX, heatmap, journal)
//     - Team ($Y/mo): multi-user seats + API access
//
//  2. Payment provider
//     - Stripe Checkout / Stripe Billing (subscriptions + webhooks)
//     - Store `stripe_customer_id`, `plan`, `status`, `period_end` on the User model
//
//  3. Backend (FastAPI / app.py)
//     - POST /billing/checkout  → create Stripe Checkout session, return URL
//     - POST /billing/portal    → create Stripe Customer Portal session
//     - POST /billing/webhook   → handle checkout.session.completed,
//                                  customer.subscription.updated/deleted
//     - GET  /billing/status    → return { plan, status, period_end }
//
//  4. Frontend middleware (web/middleware.ts)
//     - On every request to /(app)/* check subscription status via JWT claim or
//       a quick /billing/status fetch; redirect to /pricing if not subscribed.
//
//  5. Pricing page  (web/app/pricing/page.tsx)
//     - Show plan cards with feature lists and "Subscribe" CTA
//     - On click → call /billing/checkout → redirect to Stripe-hosted page
//     - After payment → Stripe webhook updates DB → user lands on /dashboard
//
//  6. Account / billing settings  (web/app/(app)/settings/billing/page.tsx)
//     - Show current plan + renewal date
//     - "Manage Subscription" → call /billing/portal → redirect to Stripe portal
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Animation helpers ─────────────────────────────────────────────────────────

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.6, delay }}>
      {children}
    </motion.div>
  );
}

// ── Particle field ────────────────────────────────────────────────────────────

const PARTICLES = Array.from({ length: 120 }, (_, i) => ({
  id: i,
  x:  (i * 37 + 11) % 100,   // deterministic spread, no Math.random (SSR safe)
  y:  (i * 53 + 7)  % 100,
  r:  0.8 + (i % 4) * 0.5,   // 0.8px / 1.3px / 1.8px / 2.3px
  dur: 5 + (i % 9) * 1.8,    // 5-19s orbit
  dx:  ((i % 7) - 3) * 16,   // -48 to +48 px drift
  dy:  ((i % 5) - 2) * 13,   // -26 to +26 px drift
  delay: (i * 0.27) % 5,
}));

function ParticleField() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {PARTICLES.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-full"
          style={{
            left:   `${p.x}%`,
            top:    `${p.y}%`,
            width:  p.r * 2,
            height: p.r * 2,
            background: p.id % 3 === 0
              ? "rgba(99,130,248,0.55)"
              : p.id % 3 === 1
              ? "rgba(148,97,251,0.45)"
              : "rgba(245,158,11,0.4)",
            boxShadow: `0 0 ${p.r * 4}px ${p.r}px ${p.id % 3 === 0 ? "rgba(99,130,248,0.3)" : p.id % 3 === 1 ? "rgba(148,97,251,0.25)" : "rgba(245,158,11,0.25)"}`,
          }}
          animate={{
            x: [0, p.dx, -p.dx * 0.6, 0],
            y: [0, p.dy, p.dy * 0.4, 0],
            opacity: [0.3, 0.9, 0.5, 0.3],
            scale:   [1, 1.4, 0.8, 1],
          }}
          transition={{
            duration: p.dur,
            delay:    p.delay,
            repeat:   Infinity,
            ease:     "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
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
    icon: "📈",
    title: "Weekly Options Portfolio",
    desc: "Track your covered calls and cash-secured puts week by week. Effective premium = (strike − avg cost) + pre-collected, so you always know your real yield.",
    color: "from-violet-500/20 to-violet-600/5",
    border: "border-violet-500/30",
    tag: "Options Portfolio",
    tagColor: "bg-violet-500/15 text-violet-400",
  },
  {
    icon: "🌍",
    title: "Markets",
    desc: "Sector heatmaps sized by market cap, live VIX + India VIX charts, market breadth, fear & greed proxy, top movers, and all 11 SPDR sector ETFs in one view.",
    color: "from-white/5 to-transparent",
    border: "border-white/10",
    tag: "Market Overview",
    tagColor: "bg-white/10 text-white/60",
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
    color: "from-white/5 to-transparent",
    border: "border-white/10",
    tag: "Execution",
    tagColor: "bg-white/10 text-white/60",
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
    icon: "💳",
    title: "Budget & Spending",
    desc: "Income vs expenses separated cleanly. Credit card charges, Robinhood Gold, recurring bills with end dates, category annual cards, and savings rate — all in one dashboard.",
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
    icon: "🤖",
    title: "AI Assistant",
    desc: "Ask questions about your portfolio, trades, and holdings. Powered by Gemini — fully aware of your positions, P/L, and cost basis in real time.",
    color: "from-pink-500/20 to-pink-600/5",
    border: "border-pink-500/30",
    tag: "AI",
    tagColor: "bg-pink-500/15 text-pink-400",
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
  { value: "10",   label: "App Pages"         },
  { value: "11",   label: "Sector ETFs"       },
  { value: "500+", label: "Symbols Tracked"   },
  { value: "v1.8", label: "Latest Release"    },
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
          <span className="font-black text-white tracking-tight text-lg">Option<span className="text-amber-400">Flow</span></span>
        </div>
        {/* CTA */}
        <div className="flex items-center gap-3">
          <Link href="/login"
            className="text-sm px-4 py-1.5 rounded-lg bg-white text-black font-semibold hover:bg-white/90 transition">
            Sign in
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  const { scrollY } = useScroll();
  const blobY = useTransform(scrollY, [0, 400], [0, -60]);

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center text-center px-5 overflow-hidden">
      {/* Background glow blobs — parallax */}
      <motion.div className="absolute inset-0 pointer-events-none" style={{ y: blobY }}>
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-white/[0.03] blur-[140px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-amber-500/5 blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "64px 64px" }} />
      </motion.div>

      {/* Floating particles */}
      <ParticleField />

      <div className="relative max-w-4xl mx-auto">
        {/* Brand name — staggered letter entrance */}
        <motion.div className="flex items-center justify-center gap-3 mb-4"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <motion.svg width="36" height="36" viewBox="0 0 24 24" fill="#F59E0B"
            className="drop-shadow-[0_0_12px_rgba(245,158,11,0.8)] shrink-0"
            animate={{ rotate: [0, -8, 8, -4, 0] }}
            transition={{ delay: 0.8, duration: 0.6, ease: "easeInOut" }}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </motion.svg>
          <span className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight text-white">
            Option<span className="text-amber-400">Flow</span>
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          className="text-2xl sm:text-4xl lg:text-5xl font-black text-white leading-[1.1] tracking-tight mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}>
          Trade smarter with{" "}
          <span className="text-amber-400">
            real edge
          </span>
        </motion.h1>

        {/* Sub */}
        <motion.p
          className="text-base sm:text-xl text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}>
          OptionFlow is a full-stack trading analytics platform — options flow, weekly covered call portfolio,
          sector heatmaps, trade journaling, budget tracking, and AI-powered portfolio analysis in one place.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}>
          <Link href="/login"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-white text-black font-bold text-base hover:bg-white/90 hover:scale-[1.03] active:scale-[0.97] transition-all">
            Sign in →
          </Link>
        </motion.div>
      </div>

      {/* Scroll hint */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/50"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.6 }}
        style={{ animationName: "bounce" }}>
        <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
        </motion.div>
      </motion.div>
    </section>
  );
}

function Stats() {
  return (
    <section className="py-12 border-y border-white/5 bg-white/[0.02]">
      <div className="max-w-4xl mx-auto px-5 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
        {STATS.map(({ value, label }, i) => (
          <FadeUp key={label} delay={i * 0.1}>
            <p className="text-3xl sm:text-4xl font-black text-white mb-1">{value}</p>
            <p className="text-xs text-white/50 uppercase tracking-widest font-semibold">{label}</p>
          </FadeUp>
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
        <FadeUp className="text-center mb-16">
          <p className="text-xs font-bold text-foreground/50 uppercase tracking-widest mb-3">Everything you need</p>
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4">
            Built for serious traders
          </h2>
          <p className="text-white/60 max-w-xl mx-auto text-base">
            From options flow to double-entry accounting — every feature you need to trade with conviction.
          </p>
        </FadeUp>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f, i) => (
            <FadeUp key={f.title} delay={i * 0.07}>
              <motion.div
                className={`relative rounded-2xl border ${f.border} bg-gradient-to-b ${f.color} p-5 flex flex-col gap-3 h-full`}
                whileHover={{ scale: 1.03, y: -4 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}>
                <div className="text-2xl">{f.icon}</div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="font-bold text-white text-sm">{f.title}</h3>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.tagColor}`}>{f.tag}</span>
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            </FadeUp>
          ))}
        </div>
      </div>
    </section>
  );
}

function Highlight() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section className="py-24 px-5 bg-white/[0.015] border-y border-white/5" ref={ref}>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: text */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">⚡ Core Product</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
            Options Flow is the edge<br />most traders don&apos;t have
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-8">
            Gamma exposure tells you where dealers are hedged and where they&apos;re not.
            OptionFlow surfaces GEX across any ticker — so you can see the magnetic levels,
            flip points, and vol regime before you size in.
          </p>
          <ul className="space-y-3">
            {[
              "GEX by strike — see where dealers are long/short gamma",
              "Dealer net positioning across the full options chain",
              "Multi-ticker panels — compare any symbols side by side",
              "Call / put wall identification at a glance",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                <span className="mt-0.5 text-amber-400 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Right: GEX heatmap snapshot */}
        <motion.div
          className="relative rounded-2xl border border-amber-500/20 bg-[#0f1018] p-5 shadow-2xl"
          initial={{ opacity: 0, x: 40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}>
          {/* Window chrome */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
              </div>
              <span className="text-[10px] text-white/50 ml-1 font-mono">optionflow · GEX · SPY</span>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-bold tracking-wide">● LIVE</span>
          </div>

          {/* Stat row */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: "Net GEX",    value: "+$2.4B",  color: "text-green-400",  bg: "bg-green-500/10"  },
              { label: "Call Wall",  value: "580",      color: "text-green-400",  bg: "bg-green-500/10"  },
              { label: "Put Wall",   value: "550",      color: "text-red-400",    bg: "bg-red-500/10"    },
              { label: "Flip",       value: "565",      color: "text-amber-400",  bg: "bg-amber-500/10"  },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-lg p-2 text-center`}>
                <p className="text-[8px] text-white/50 uppercase tracking-wide mb-0.5">{label}</p>
                <p className={`text-xs font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* GEX heatmap grid — strikes × expiry */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] text-white/50 uppercase tracking-widest mb-1.5">Strike →</span>
              <span className="text-[8px] text-white/50 uppercase tracking-widest">← Expiry</span>
            </div>
            {/* Header row */}
            <div className="grid mb-1" style={{ gridTemplateColumns: "40px repeat(10, 1fr)" }}>
              <span />
              {[545,550,555,560,565,570,575,580,585,590].map(s => (
                <span key={s} className="text-[7px] text-white/50 text-center">{s}</span>
              ))}
            </div>
            {/* Heatmap rows */}
            {[
              { exp: "0DTE",  vals: [5,15,80,95,100,85,40,20,10,5]  },
              { exp: "1W",    vals: [8,20,55,75,90,70,45,25,12,6]   },
              { exp: "2W",    vals: [10,25,45,60,70,55,38,20,10,5]  },
              { exp: "1M",    vals: [6,15,30,45,55,42,28,15,8,4]    },
              { exp: "2M",    vals: [4,10,20,30,38,30,20,10,5,3]    },
            ].map(({ exp, vals }) => (
              <div key={exp} className="grid mb-0.5 items-center" style={{ gridTemplateColumns: "40px repeat(10, 1fr)" }}>
                <span className="text-[8px] text-white/50 font-mono">{exp}</span>
                {vals.map((v, i) => {
                  const isCall = i >= 5;
                  const intensity = v / 100;
                  const bg = isCall
                    ? `rgba(34,197,94,${intensity * 0.7})`
                    : `rgba(239,68,68,${intensity * 0.7})`;
                  return (
                    <div key={i} className="h-5 rounded-sm mx-px flex items-center justify-center"
                      style={{ background: bg }}>
                      {v > 40 && <span className="text-[6px] font-bold text-white/80">{v}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Axis label */}
            <div className="flex justify-end gap-4 mt-2">
              <span className="flex items-center gap-1 text-[8px] text-red-400"><span className="w-2 h-2 rounded-sm bg-red-500/50 inline-block" />Negative GEX</span>
              <span className="flex items-center gap-1 text-[8px] text-green-400"><span className="w-2 h-2 rounded-sm bg-green-500/50 inline-block" />Positive GEX</span>
            </div>
          </div>

          {/* Bottom bar chart — net GEX by strike */}
          <div className="border-t border-white/5 pt-3">
            <p className="text-[8px] text-white/50 uppercase tracking-widest mb-2">Net GEX by Strike ($M)</p>
            <div className="flex items-end gap-0.5 h-12">
              {[-20,-45,-80,-120,-60,40,90,150,110,70].map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end">
                  {v > 0
                    ? <div className="w-full rounded-t-sm" style={{ height: `${(v/150)*100}%`, background: "#22c55e90" }} />
                    : <div className="w-full rounded-b-sm self-start" style={{ height: `${(Math.abs(v)/150)*100}%`, background: "#ef444490", marginTop: "auto" }} />
                  }
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[7px] text-white/50 mt-1">
              {[545,550,555,560,565,570,575,580,585,590].map(s => <span key={s}>{s}</span>)}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function HeatmapHighlight() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section className="py-24 px-5" ref={ref}>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: mock heatmap */}
        <motion.div
          className="rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-500/10 to-transparent p-6 order-2 lg:order-1"
          initial={{ opacity: 0, x: -40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}>
          <p className="text-xs font-bold text-white/50 uppercase tracking-widest mb-4">Technology Sector</p>
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
          <div className="mt-4 flex items-center gap-4 text-[9px] text-white/50">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500/60 inline-block" /> Gaining</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/60 inline-block" /> Declining</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500/60 inline-block" /> Flat</span>
            <span className="ml-auto">Sized by market cap</span>
          </div>
        </motion.div>

        {/* Right: text */}
        <motion.div
          className="order-1 lg:order-2"
          initial={{ opacity: 0, x: 40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3">🌍 Markets Page</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
            The whole market,<br />at a glance
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-8">
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
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                <span className="mt-0.5 text-blue-400 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

function WeeklyPortfolioHighlight() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section className="py-24 px-5 bg-white/[0.015] border-y border-white/5" ref={ref}>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: text */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}>
          <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">📈 Weekly Options Portfolio</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
            Know your real yield,<br />not just the premium
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-8">
            Most traders only see the premium collected this week. OptionFlow shows you
            the <span className="text-white/90 font-semibold">effective premium</span> — your true economic
            gain per share if called away, accounting for every dollar collected since you bought the stock.
          </p>
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-5 py-4 mb-6 font-mono text-sm">
            <p className="text-white/50 text-xs uppercase tracking-widest mb-2">Formula</p>
            <p className="text-violet-300 font-bold">Eff Prem = (strike − avg cost) + pre-collected</p>
            <p className="text-white/40 text-xs mt-1">× contracts × 100 shares</p>
          </div>
          <ul className="space-y-3">
            {[
              "Weekly position tracker with roll & carry-forward support",
              "Moneyness: ITM / ATM / OTM from live spot price",
              "Intrinsic & extrinsic value computed per position",
              "Premium ledger tracks every dollar collected per holding",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                <span className="mt-0.5 text-violet-400 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Right: mock portfolio card */}
        <motion.div
          className="relative rounded-2xl border border-violet-500/20 bg-[#0f1018] p-5 shadow-2xl"
          initial={{ opacity: 0, x: 40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}>
          {/* Window chrome */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
              </div>
              <span className="text-[10px] text-white/50 ml-1 font-mono">optionflow · weekly portfolio · Week 9</span>
            </div>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-bold tracking-wide">Mar 2026</span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: "Eff Prem",    value: "$2,340",  color: "text-violet-400", bg: "bg-violet-500/10" },
              { label: "Premium In",  value: "$1,180",  color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Positions",   value: "4 active", color: "text-white/80",  bg: "bg-white/5" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-lg p-2 text-center`}>
                <p className="text-[8px] text-white/50 uppercase tracking-wide mb-0.5">{label}</p>
                <p className={`text-xs font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Position rows */}
          <div className="space-y-1.5 mb-3">
            <div className="grid text-[8px] text-white/40 uppercase tracking-widest px-1 mb-1" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
              <span>Symbol</span><span className="text-center">Strike</span><span className="text-center">Prem</span><span className="text-center">Eff Prem</span><span className="text-center">Status</span>
            </div>
            {[
              { sym: "AAPL", strike: "$210", prem: "$2.40", eff: "$18.20", status: "OTM",  sc: "text-green-400",  sb: "bg-green-500/10" },
              { sym: "MSFT", strike: "$420", prem: "$3.10", eff: "$31.50", status: "OTM",  sc: "text-green-400",  sb: "bg-green-500/10" },
              { sym: "NVDA", strike: "$135", prem: "$4.80", eff: "$12.80", status: "ATM",  sc: "text-amber-400",  sb: "bg-amber-500/10" },
              { sym: "TSLA", strike: "$280", prem: "$6.20", eff: "$8.40",  status: "ITM",  sc: "text-red-400",    sb: "bg-red-500/10"   },
            ].map((p) => (
              <div key={p.sym} className="grid items-center bg-white/[0.03] rounded-lg px-3 py-2" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
                <span className="text-[10px] font-bold text-white">{p.sym}</span>
                <span className="text-[10px] text-white/70 text-center">{p.strike}</span>
                <span className="text-[10px] text-emerald-400 text-center">{p.prem}</span>
                <span className="text-[10px] text-violet-400 font-bold text-center">{p.eff}</span>
                <span className={`text-[8px] font-bold text-center px-1.5 py-0.5 rounded-full ${p.sb} ${p.sc}`}>{p.status}</span>
              </div>
            ))}
          </div>
          <p className="text-[8px] text-white/30 text-right">Eff Prem = (strike − avg cost) + pre-collected / share</p>
        </motion.div>
      </div>
    </section>
  );
}

function BudgetHighlight() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <section className="py-24 px-5" ref={ref}>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: mock budget card */}
        <motion.div
          className="rounded-2xl border border-orange-500/20 bg-[#0f1018] p-5 shadow-2xl order-2 lg:order-1"
          initial={{ opacity: 0, x: -40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-mono text-white/50">Budget · March 2026</span>
            <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 font-bold">v1.8</span>
          </div>
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: "Income",   value: "$8,400",  color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Expenses", value: "$3,210",  color: "text-red-400",     bg: "bg-red-500/10"     },
              { label: "Savings",  value: "61.8%",   color: "text-amber-400",   bg: "bg-amber-500/10"   },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-lg p-2 text-center`}>
                <p className="text-[8px] text-white/50 uppercase tracking-wide mb-0.5">{label}</p>
                <p className={`text-xs font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
          {/* Category bars */}
          <div className="space-y-2">
            {[
              { cat: "Rent",       spent: 1500, budget: 1500, color: "#f59e0b" },
              { cat: "Groceries",  spent: 420,  budget: 500,  color: "#22c55e" },
              { cat: "Dining",     spent: 310,  budget: 300,  color: "#ef4444" },
              { cat: "Transport",  spent: 180,  budget: 250,  color: "#22c55e" },
              { cat: "CC Charges", spent: 640,  budget: 700,  color: "#a78bfa" },
            ].map(({ cat, spent, budget, color }) => (
              <div key={cat}>
                <div className="flex justify-between text-[9px] text-white/60 mb-1">
                  <span>{cat}</span>
                  <span style={{ color }}>${spent} <span className="text-white/30">/ ${budget}</span></span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((spent/budget)*100, 100)}%`, background: color + "cc" }} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right: text */}
        <motion.div
          className="order-1 lg:order-2"
          initial={{ opacity: 0, x: 40 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}>
          <p className="text-xs font-bold text-orange-400 uppercase tracking-widest mb-3">💳 Budget & Spending</p>
          <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight mb-5">
            Your full financial<br />picture, not just trades
          </h2>
          <p className="text-white/60 text-base leading-relaxed mb-8">
            Income and expenses are tracked separately. Credit card charges, Robinhood Gold,
            recurring bills — everything flows into a clean monthly dashboard with savings rate
            and category-level annual breakdowns.
          </p>
          <ul className="space-y-3">
            {[
              "Income separated from expenses — no bleed-through",
              "Credit card charges tracked as a dedicated expense bucket",
              "Recurring entries with end-date dropdowns (no invisible Safari inputs)",
              "Category annual cards with monthly bar charts",
              "Savings rate widget — income minus all real costs",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                <span className="mt-0.5 text-orange-400 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-24 px-5">
      <div className="max-w-3xl mx-auto text-center">
        <FadeUp>
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
            <p className="text-white/60 mb-8 text-base">
              Sign up free. No credit card required. Start tracking your trades and options flow in minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/login"
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold text-base hover:opacity-90 transition shadow-xl shadow-blue-900/40">
                Sign in →
              </Link>
            </div>
          </div>
        </div>
        </FadeUp>
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
          <span className="font-black text-white text-sm">Option<span className="text-amber-400">Flow</span></span>
          <span className="text-white/50 text-xs ml-2">© 2026</span>
        </div>
        <p className="text-xs text-white/50">Options Flow · Weekly Portfolio · Trade Journal · Budget · AI Assistant · Market Intelligence</p>
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
        <WeeklyPortfolioHighlight />
        <BudgetHighlight />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

