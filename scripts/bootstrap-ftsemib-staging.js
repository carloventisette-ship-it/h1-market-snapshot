// Isolated FTSE MIB D1 bootstrap: never writes production snapshot/history.
const fs = require("fs");
const report = JSON.parse(fs.readFileSync("ftsemib-constituents-validation.json", "utf8"));
const OUT = "ftsemib-bootstrap-staging";
fs.mkdirSync(OUT, { recursive: true });
const CHART_BASE = "https://grafici.borsaitaliana.it";
const normalize = s => s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "_").replace(/^_|_$/g, "");
function attr(html, name) {
  const m = html.match(new RegExp("(?:^|[\\s<])" + name + "\\s*=\\s*(['\"])(.*?)\\1", "i"));
  return m ? m[2] : null;
}
async function fetchText(url, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36", "Accept-Language": "it-IT,it;q=0.9", ...headers } });
  const body = await r.text();
  if (!r.ok) throw Error("HTTP " + r.status + ": " + url);
  return { body, status: r.status };
}
async function fetchDaily(cfg) {
  const page = await fetchText(CHART_BASE + "/interactive-chart/" + cfg.isin + "-" + cfg.exchange + "?lang=it", { Accept: "text/html,application/xhtml+xml" });
  const token = attr(page.body, "token");
  if (!token) throw Error("Missing chart token");
  const apiUrl = (attr(page.body, "url") || CHART_BASE + "/api/").replace(/\/+$/, "");
  const code = attr(page.body, "code") || cfg.isin;
  const exch = attr(page.body, "exchcode") || cfg.exchange;
  const url = apiUrl + "/instruments/" + code + "," + exch + ",ISIN/history/period?period=6M";
  let lastError;
  for (const auth of [token, "Bearer " + token]) {
    try {
      const result = await fetchText(url, { Accept: "application/json", Authorization: auth });
      const json = JSON.parse(result.body);
      const rows = (json.history || json).historyDt;
      if (!Array.isArray(rows)) throw Error("Missing historyDt");
      return rows.map(row => {
        const d = String(row.dt || "");
        if (!/^\d{8}$/.test(d)) return null;
        const date = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
        const [open, high, low, close] = [row.openPx, row.highPx, row.lowPx, row.closePx].map(Number);
        if (![open, high, low, close].every(Number.isFinite)) return null;
        return { date, timestamp: Date.UTC(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8)), open, high, low, close };
      }).filter(Boolean);
    } catch (e) { lastError = e; }
  }
  throw lastError || Error("No history");
}
const round = x => x == null ? null : Number(x.toFixed(6));
function sma(a, period) {
  return a.map((_, i) => i < period - 1 ? null : round(a.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period));
}
function ema(a, period) {
  const out = a.map(() => null);
  if (a.length < period) return out;
  let value = a.slice(0, period).reduce((s, x) => s + x, 0) / period;
  out[period - 1] = round(value);
  for (let i = period; i < a.length; i++) {
    value = value + (a[i] - value) * 2 / (period + 1);
    out[i] = round(value);
  }
  return out;
}
function decorate(bars) {
  const closes = bars.map(x => x.close), e10 = ema(closes, 10), s20 = sma(closes, 20), s50 = sma(closes, 50);
  return bars.map((x, i) => ({ ...x, ema10: e10[i], sma20: s20[i], sma50: s50[i] }));
}
function romeDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
async function main() {
  if (report.resolved !== 40 || report.instruments.length !== 40 || report.instruments.some(x => !/^[A-Z]{2}[A-Z0-9]{10}$/.test(x.isin || ""))) throw Error("Validation manifest not complete");
  const today = romeDate();
  const result = { generatedAtUtc: new Date().toISOString(), source: "Borsa Italiana official chart API", mode: "isolated_bootstrap", expected: 40, passed: 0, failed: 0, instruments: {}, errors: {} };
  const history = { instruments: {} };
  const ids = new Set();
  for (const cfg of report.instruments) {
    const key = normalize(cfg.name);
    try {
      if (ids.has(cfg.isin)) throw Error("Duplicate ISIN " + cfg.isin);
      ids.add(cfg.isin);
      const raw = await fetchDaily(cfg);
      const sorted = [...new Map(raw.filter(x => x.date < today).map(x => [x.date, x])).values()].sort((a, b) => a.timestamp - b.timestamp);
      const bars = sorted.slice(-80);
      if (bars.length < 80) throw Error("Insufficient completed candles: " + bars.length);
      for (const b of bars) {
        if (b.low > b.high || b.open < b.low - 0.00001 || b.open > b.high + 0.00001 || b.close < b.low - 0.00001 || b.close > b.high + 0.00001 || b.close <= 0) throw Error("Invalid OHLC on " + b.date);
      }
      if (Date.now() - bars.at(-1).timestamp > 7 * 86400000) throw Error("History stale: " + bars.at(-1).date);
      const decorated = decorate(bars);
      history.instruments[key] = { name: cfg.name, isin: cfg.isin, exchange: cfg.exchange, source: result.source, bars: decorated };
      result.instruments[key] = { name: cfg.name, isin: cfg.isin, bars: bars.length, latestDate: bars.at(-1).date, earliestDate: bars[0].date, latestClose: bars.at(-1).close, ema10: decorated.at(-1).ema10, sma20: decorated.at(-1).sma20, sma50: decorated.at(-1).sma50 };
      result.passed++;
      console.log("OK", key, cfg.isin, bars.length, bars.at(-1).date);
    } catch(e) {
      result.failed++;
      result.errors[key] = String(e.message || e);
      console.error("FAIL", key, result.errors[key]);
    }
  }
  fs.writeFileSync(OUT + "/ftsemib-bootstrap-report.json", JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(OUT + "/ftsemib-history-staging.json", JSON.stringify(history, null, 2) + "\n");
  console.log("BOOTSTRAP SUMMARY", JSON.stringify({ passed: result.passed, failed: result.failed, errors: result.errors }));
  if (result.failed) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
