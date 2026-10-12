const fs = require("fs");

const CHART_BASE = "https://grafici.borsaitaliana.it";
const HISTORY_FILE = "ftsemib-history.json";
const SNAPSHOT_FILE = "ftsemib-latest.json";
const BOOTSTRAP_BARS = 80;
const INCREMENTAL_BARS = 2;

const INSTRUMENTS = [
  { symbol: "ENI", name: "Eni", isin: "IT0003132476", exch: "XMIL" },
  { symbol: "ENEL", name: "Enel", isin: "IT0003128367", exch: "XMIL" }
];

function round(v, d = 6) {
  return v == null || Number.isNaN(Number(v)) ? null : Number(Number(v).toFixed(d));
}

function sma(values, p) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= p) sum -= values[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

function ema(values, p) {
  const out = new Array(values.length).fill(null);
  if (values.length < p) return out;
  let seed = 0;
  for (let i = 0; i < p; i++) seed += values[i];
  let e = seed / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < values.length; i++) {
    e = (values[i] - e) * k + e;
    out[i] = e;
  }
  return out;
}

function decorate(bars) {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const closes = sorted.map((x) => x.close);
  const e10 = ema(closes, 10);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  return sorted.map((b, i) => ({
    ...b,
    ema10: round(e10[i]),
    sma20: round(s20[i]),
    sma50: round(s50[i])
  }));
}

function mergeBars(oldBars, newBars) {
  const m = new Map();
  for (const b of [...oldBars, ...newBars]) {
    if (b && b.date) m.set(b.date, b);
  }
  return [...m.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function attr(html, name) {
  const lower = html.toLowerCase();
  const needle = name.toLowerCase() + "=";
  const pos = lower.indexOf(needle);
  if (pos < 0) return null;

  let i = pos + needle.length;
  while (html[i] === " " || html[i] === "\t" || html[i] === "\n") i++;

  const quote = html[i];
  if (quote !== '"' && quote !== "'") return null;
  const end = html.indexOf(quote, i + 1);
  if (end < 0) return null;
  return html.slice(i + 1, end);
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      ...headers
    },
    redirect: "follow"
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Borsa Italiana HTTP ${res.status} for ${url}: ${text.slice(0, 220)}`);
  }
  return { text, res };
}

async function getChartConfig(cfg) {
  const page = `${CHART_BASE}/interactive-chart/${cfg.isin}-${cfg.exch}?lang=it`;
  const { text } = await fetchText(page, { Accept: "text/html,application/xhtml+xml" });

  const token = attr(text, "token");
  const apiUrl = attr(text, "url") || `${CHART_BASE}/api/`;
  const code = attr(text, "code") || cfg.isin;
  const exch = attr(text, "exchcode") || cfg.exch;

  if (!token) throw new Error(`Chart token not found for ${cfg.symbol}`);
  return { token, apiUrl, code, exch };
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

function parseDate(dt) {
  const s = String(dt || "");
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const timestamp = Date.UTC(y, m - 1, d);
  return {
    timestamp,
    date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  };
}

function parseHistoryRow(row) {
  const d = parseDate(row?.dt);
  if (!d) return null;
  const open = Number(row?.openPx);
  const high = Number(row?.highPx);
  const low = Number(row?.lowPx);
  const close = Number(row?.closePx);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return {
    timestamp: d.timestamp,
    date: d.date,
    open,
    high,
    low,
    close
  };
}

async function fetchHistory(cfg, period) {
  const chart = await getChartConfig(cfg);
  const path = `instruments/${chart.code},${chart.exch},ISIN/history/period`;
  const url = joinUrl(chart.apiUrl, path) + `?period=${encodeURIComponent(period)}`;

  let lastErr = null;
  for (const authorization of [chart.token, `Bearer ${chart.token}`]) {
    try {
      const { text, res } = await fetchText(url, {
        Accept: "application/json",
        Authorization: authorization
      });
      const json = JSON.parse(text);
      const hist = json.history || json;
      const rows = Array.isArray(hist.historyDt) ? hist.historyDt : [];
      const bars = rows.map(parseHistoryRow).filter(Boolean);
      if (!bars.length) throw new Error(`No valid history rows for ${cfg.symbol}`);
      return { bars, status: res.status };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`History request failed for ${cfg.symbol}`);
}

function romeNowIso() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date()).replace(" ", "T");
}

(async () => {
  const requestedMode = String(process.env.FTSEMIB_REFRESH_MODE || "auto").toLowerCase();
  if (!["auto", "incremental", "full"].includes(requestedMode)) {
    throw new Error(`Invalid FTSEMIB_REFRESH_MODE: ${requestedMode}`);
  }

  const history = fs.existsSync(HISTORY_FILE)
    ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"))
    : { instruments: {} };
  if (!history.instruments) history.instruments = {};

  const output = {
    ok: true,
    generatedAtUtc: new Date().toISOString(),
    generatedAtEuropeRome: romeNowIso(),
    timeframe: "1d",
    source: "Borsa Italiana official chart API",
    indicators: ["EMA10", "SMA20", "SMA50"],
    requestedMode,
    instruments: {},
    errors: {}
  };

  for (const cfg of INSTRUMENTS) {
    try {
      const old = history.instruments[cfg.symbol]?.bars || [];
      const hasBase = old.length >= 50;
      const doFull = requestedMode === "full" || !hasBase;
      const period = doFull ? "6M" : "1M";
      const got = await fetchHistory(cfg, period);

      if (doFull && got.bars.length < BOOTSTRAP_BARS) {
        throw new Error(`Only ${got.bars.length} daily bars returned for ${cfg.symbol}; need at least ${BOOTSTRAP_BARS}`);
      }
      if (!doFull && got.bars.length < INCREMENTAL_BARS) {
        throw new Error(`Only ${got.bars.length} daily bars returned for incremental ${cfg.symbol}`);
      }

      const selected = doFull
        ? got.bars.slice(-BOOTSTRAP_BARS)
        : got.bars.slice(-INCREMENTAL_BARS);

      const merged = decorate(mergeBars(old, selected));
      history.instruments[cfg.symbol] = {
        name: cfg.name,
        isin: cfg.isin,
        exchange: cfg.exch,
        source: "Borsa Italiana official chart API",
        bars: merged
      };

      const latest = merged.at(-1) || null;
      const previous = merged.at(-2) || null;
      output.instruments[cfg.symbol] = {
        name: cfg.name,
        isin: cfg.isin,
        exchange: cfg.exch,
        barsStored: merged.length,
        mode: doFull ? (hasBase ? "full-refresh" : "bootstrap") : "incremental",
        requestedMode,
        sourcePeriod: period,
        sourceBarsReceived: got.bars.length,
        barsMergedFromFetch: selected.length,
        latestCompleted: latest,
        previousCompleted: previous,
        indicators: latest
          ? { ema10: latest.ema10, sma20: latest.sma20, sma50: latest.sma50 }
          : null
      };
    } catch (e) {
      output.ok = false;
      output.errors[cfg.symbol] = e instanceof Error ? e.message : String(e);
    }
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + "\n");
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(output, null, 2) + "\n");

  console.log(JSON.stringify({
    ok: output.ok,
    requestedMode,
    instruments: output.instruments,
    errors: output.errors
  }, null, 2));

  if (!output.ok) process.exitCode = 1;
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
