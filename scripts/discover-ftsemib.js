const ITEMS = [
  { key: "ENI", symbol: "ENI", mic_code: "XMIL" },
  { key: "ENEL", symbol: "ENEL", mic_code: "XMIL" }
];

async function tdEod(symbol, micCode) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY is not configured.");

  const url = new URL("https://api.twelvedata.com/eod");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("mic_code", micCode);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: { "User-Agent": "ftsemib-eod-pilot/1.0" },
    cache: "no-store"
  });

  const data = await response.json();
  if (!response.ok || data.status === "error") {
    throw new Error(`Twelve Data EOD error for ${symbol}: ${data.message || data.code || "HTTP " + response.status}`);
  }
  return data;
}

(async () => {
  let ok = true;
  for (const item of ITEMS) {
    try {
      const data = await tdEod(item.symbol, item.mic_code);
      console.log("\nEOD TEST " + item.key);
      console.log(JSON.stringify({ ok: true, request: item, response: data }, null, 2));
    } catch (e) {
      ok = false;
      console.log("\nEOD TEST " + item.key);
      console.log(JSON.stringify({
        ok: false,
        request: item,
        error: e instanceof Error ? e.message : String(e)
      }, null, 2));
    }
  }
  if (!ok) process.exitCode = 1;
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
