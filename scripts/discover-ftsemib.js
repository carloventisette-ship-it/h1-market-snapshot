const SYMBOLS = ["ENI.MI", "ENEL.MI"];

function decodeHtml(s) {
  return s
    .replace(/&nbsp;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function textOf(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function num(s) {
  const v = Number(String(s).replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(v) ? v : null;
}

function parseHistoricalTable(html) {
  const rows = [];
  const trMatches = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => textOf(m[1]));
    if (cells.length < 6) continue;

    const timestamp = Date.parse(cells[0]);
    const open = num(cells[1]);
    const high = num(cells[2]);
    const low = num(cells[3]);
    const close = num(cells[4]);

    if (!Number.isFinite(timestamp)) continue;
    if (![open, high, low, close].every(Number.isFinite)) continue;

    rows.push({
      date: new Date(timestamp).toISOString().slice(0,10),
      open, high, low, close
    });
  }

  const unique = new Map();
  for (const r of rows) unique.set(r.date, r);

  return [...unique.values()]
    .sort((a,b) => a.date.localeCompare(b.date))
    .slice(-2);
}

async function fetchYahoo(symbol) {
  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  const html = await res.text();
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);

  const candles = parseHistoricalTable(html);
  if (candles.length < 2) {
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    throw new Error(
      `Could not parse 2 historical OHLC rows for ${symbol}; parsed=${candles.length}; title=${title ? textOf(title) : "n/a"}; htmlBytes=${html.length}`
    );
  }

  return { symbol, sourceUrl: url, candles };
}

(async()=>{
  let ok = true;

  for (const symbol of SYMBOLS) {
    try {
      const result = await fetchYahoo(symbol);
      console.log("\nYAHOO TEST " + symbol);
      console.log(JSON.stringify({ok:true,...result}, null, 2));
    } catch (e) {
      ok = false;
      console.log("\nYAHOO TEST " + symbol);
      console.log(JSON.stringify({
        ok:false,
        symbol,
        error:e instanceof Error ? e.message : String(e)
      }, null, 2));
    }
  }

  if (!ok) process.exitCode = 1;
})().catch(e=>{
  console.error(e.stack || e.message);
  process.exit(1);
});
