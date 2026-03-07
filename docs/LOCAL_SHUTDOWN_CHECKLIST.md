# Local Shutdown Checklist

Use this to ensure no Perply runtime remains on local machine.

```bash
pkill -f "keeper-signer|keeper-service|health-watchdog|timelock-executor|tsx server.ts|vite" || true
crontab -l 2>/dev/null | rg -v "perply|Perply.fun|keeper|watchdog|timelock" | crontab -
ps aux | rg -i "perply|keeper-signer|watchdog|timelock|tsx server.ts|vite" | rg -v "rg -i" || true
```

Expected final result: no relevant process output.
