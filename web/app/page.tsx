"use client";
import Link from "next/link";
import { ArrowRight, Check, Moon, Plus, Sun } from "lucide-react";
import { Logo } from "@/components/Navbar";
import { SampleBoard } from "@/components/marketing/SampleBoard";
import { RegimeCard, SectorTiles, WindowFrame } from "@/components/marketing/Visuals";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

// TODO: PAYWALL — plans, Stripe billing and a /pricing page are planned.
// See this file's git history for the full outline.

// ── Content ──────────────────────────────────────────────────────────────────

const FACTS = [
  { value: "10–40", label: "strikes per board, your choice" },
  { value: "5", label: "colour palettes, two colour-blind safe" },
  { value: "60 s", label: "refresh while the page is open" },
  { value: "~15 min", label: "data delay, shown on every board" },
];

const STEPS = [
  { title: "Pick a ticker", body: "Type any optionable symbol (SPY, QQQ, a single stock) and the board loads every strike and expiry around spot." },
  { title: "Read the levels", body: "The king node, flip and walls are marked for you, with the gamma regime written in plain words above the board." },
  { title: "Plan the session", body: "Use the walls as likely ceiling and floor, the flip as the line where behaviour changes, and size accordingly." },
];

const FAQ = [
  {
    q: "Where does the data come from?",
    a: "Option chains and prices come from Yahoo Finance and are about 15 minutes delayed. Every board says so. A real-time feed is planned as an option.",
  },
  {
    q: "How is gamma exposure calculated?",
    a: "For each contract: gamma × open interest × 100 × spot² × 1%. Calls count as positive, puts as negative, so each cell is the dollar hedging dealers need for a 1% move.",
  },
  {
    q: "Which tickers work?",
    a: "Any US symbol with listed options on Yahoo Finance: index ETFs like SPY and QQQ, indexes like SPX, and single stocks.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes. Every screen works at phone width, and a native app is planned on the same backend.",
  },
  {
    q: "Is this investment advice?",
    a: "No. OptionFlow shows positioning data and how it is usually read. Decisions and risk are yours.",
  },
  {
    q: "How do I get an account?",
    a: "OptionFlow is invite-only for now. Accounts are created by an admin; ask the person who shared the site with you.",
  },
];

// ── Shared bits ──────────────────────────────────────────────────────────────

function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`eyebrow mb-4 flex items-center gap-2 ${className}`}><span className="h-px w-4 bg-current opacity-40" />{children}</p>;
}

function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-foreground/70 transition hover:text-foreground"
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function PrimaryCTA({ size = "lg" }: { size?: "sm" | "lg" }) {
  const { user } = useAuth();
  const cls = size === "lg" ? "btn-primary h-12 px-6 text-[15px]" : "btn-primary h-9 px-4";
  return user
    ? <Link href="/options-flow" className={cls}>Open the flow board <ArrowRight size={16} /></Link>
    : <Link href="/login" className={cls}>Sign in <ArrowRight size={16} /></Link>;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo href="/" />
        <nav className="hidden items-center gap-8 text-sm text-foreground/65 md:flex">
          <a href="#product" className="transition hover:text-foreground">Product</a>
          <a href="#how" className="transition hover:text-foreground">How it works</a>
          <a href="#faq" className="transition hover:text-foreground">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeButton />
          <PrimaryCTA size="sm" />
        </div>
      </Container>
    </header>
  );
}

