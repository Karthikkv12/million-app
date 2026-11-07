#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup_mac_server.sh — turn this Mac into the OptionFlow server for optflw.com
#
# What it does (idempotent — safe to re-run):
#   1. Installs Homebrew deps: python@3.13, node@20, cloudflared
#   2. Creates .venv + installs Python deps, runs npm install in web/
#   3. Installs launchd agents so backend (:8000) and frontend (:3000)
#      start at login and restart if they crash
#   4. Installs the Cloudflare tunnel as a system service (needs your token)
#   5. Stops the Mac from sleeping while on power
#
# Usage (from the repo root on the Mac):
#   CF_TUNNEL_TOKEN=<token> bash scripts/setup_mac_server.sh
#
# Get the token: Cloudflare dashboard → Zero Trust → Networks → Tunnels →
# your optflw tunnel → Configure → copy the token from the install command.
# Omit CF_TUNNEL_TOKEN to skip the tunnel step.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$REPO/logs"
mkdir -p "$AGENTS" "$LOGS"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

# ── 1. Homebrew + tools ──────────────────────────────────────────────────────
say "Checking Homebrew"
if ! command -v brew >/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
BREW="$(brew --prefix)"

say "Installing python@3.13, node@20, cloudflared"
brew install python@3.13 node@20 cloudflared

PY="$BREW/opt/python@3.13/bin/python3.13"
NODE_BIN="$BREW/opt/node@20/bin"

# ── 2. Dependencies ──────────────────────────────────────────────────────────
say "Python venv + requirements"
[ -d "$REPO/.venv" ] || "$PY" -m venv "$REPO/.venv"
"$REPO/.venv/bin/pip" install -q --upgrade pip
"$REPO/.venv/bin/pip" install -q -r "$REPO/requirements.txt"

say "npm install (web/)"
(cd "$REPO/web" && PATH="$NODE_BIN:$PATH" npm install --no-audit --no-fund)

# ── 3. launchd agents for :8000 and :3000 ───────────────────────────────────
write_agent() {  # label, workdir, command
  local label="$1" dir="$2" cmd="$3" plist="$AGENTS/$1.plist"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>WorkingDirectory</key><string>$dir</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string><string>$cmd</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODE_BIN:$REPO/.venv/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
</dict></plist>
EOF
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  echo "  loaded $label"
}

say "Installing launchd agents"
# Free the ports in case old manual servers are running
kill -9 $(lsof -ti :8000 :3000) 2>/dev/null || true
write_agent com.optflw.fastapi "$REPO" \
  "exec uvicorn optionflow.main:app --host 127.0.0.1 --port 8000"
write_agent com.optflw.nextjs "$REPO/web" \
  "exec node node_modules/.bin/next dev --port 3000"

# ── 4. Cloudflare tunnel ─────────────────────────────────────────────────────
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  say "Installing Cloudflare tunnel service (sudo)"
  sudo cloudflared service uninstall 2>/dev/null || true
  sudo cloudflared service install "$CF_TUNNEL_TOKEN"
else
  say "Skipping tunnel — re-run with CF_TUNNEL_TOKEN=<token> to enable optflw.com"
fi

# ── 5. Keep awake on power ───────────────────────────────────────────────────
say "Disabling sleep while on power adapter (sudo)"
sudo pmset -c sleep 0 disksleep 0 womp 1 autorestart 1 || true

# ── Verify ───────────────────────────────────────────────────────────────────
say "Waiting for servers"
for _ in $(seq 1 40); do
  curl -sf localhost:8000/health >/dev/null && \
  [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000)" = 200 ] && break
  sleep 2
done
echo "  backend : $(curl -s localhost:8000/health || echo DOWN)"
echo "  frontend: $(curl -s -o /dev/null -w '%{http_code}' localhost:3000 || echo DOWN)"
echo
echo "Logs: $LOGS/   ·   Tunnel status: Cloudflare dashboard → Tunnels (should show HEALTHY)"
