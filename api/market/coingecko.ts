type CachedPrice = {
  price: number;
  cachedAt: number;
  source: "coingecko" | "binance";
};

let cache: CachedPrice | null = null;

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
    return Number.isFinite(price) && price > 0 ? price : null;
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
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  const now = Date.now();
  if (cache && now - cache.cachedAt < 15_000) {
    res.status(200).json({ ok: true, price: cache.price, cached: true, source: cache.source });
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
    if (cache) {
      res.status(200).json({ ok: true, price: cache.price, cached: true, stale: true, source: cache.source });
      return;
    }
    res.status(502).json({ ok: false, error: "coingecko unavailable" });
    return;
  }

  cache = { price, cachedAt: now, source };
  res.status(200).json({ ok: true, price, cached: false, source });
}