function Hero() {
  return (
    <section className="dot-grid relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--accent-rgb)/0.10),transparent_70%)]" />
      <Container className="relative pb-6 pt-16 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[13px] text-foreground/70">
          <span className="h-1.5 w-1.5 rounded-full bg-gain" />
          New flow board: every strike × expiry on one screen
        </span>
        <h1 className="mx-auto mt-7 max-w-4xl text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] text-foreground sm:text-7xl">
          See where dealers <span className="gradient-text">have to hedge.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-foreground/65 sm:text-lg">
          OptionFlow maps gamma exposure across every strike and expiry and marks the levels that move price
          (the king node, the gamma flip and the call and put walls) before you size in.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <PrimaryCTA />
          <a href="#how" className="btn-ghost h-12 px-6 text-[15px]">See how it works</a>
        </div>
        <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-foreground/60">
          {["Any optionable ticker", "Yahoo Finance data, ~15 min delayed", "Light and dark, desktop and phone"].map((t) => (
            <li key={t} className="flex items-center gap-1.5"><Check size={14} className="text-gain" />{t}</li>
          ))}
        </ul>
      </Container>

      {/* Product composite */}
      <Container className="relative pb-20 pt-12 sm:pb-28">
        <div className="relative mx-auto max-w-5xl">
          <WindowFrame title="optflw.com / flow / SPY">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
              <SampleBoard bare />
              <aside className="hidden border-l border-[var(--border)] p-5 text-left lg:block">
                <p className="eyebrow mb-3">Dealer read</p>
                <span className="inline-flex rounded-full bg-fuchsia-500/10 px-2.5 py-1 font-mono text-[12px] text-fuchsia-700 dark:text-fuchsia-300">−GEX · Volatile</span>
                <p className="mt-3 text-[14px] leading-relaxed text-foreground/70">
                  Spot sits just under the flip. Dealers are short gamma, so moves can stretch further than usual.
                </p>
                <div className="mt-5 grid gap-2 font-mono text-[12px]">
                  {[["King node", "590 · Nov 21"], ["Call wall", "590"], ["Put wall", "580"], ["Net GEX", "−$1.2B"]].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-t border-[var(--border)] pt-2">
                      <span className="text-foreground/55">{k}</span><span className="tabular-nums text-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </WindowFrame>
        </div>
      </Container>
    </section>
  );
}

function FactsBand() {
  return (
    <section className="bg-[#0b0c10] text-white">
      <Container className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-4">
        {FACTS.map((f) => (
          <div key={f.label}>
            <p className="font-mono text-3xl font-medium tracking-tight sm:text-4xl">{f.value}</p>
            <p className="mt-2 text-[14px] leading-snug text-white/60">{f.label}</p>
          </div>
        ))}
      </Container>
    </section>
  );
}

function Feature({ eyebrow, title, body, points, visual, flip = false, id }: {
  eyebrow: string; title: string; body: string; points: string[]; visual: React.ReactNode; flip?: boolean; id?: string;
}) {
  return (
    <div id={id} className="grid scroll-mt-24 items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : ""}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">{title}</h3>
        <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-foreground/65">{body}</p>
        <ul className="mt-6 grid gap-2.5">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2.5 text-[15px] text-foreground/80">
              <Check size={16} className="mt-0.5 shrink-0 text-gain" />{p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>{visual}</div>
    </div>
  );
}

function Product() {
  return (
    <section id="product" className="scroll-mt-16 border-b border-[var(--border)]">
      <Container className="grid gap-24 py-24 sm:gap-32 sm:py-32">
        <Feature
          eyebrow="Flow board"
          title="Find the king node in a second."
          body="Every strike and expiry on one board, coloured by how much gamma sits there. The biggest cell is starred, spot is marked, and the board centres itself on price."
          points={["Choose 10, 20, 30 or 40 strikes around spot", "Five palettes, including Cividis and Viridis", "“% of king” and “dim small” to cut the noise"]}
          visual={<SampleBoard />}
        />
        <Feature
          flip
          eyebrow="Levels"
          title="Know the regime before the open."
          body="Above the flip, dealers dampen moves. Below it, they add to them. OptionFlow tells you which side you're on and how far the walls are."
          points={["Spot, flip, call wall and put wall in one strip", "Distance to each level in percent", "Net GEX with a plain-language regime label"]}
          visual={<RegimeCard />}
        />
        <Feature
          eyebrow="Dashboard"
          title="Then zoom out to the whole tape."
          body="Sectors ranked by today's move open into heatmaps sized by market cap, next to VIX, rates, the dollar and your own book."
          points={["Sector ETFs ranked, each with its stocks", "Indexes, futures, VIX, 10Y and dollar on one screen", "US economic calendar and unusual options activity under Research"]}
          visual={<SectorTiles />}
        />
      </Container>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="scroll-mt-16 border-b border-[var(--border)] bg-[var(--surface-2)]/60">
      <Container className="py-24">
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">From ticker to plan in three steps.</h2>
        </div>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-strong)] font-mono text-[13px] text-foreground">{i + 1}</span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-foreground/65">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 border-b border-[var(--border)]">
      <Container className="grid gap-12 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">Questions, answered.</h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-foreground/60">
            Anything else? Ask the admin who gave you access.
          </p>
        </div>
        <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-foreground">
                {f.q}
                <Plus size={18} className="shrink-0 text-foreground/50 transition group-open:rotate-45" />
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-foreground/65">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

function AccessBand() {
  return (
    <section className="bg-[#0b0c10] text-white">
      <Container className="relative overflow-hidden py-20">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#2f5bea]/25 blur-3xl" />
        <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div>
            <p className="eyebrow mb-4 flex items-center gap-2 !text-white/50"><span className="h-px w-4 bg-white/40" />Invite-only</p>
            <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Open the board before the open.</h2>
            <p className="mt-3 max-w-lg text-[15px] text-white/60">Accounts are created by an admin. Already have one? Sign in and pick a ticker.</p>
          </div>
          <Link href="/login" className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-black transition hover:bg-white/90">
            Sign in <ArrowRight size={16} />
          </Link>
        </div>
      </Container>
    </section>
  );
}

function Footer() {
  return (
    <footer>
      <Container className="grid gap-10 py-14 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))]">
        <div>
          <Logo href="/" />
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-foreground/55">
            Gamma exposure and dealer positioning for options traders.
          </p>
        </div>
        <div>
          <p className="eyebrow mb-4">Product</p>
          <ul className="grid gap-2.5 text-[14px] text-foreground/65">
            <li><a href="#product" className="hover:text-foreground">Flow board</a></li>
            <li><a href="#product" className="hover:text-foreground">Levels</a></li>
            <li><a href="#product" className="hover:text-foreground">Markets</a></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-4">Account</p>
          <ul className="grid gap-2.5 text-[14px] text-foreground/65">
            <li><Link href="/login" className="hover:text-foreground">Sign in</Link></li>
            <li><a href="#faq" className="hover:text-foreground">Getting access</a></li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-[var(--border)]">
        <Container className="flex flex-col gap-2 py-6 text-[13px] text-foreground/50 sm:flex-row sm:justify-between">
          <span>© 2026 OptionFlow</span>
          <span>For information only, not investment advice. Market data is delayed about 15 minutes.</span>
        </Container>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero />
        <FactsBand />
        <Product />
        <How />
        <Faq />
        <AccessBand />
      </main>
      <Footer />
    </div>
  );
}
