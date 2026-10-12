const SYMBOLS = [
  { key: "ENI", symbol: "ENI:XMIL" },
  { key: "ENEL", symbol: "ENEL:XMIL" }
];

async function fetchOne(symbol) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY is not configured.");

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "1");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("timezone", "Europe/Rome");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: { "User-Agent": "ftsemib-d1-pilot/1.0" },
    cache: "no-store"
  });
  const data = await response.json();

  if (!response.ok || data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(`Twelve Data error for ${symbol}: ${data.message || data.code || "HTTP " + response.status}`);
  }

  const v = data.values[0];
  return {
    symbol,
    meta: data.meta || null,
    candle: {
      datetime: v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume == null ? null : Number(v.volume)
    }
  };
}

(async () => {
  let ok = true;

  for (const item of SYMBOLS) {
    try {
      const result = await fetchOne(item.symbol);
      console.log("\nD1 TEST " + item.key);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } catch (e) {
      ok = false;
      console.log("\nD1 TEST " + item.key);
      console.log(JSON.stringify({
        ok: false,
        symbol: item.symbol,
        error: e instanceof Error ? e.message : String(e)
      }, null, 2));
    }
  }

  if (!ok) process.exitCode = 1;
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
