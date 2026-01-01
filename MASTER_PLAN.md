# Master plan (growing checklist)

This is the long-lived, always-growing plan for turning Million into a brokerage-style app.

Rules:
- Add new items at the bottom of the most relevant section.
- When an item is completed, mark it as `[x]` and strike it out.

---

## Identity + security
- [x] ~~Strong password hashing (`passlib` / `pbkdf2_sha256`)~~
- [x] ~~JWT access tokens + refresh token rotation~~
- [x] ~~Token revocation + logout-all cutoff (`auth_valid_after`)~~
- [x] ~~Basic auth audit events + login/refresh throttling~~
- [ ] Password reset flow (email mocked initially)
- [ ] Device/session management UI polish (revoke specific refresh token)
- [ ] MFA (TOTP) (later)
- [ ] Edge rate limiting (reverse proxy / gateway) (later)

## Accounts model
- [x] ~~User → accounts + holdings tables~~
- [ ] Sub-accounts (cash vs margin) + account roles/admin
- [ ] KYC status model (mocked) + gating for trading actions

## Ledger (source of truth)
- [x] ~~Cash-only double-entry ledger tables (`ledger_accounts`, `ledger_entries`, `ledger_lines`)~~
- [x] ~~Post cash deposits/withdrawals into ledger (balanced lines)~~
- [ ] Derive API cash balance from ledger everywhere (remove cash_flow-as-source)
- [ ] Add position ledger (lots / cost basis) as the source of holdings
- [ ] Post trades into ledger (cash, positions, fees)
- [ ] Corporate actions support (splits/dividends) posted into ledger
- [ ] Reconciliation tooling (compare broker vs internal ledger)

## Order lifecycle
- [x] ~~Order idempotency key (client_order_id)~~
- [x] ~~Provider-agnostic broker adapter + paper broker~~
- [x] ~~Order external linkage fields + sync/fill paths~~
- [ ] Full order state machine (NEW/VALIDATED/ROUTED/PARTIAL/FILLED/CANCELLED/REJECTED)
- [ ] Immutable order event history table (append-only)
- [ ] Retries + idempotency on all write endpoints (server-side keys)

## Market data
- [x] ~~Stock search + stock detail page (history + current price)~~
- [ ] Symbol master table + refresh job
- [ ] Quote snapshots cache (local DB) + expiry
- [ ] Corporate actions data feed (later)

## Risk + controls
- [ ] Buying power derived from ledger (cash + margin rules)
- [ ] Pre-trade checks (trading hours/halts, position limits)
- [ ] Reject/hold orders with reasons (persisted)

## Reliability
- [ ] Background job queue (RQ/Celery/APS) for sync, refresh, reconciliation
- [ ] Transactional outbox for external events/webhooks
- [ ] Structured logs + correlation id across API calls
- [ ] Backups + restore drills

## Compliance-ready basics
- [ ] Immutable audit trail for sensitive actions (append-only)
- [ ] Data retention + export/delete policies
- [ ] Access logging + admin views

## UI / product
- [x] ~~Search moved into Investment page (replaces old New Order dropdown UX)~~
- [ ] Replace remaining dropdown-based ticker selection with consistent Search-first UX
- [ ] Account switcher (when multiple accounts exist)
