import express, { NextFunction, Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface RpcHealthResult {
  url: string;
  ok: boolean;
  latencyMs: number;
  blockNumber?: string;
  error?: string;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

interface CachedPrice {
  price: number;
  cachedAt: number;
  source: "coingecko" | "binance";
}

function isAllowedRpcUrl(urlRaw: string): boolean {
  try {
    const parsed = new URL(urlRaw);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function getRpcUrls(): string[] {
  const envList = (process.env.VITE_MONAD_RPC_URLS || "")
    .split(",")
    .map(item => item.trim())
    .filter(item => item.length > 0 && isAllowedRpcUrl(item));
  const single = (process.env.MONAD_RPC_URL || "").trim();
  const defaults = ["https://testnet-rpc.monad.xyz"];
  const merged = [...envList, ...(single && isAllowedRpcUrl(single) ? [single] : []), ...defaults];
  return Array.from(new Set(merged));
}

async function probeRpc(url: string, timeoutMs = 2000): Promise<RpcHealthResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return { url, ok: false, latencyMs, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (!payload.result || payload.error) {
      return {
        url,
        ok: false,
        latencyMs,
        error: payload.error?.message || "Invalid JSON-RPC response",
      };
    }
    return { url, ok: true, latencyMs, blockNumber: payload.result };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return { url, ok: false, latencyMs, error: "probe failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCoingeckoBtcPrice(timeoutMs = 2000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { bitcoin?: { usd?: number } };
    const price = Number(payload.bitcoin?.usd);
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinanceBtcPrice(timeoutMs = 2000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { price?: string };
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function createRateLimiter({ windowMs, max, keyPrefix }: RateLimitOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (buckets.size > 2048) {
      for (const [bucketKey, bucket] of buckets.entries()) {
        if (now > bucket.resetAt) buckets.delete(bucketKey);
      }
    }
    const client = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${client}`;
    const current = buckets.get(key);

    if (!current || now > current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= max) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    current.count += 1;
    buckets.set(key, current);
    next();
  };
}



async function startServer() {
  const app = express();
  const PORT = 3000;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rpcHealthLimiter = createRateLimiter({ windowMs: 10_000, max: 12, keyPrefix: "rpc-health" });
  const eventsLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "events" });
  const marketLimiter = createRateLimiter({ windowMs: 10_000, max: 20, keyPrefix: "market" });
  let coingeckoCache: CachedPrice | null = null;

  app.use((_, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    next();
  });

  // API routes
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });

  app.get("/api/rpc/health", rpcHealthLimiter, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const urls = getRpcUrls();
    const results = await Promise.all(urls.map(url => probeRpc(url)));
    const healthy = results.filter(item => item.ok).length;
    res.json({
      status: healthy > 0 ? "ok" : "degraded",
      healthy,
      total: results.length,
      results,
    });
  });

  app.get("/api/market/coingecko", marketLimiter, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const now = Date.now();
    if (coingeckoCache && now - coingeckoCache.cachedAt < 15_000) {
      res.json({ ok: true, price: coingeckoCache.price, cached: true, source: coingeckoCache.source });
      return;
    }

    let source: CachedPrice["source"] = "coingecko";
    let price = await fetchCoingeckoBtcPrice();
    if (price === null) {
      const fallback = await fetchBinanceBtcPrice();
      if (fallback !== null) {
        price = fallback;
        source = "binance";
      }
    }
    if (price === null) {
      if (coingeckoCache) {
        res.json({
          ok: true,
          price: coingeckoCache.price,
          cached: true,
          stale: true,
          source: coingeckoCache.source,
        });
        return;
      }
      res.status(502).json({ ok: false, error: "coingecko unavailable" });
      return;
    }

    coingeckoCache = { price, cachedAt: now, source };
    res.json({ ok: true, price, cached: false, source });
  });

  // Example SSE endpoint
  app.get("/api/events", eventsLimiter, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      res.write("data: connected\n\n");
      
      const interval = setInterval(() => {
        res.write(`data: ${new Date().toISOString()}\n\n`);
      }, 1000);

      req.on("close", () => {
        clearInterval(interval);
      });
    } catch (err) {
      console.error("SSE Error:", err);
      res.write('event: error\ndata: {"message":"Stream error"}\n\n');
      res.end();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
