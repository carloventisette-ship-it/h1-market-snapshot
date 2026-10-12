const ITEMS = [
  { key: "ENI", isin: "IT0003132476", exch: "XMIL" },
  { key: "ENEL", isin: "IT0003128367", exch: "XMIL" }
];

const BASE = "https://grafici.borsaitaliana.it";

async function fetchText(url, headers={}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      ...headers
    },
    redirect: "follow"
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url + ": " + text.slice(0,300));
  return { text, res };
}

function attr(html, name) {
  const re = new RegExp(name + "=[\\\"\\\']([^\\\"\\\']+)[\\\"\\\']", "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

async function getConfig(item) {
  const page = BASE + "/interactive-chart/" + item.isin + "-" + item.exch + "?lang=it";
  const {text} = await fetchText(page, {"Accept":"text/html,application/xhtml+xml"});
  const token = attr(text, "token");
  const url = attr(text, "url") || (BASE + "/api/");
  const code = attr(text, "code") || item.isin;
  const exch = attr(text, "exchcode") || item.exch;
  if (!token) throw new Error("Chart token not found for " + item.key);
  return {token, url, code, exch};
}

async function history1M(item) {
  const cfg = await getConfig(item);
  const endpoint = cfg.url.replace(/\\/?$/, "/") +
    "instruments/" + encodeURIComponent(cfg.code) + "," + encodeURIComponent(cfg.exch) + ",ISIN/history/period";

  const candidates = [
    endpoint + "?period=1M",
    endpoint + "?period=1M&add-last-price=false"
  ];

  let lastErr;
  for (const url of candidates) {
    try {
      const {text,res} = await fetchText(url, {
        "Accept":"application/json",
        "Authorization":"Bearer " + cfg.token
      });
      const json = JSON.parse(text);
      const hist = json.history || json;
      const rows = hist.historyDt || [];
      if (!Array.isArray(rows) || rows.length===0) throw new Error("No historyDt rows");
      return {
        sourceUrl:url.replace(/([?&])token=[^&]+/gi,"$1token=REDACTED"),
        status:res.status,
        keys:Object.keys(hist),
        rows
      };
    } catch(e) { lastErr=e; }
  }
  throw lastErr;
}

(async()=>{
  let ok=true;
  for (const item of ITEMS) {
    try {
      const r = await history1M(item);
      const rows = r.rows;
      console.log("\\nHISTORY API TEST " + item.key);
      console.log(JSON.stringify({
        ok:true,
        status:r.status,
        rows:rows.length,
        responseKeys:r.keys,
        first:rows[0],
        last:rows[rows.length-1]
      },null,2));
    } catch(e) {
      ok=false;
      console.log("\\nHISTORY API TEST " + item.key);
      console.log(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)},null,2));
    }
  }
  if(!ok) process.exitCode=1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
