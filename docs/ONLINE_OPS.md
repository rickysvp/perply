# Perply Online Ops (No Local Runtime)

Goal: ensure nothing runs on developer machines. Keeper and watchdog run only on cloud/server.

## 1. Provision server
- Ubuntu 22.04+
- Dedicated non-root user: `perply`
- Install Node.js LTS and project deps under `/opt/perply`

## 2. Install services
Run on server:

```bash
cd /opt/perply
sudo bash ops/install-systemd.sh
```

Then edit secrets/commands:

```bash
sudo nano /etc/perply/keeper.env
```

Minimum required:
- `KEEPER_START_CMD`
- `WATCHDOG_CMD`
- `MONAD_RPC_URL`
- `PERPLY_ARENA_ADDRESS`
- `KEEPER_PRIVATE_KEY`

## 3. Start and verify

```bash
sudo systemctl restart perply-keeper.service
sudo systemctl start perply-keeper-watchdog.timer
sudo systemctl status perply-keeper.service
sudo systemctl status perply-keeper-watchdog.timer
sudo journalctl -u perply-keeper.service -n 100 --no-pager
```

## 4. Security baseline
- Never store private key in repo or `.env.local`.
- `/etc/perply/keeper.env` must be `0600`.
- Use separate keeper wallet with gas budget alert.
- Restrict server inbound access with firewall and IP allowlist.
- Add alerting on service down / settlement stale.

## 5. Local machine policy
- No cron jobs for keeper/watchdog on local.
- No local PM2/systemd jobs for this project.
- Local runs are allowed only for short debugging windows.
