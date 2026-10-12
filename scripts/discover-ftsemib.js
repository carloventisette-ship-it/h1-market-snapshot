const QUERIES = [
  { key: "ENI", query: "ENI" },
  { key: "ENEL", query: "ENEL" }
];

async function td(path, params = {}) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY is not configured.");

  const url = new URL("https://api.twelvedata.com/" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: { "User-Agent": "ftsemib-d1-pilot/1.0" },
    cache: "no-store"
  });
  const data = await response.json();

  if (!response.ok || data.status === "error") {
    throw new Error(`Twelve Data error: ${data.message || data.code || "HTTP " + response.status}`);
  }
  return data;
}

async function resolveXmil(query) {
  const data = await td("symbol_search", { symbol: query });
  const rows = Array.isArray(data.data) ? data.data : [];
  const exactXmil = rows.find(r =>
    String(r.symbol || "").toUpperCase() === query.toUpperCase() &&
    String(r.mic_code || "").toUpperCase() === "XMIL"
  );
  const anyXmil = rows.find(r => String(r.mic_code || "").toUpperCase() === "XMIL");
  const chosen = exactXmil || anyXmil;

  return {
    chosen,
    candidates: rows.slice(0, 20).map(r => ({
      symbol: r.symbol,
      instrument_name: r.instrument_name,
      exchange: r.exchange,
      mic_code: r.mic_code,
      country: r.country,
      currency: r.currency,
      instrument_type: r.instrument_type,
      access: r.access || null
    }))
  };
}

async function fetchOne(symbol, micCode) {
  const data = await td("time_series", {
    symbol,
    mic_code: micCode,
    interval: "1day",
    outputsize: 1,
    format: "JSON"
  });

  if (!Array.isArray(data.values) || !data.values.length) {
    throw new Error(`No D1 values returned for ${symbol} / ${micCode}`);
  }

  const v = data.values[0];
  return {
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

  for (const item of QUERIES) {
    try {
      const resolved = await resolveXmil(item.query);
      console.log("\nSEARCH " + item.key);
      console.log(JSON.stringify(resolved, null, 2));

      if (!resolved.chosen) throw new Error(`No XMIL candidate found for ${item.query}`);

      const result = await fetchOne(resolved.chosen.symbol, resolved.chosen.mic_code);

      console.log("D1 TEST " + item.key);
      console.log(JSON.stringify({
        ok: true,
        resolved: resolved.chosen,
        ...result
      }, null, 2));
    } catch (e) {
      ok = false;
      console.log("\nD1 TEST " + item.key);
      console.log(JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      }, null, 2));
    }
  }

  if (!ok) process.exitCode = 1;
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
