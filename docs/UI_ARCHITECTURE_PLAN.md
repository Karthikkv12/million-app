# OptionFlow UI Architecture Plan — handoff brief

Written for the Claude Code session that runs on the MacBook. Visual version:
https://claude.ai/artifact/Ep27pPaL9feJhouZKEpqhC (private to the owner).

**Visual direction:** inspired by https://www.skylit.ai, and by the options-flow
heatmap work already built on the MacBook. **That heatmap work is the reference.**
Where it conflicts with the values below, keep what it does and update this plan.

---

## Step 0: Before changing anything

1. Commit the existing heatmap work to a branch (`feat/flow-heatmaps`) and push it.
   Leave out `*.db` and `.env`.
2. Write down the colors, fonts, sizes, radii and panel styles that the heatmap
   work uses. Those become the first tokens in step 2.
3. Base all new work on `develop`, which is v2.6.2. `main` is behind and its
   production build fails.

## What's wrong today (counted on `develop`)

| Finding | Number |
|---|---|
| Hard-coded hex colors (distinct) | 66 (265 uses) |
| Greens used for profit / reds for loss | 6 / 4 |
| Uses of 8px, 9px or 10px text | 503 |
| Files using the shared `Card` from `components/ui.tsx` | 3 (`Tabs` is used in 1) |
| Tabs on the Portfolio page (`/trades`), none with a URL | 7 |
| Lines in `components/trades/YearTab.tsx` | 1,180 |
| Committed duplicate files (`* 2.py`, `.stable.tsx`) | 18 + 2 |

## Target structure

### Navigation: three areas

- **Market:** Today (`/today`, was `/dashboard`), Options Flow (`/flow/[symbol]`), Sectors (`/sectors`, was `/markets`)
- **Portfolio:** Positions (positions + activity), Holdings, Performance (premium + year), Accounts, Watchlist → `/portfolio/[tab]`
- **Money:** Budget, Credit cards (split out of Budget), Ledger (currently hidden) → `/money/[tab]`
- Settings and Users sit at the bottom of the sidebar. Stock detail opens from the global search.
- Old URLs redirect to the new ones.

### App shell, the same on every page

- **Sidebar** with the three labeled groups. It collapses to icons on tablet and becomes a bottom bar on phone.
- **Top bar** with global ticker search (⌘K), the week picker (moved out of Portfolio) and market status.
- **Page header** with the area label, the page title and one primary action.
- **Summary strip** of up to four `Stat`s, then the main panels.
- Main panels are framed like app windows: a top bar with three dots and a mono uppercase title such as `OPTIONFLOW / FLOW`.

### Design tokens: one file, `web/styles/tokens.css`, mapped in `tailwind.config.ts`

| Token | Light | Dark | Use |
|---|---|---|---|
| paper | `#f6f6f3` | `#0c0d10` | page background |
| panel | `#ffffff` | `#15161a` | windows, cards |
| panel-2 | `#efefeb` | `#1c1d22` | inset rows |
| ink | `#0e0f12` | `#ededee` | text, primary button |
| ink-muted | `#5e6066` | `#9b9da3` | secondary text |
| line | `#e2e2dd` | `#2a2b31` | borders |
| accent | `#2563eb` | `#6b93f5` | the one highlight |
| gain | `#15803d` | `#4ade80` | profit, calls ITM |
| loss | `#dc2626` | `#f87171` | loss, puts ITM |
| warn | `#b45309` | `#fbbf24` | near strike, expiring |
| live | `#c2410c` | `#fb923c` | streaming data |

Heatmap color scales are separate tokens. Take them from the existing heatmap work.

- **Fonts:** DM Sans for words, Roboto Mono for numbers and labels, with `tabular-nums` on number columns. These replace Geist.
- **Type scale:** 28 (hero number) / 20 (page title) / 16 (panel heading) / 14 (body) / 13 (table and data, mono) / 11 (uppercase mono label). Nothing smaller than 11px.
- **Radius:** 4 (chips, inputs) / 8 (stats, buttons) / 12 (panels, dialogs).
- **Spacing:** 4 / 8 / 12 / 16 / 24 / 32.
- **Labels:** mono, uppercase, letter-spacing 0.12em, with a short rule before section labels (`— PART 1`).

### Code layout

```
web/styles/tokens.css
web/components/ui/        primitives: Card, Stat, Tabs, Table, Badge, Button, Dialog, EmptyState, Skeleton, Window
web/components/trading/   PnL, TickerChip, StrikeLadder, WeekPicker, ExpiryFilter, RegimeBadge, Heatmap
web/components/shell/     Sidebar, TopBar, BottomNav, PageHeader
web/features/market|portfolio|money/<page>/   hooks.ts (data) · calc.ts (math) · *.tsx (layout)
web/app/(app)/today, flow/[symbol], sectors, portfolio/[tab], money/[tab]
```

Rule: each layer only imports from the layers above it (tokens → ui → trading → features → app).

## Order of work

Each step ships on its own and leaves the app working. Run `npm run build` (it
type-checks) and the pytest suite before each push.

1. **Clean up the repo** (small). Delete the 18 `* 2.py` / `* 2.bak2` files and the
   `*.stable.tsx` twins, after a grep confirms nothing imports them.
2. **Add tokens and swap colors** (medium). Create `tokens.css` from the table above,
   adjusted to match the heatmap work. Switch the fonts, map the tokens in Tailwind
   (`text-gain`, `bg-panel`, …) and replace the palette classes and hex values.
3. **Set the 11px type floor** (medium). Move every size onto the six-step scale.
   Check the dense GEX tables at 390px wide.
4. **Build the shell and primitives** (medium). Grouped sidebar, top bar, PageHeader,
   Stat, Tabs, Table and Window in `components/ui` and `components/shell`.
5. **Give Portfolio real pages** (large). Move the 7 tabs to 5 pages under
   `/portfolio/[tab]`, redirect `/trades`, and split the big tab files into
   hooks / calc / layout.
6. **Money area and backend tidy-up** (medium). Split credit cards out of Budget,
   bring Ledger back into the nav, and split the 40-route `portfolio` router into
   weeks / holdings / accounts.

## Working rules

- Branch from `develop` for each step (`feat/ui-1-cleanup`, `feat/ui-2-tokens`, …).
  Open a PR into `develop`. Never push to `main`.
- Keep the live optflw.com server running while you work: use a second port, like
  3002, for development.
- After each step, take screenshots at 1280px and 390px wide, in light and dark.
