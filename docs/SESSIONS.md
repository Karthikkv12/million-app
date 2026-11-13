# SESSIONS.md — Who does what: cloud session vs Mac session

> **For any Claude session:** when the owner says "refer to SESSIONS.md", read this file
> and follow it. It decides which session does which job.

The owner works with two Claude sessions. **Both are opened from the Claude app (phone or
browser).** The owner does not type in the Mac terminal.

| Session (as it appears in the app) | Runs on | Can reach | Use it for |
|---|---|---|---|
| **Cloud session**, e.g. "Optionflow app visibility" | Anthropic cloud container | GitHub repo only; no Mac, no real DB, no Robinhood data, no ports 3000/8000 | Writing code (frontend + backend), running tests/typecheck/lint, pushing its `claude/...` branch |
| **Mac session**: "OptionFlow remote control …" (tag `remote-control`) | The owner's MacBook Air, folder `~/Desktop/OptionFlow_main` | Real backend, SQLite DBs, Robinhood sync, ports 3000 / 3002 / 8000, Cloudflare tunnel | Merging into `develop`, releasing to `main`, restarting servers, checking with real data and logged-in pages |

## The flow of a change

1. **Cloud session** writes the change on its own `claude/...` branch and pushes it.
   It reports the branch name and commit.
2. **Mac session** merges that branch into `develop` and checks it on port 3002 with real data.
3. Owner says **"release"** to the **Mac session**. It:
   - merges `develop` → `main`, tags it, pushes (see DEV_GUIDE.md → *Releasing to Production*),
   - pulls `main` into `~/Desktop/OptionFlow_main` and **restarts port 3000**,
   - updates `VERSIONS.md` and posts DONE in `docs/COORDINATION.md` (`coordination` branch).
4. The change is live on optflw.com only after the port 3000 restart.

**Only the Mac session can release.** optflw.com is whatever runs on port 3000 on the Mac
(Cloudflare tunnel), and the cloud session cannot reach the Mac.

## Rules for each session

**Cloud session**
- Push only to its own `claude/...` branch unless the owner explicitly says otherwise.
- Do not claim something is live; say it is pushed and needs the Mac session to merge/release.
- Visual checks here use mocked API data. Say so, and leave real-data checks to the Mac session.

**Mac session**
- Is the only one that touches `main`, the running servers and the live DB.
- Follows AGENT_CONTEXT.md branch rules: merge to `main` only when the owner says "release"
  or "push to main".

## When the owner must touch the Mac

Only when the Mac session is missing from the app or optflw.com is down. Both mean the Mac slept,
rebooted, or the Remote Control terminal was closed. On the Mac, once:

```bash
cd ~/Desktop/OptionFlow_main && claude remote-control
```

Then keep the Mac awake and that terminal open. Restart servers per DEV_GUIDE.md → *Startup Checklist*.

## Usage (plan limits)

Usage depends on how much a task reads, edits and checks, not on where it runs. The cloud
session spends extra on tasks that need checking (fresh clone each time, mocked data), so:
- quick fixes and anything needing real data → **Mac session**;
- self-contained code work while the Mac is off → **cloud session**.

Doing everything in the Mac session is also fine; the cloud session is optional.
