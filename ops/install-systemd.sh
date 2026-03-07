#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash ops/install-systemd.sh"
  exit 1
fi

install -d -m 0755 /etc/systemd/system
install -d -m 0750 /etc/perply

install -m 0644 ops/systemd/perply-keeper.service /etc/systemd/system/perply-keeper.service
install -m 0644 ops/systemd/perply-keeper-watchdog.service /etc/systemd/system/perply-keeper-watchdog.service
install -m 0644 ops/systemd/perply-keeper-watchdog.timer /etc/systemd/system/perply-keeper-watchdog.timer

if [[ ! -f /etc/perply/keeper.env ]]; then
  cat >/etc/perply/keeper.env <<'ENVEOF'
# Required: set your real commands and secrets here.
# Example:
# KEEPER_START_CMD="cd /opt/perply && npm run keeper:run"
# WATCHDOG_CMD="cd /opt/perply && npm run ops:watchdog:run"
# MONAD_RPC_URL="https://..."
# PERPLY_ARENA_ADDRESS="0x..."
# KEEPER_PRIVATE_KEY="0x..."
KEEPER_START_CMD="echo 'SET KEEPER_START_CMD in /etc/perply/keeper.env' && exit 1"
WATCHDOG_CMD="echo 'SET WATCHDOG_CMD in /etc/perply/keeper.env' && exit 1"
ENVEOF
  chmod 0600 /etc/perply/keeper.env
  echo "Created /etc/perply/keeper.env (template). Fill it before starting service."
fi

systemctl daemon-reload
systemctl enable perply-keeper.service
systemctl enable perply-keeper-watchdog.timer

echo "Installed. Next:"
echo "1) edit /etc/perply/keeper.env"
echo "2) systemctl restart perply-keeper.service"
echo "3) systemctl start perply-keeper-watchdog.timer"
echo "4) systemctl status perply-keeper.service"
