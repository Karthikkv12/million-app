"use client";
import Link from "next/link";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { Logo } from "@/components/Navbar";
import { SampleBoard } from "@/components/marketing/SampleBoard";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

// TODO: PAYWALL — plans, Stripe billing and a /pricing page are planned.
// See the previous version of this file (git history) for the full outline.

const READS = [
  {
    term: "King node",
    body: "The strike and expiry holding the most gamma. Price tends to get pulled toward it, or pinned at it, into expiry.",
    swatch: "bg-[#fde725]",
  },
  {
    term: "Gamma flip",
    body: "Where dealer exposure changes sign. Above it dealers dampen moves; below it they add to them.",
    swatch: "bg-accent",
  },
  {
    term: "Call and put walls",
    body: "The largest positive and negative strikes. They often act as a ceiling and a floor for the session.",
    swatch: "bg-gradient-to-r from-[#35b779] to-[#5a1f80]",
  },
];

const MODULES = [
  { name: "Flow", desc: "Strike × expiry GEX board with king node, spot, flip and walls. Five palettes, including colour-blind safe ones." },
  { name: "Markets", desc: "Sector heatmaps sized by market cap, VIX, breadth and the 11 SPDR sector ETFs." },
  { name: "Dashboard", desc: "Index cards, volatility and the economic calendar for the day ahead." },
];

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

function Nav() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo href="/" />
        <nav className="hidden items-center gap-7 text-sm text-foreground/65 md:flex">
          <a href="#read" className="transition hover:text-foreground">How to read it</a>
          <a href="#modules" className="transition hover:text-foreground">What's inside</a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeButton />
          {user ? (
            <Link href="/options-flow" className="btn-primary h-9 px-4">Open app</Link>
          ) : (
            <Link href="/login" className="btn-primary h-9 px-4">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const { user } = useAuth();
  return (
    <section className="dot-grid relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-24">
        <div className="min-w-0">
          <p className="eyebrow mb-5 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Gamma exposure · dealer positioning</p>
          <h1 className="text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.04em] text-foreground sm:text-6xl">
            See where dealers <span className="gradient-text">have to hedge.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-foreground/65">
            OptionFlow maps gamma exposure across every strike and expiry, so the levels that move price
            (the king node, the flip, the walls) are on screen before you size in.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={user ? "/options-flow" : "/login"} className="btn-primary h-11 px-5">
              {user ? "Open the flow board" : "Sign in"} <ArrowRight size={16} />
            </Link>
            <a href="#read" className="btn-ghost h-11 px-5">How to read the board</a>
          </div>
          <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-foreground/55">
            <li>Any optionable ticker</li>
            <li>Data from Yahoo Finance, ~15 min delayed</li>
            <li>Light and dark</li>
          </ul>
        </div>
        <SampleBoard className="min-w-0" />
      </div>
    </section>
  );
}

function HowToRead() {
  return (
    <section id="read" className="scroll-mt-20 border-t border-[var(--border)]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="eyebrow mb-3 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />How to read it</p>
        <h2 className="max-w-2xl text-balance text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
          Three levels do most of the work.
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
          {READS.map((r) => (
            <div key={r.term} className="grid content-start gap-3 bg-[var(--surface)] p-6">
              <span className={`h-2 w-10 rounded-full ${r.swatch}`} aria-hidden />
              <h3 className="text-lg font-semibold tracking-tight text-foreground">{r.term}</h3>
              <p className="text-[15px] leading-relaxed text-foreground/65">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Modules() {
  return (
    <section id="modules" className="scroll-mt-20 border-t border-[var(--border)] bg-[var(--surface-2)]/50">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="eyebrow mb-3 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />What's inside</p>
        <h2 className="max-w-2xl text-balance text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
          One desk for the options picture.
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.name} className="card overflow-hidden">
              <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-2.5">
                <span className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="h-2 w-2 rounded-full bg-foreground/15" />
                <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/55">OptionFlow / {m.name}</span>
              </div>
              <p className="p-5 text-[15px] leading-relaxed text-foreground/70">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  const { user } = useAuth();
  return (
    <section className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center">
        <h2 className="max-w-xl text-balance text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
          Open the board before the open.
        </h2>
        <Link href={user ? "/options-flow" : "/login"} className="btn-primary h-11 px-5">
          {user ? "Open the flow board" : "Sign in"} <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[13px] text-foreground/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>© 2026 OptionFlow</span>
        <span>For information only, not investment advice. Market data is delayed about 15 minutes.</span>
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
        <HowToRead />
        <Modules />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
