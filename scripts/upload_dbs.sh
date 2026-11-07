#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# upload_dbs.sh — copy your five SQLite databases to the cloud backend.
#
# One-time step after the first Railway deploy (see docs/RAILWAY.md).
# The backend accepts uploads only while its RESTORE_TOKEN variable is set.
#
# Usage:
#   BACKEND=https://<backend>.up.railway.app RESTORE_TOKEN=<token> \
#     bash scripts/upload_dbs.sh [folder-with-db-files]   # default: ~/Downloads
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="${1:-$HOME/Downloads}"
: "${BACKEND:?Set BACKEND to the public URL of the backend}"
: "${RESTORE_TOKEN:?Set RESTORE_TOKEN to the value in Railway}"
BACKEND="${BACKEND%/}"

for name in users trades portfolio budget markets; do
  f="$DIR/$name.db"
  if [ ! -s "$f" ]; then
    echo "✗ $f is missing or empty (iCloud placeholder?) — stopping." >&2
    exit 1
  fi
done

for name in users trades portfolio budget markets; do
  printf '→ %-13s ' "$name.db"
  curl -fsS -X POST "$BACKEND/restore-db/$name.db" \
       -H "X-Restore-Token: $RESTORE_TOKEN" \
       -F "file=@$DIR/$name.db"
  echo
done

echo
echo "Health: $(curl -fsS "$BACKEND/health")"
echo "Done. Now delete RESTORE_TOKEN in Railway (backend → Variables) to switch uploads off."
