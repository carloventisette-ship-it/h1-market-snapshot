const ITEMS = [
  { key: "ENI", isin: "IT0003132476", exch: "XMIL" },
  { key: "ENEL", isin: "IT0003128367", exch: "XMIL" }
];

const BASE = "https://grafici.borsaitaliana.it";

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
    throw new Error("HTTP " + res.status + " for " + url + ": " + text.slice(0, 300));
  }
  return { text, res };
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

async function getConfig(item) {
  const page = BASE + "/interactive-chart/" + item.isin + "-" + item.exch + "?lang=it";
  const { text } = await fetchText(page, {
    Accept: "text/html,application/xhtml+xml"
  });

  const token = attr(text, "token");
  const apiUrl = attr(text, "url") || (BASE + "/api/");
  const code = attr(text, "code") || item.isin;
  const exch = attr(text, "exchcode") || item.exch;

  if (!token) throw new Error("Chart token not found for " + item.key);
  return { token, apiUrl, code, exch };
}

function joinUrl(base, path) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

async function history1M(item) {
  const cfg = await getConfig(item);
  const path = "instruments/" + cfg.code + "," + cfg.exch + ",ISIN/history/period";
  const endpoint = joinUrl(cfg.apiUrl, path);
  const requestUrl = endpoint + "?period=1M";

  const authHeaders = [
    cfg.token,
    "Bearer " + cfg.token
  ];

  let lastErr = null;

  for (const authorization of authHeaders) {
    try {
      const { text, res } = await fetchText(requestUrl, {
        Accept: "application/json",
        Authorization: authorization
      });

      const json = JSON.parse(text);
      const hist = json.history || json;
      const rows = Array.isArray(hist.historyDt) ? hist.historyDt : [];

      if (rows.length === 0) throw new Error("No historyDt rows");

      return {
        status: res.status,
        keys: Object.keys(hist),
        rows
      };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("History request failed");
}

(async () => {
  let ok = true;

  for (const item of ITEMS) {
    try {
      const r = await history1M(item);
      const rows = r.rows;

      console.log("\nHISTORY API TEST " + item.key);
      console.log(JSON.stringify({
        ok: true,
        status: r.status,
        rows: rows.length,
        responseKeys: r.keys,
        first: rows[0],
        last: rows[rows.length - 1]
      }, null, 2));
    } catch (e) {
      ok = false;
      console.log("\nHISTORY API TEST " + item.key);
      console.log(JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      }, null, 2));
    }
  }

  if (!ok) process.exitCode = 1;
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
