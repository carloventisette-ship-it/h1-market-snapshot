const ITEMS = [
  { key: "ENI", isin: "IT0003132476" },
  { key: "ENEL", isin: "IT0003128367" }
];

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
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function itNum(s) {
  if (!s) return null;
  const cleaned = String(s)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

function extractAfterLabel(text, label) {
  const i = text.toLowerCase().indexOf(label.toLowerCase());
  if (i < 0) return null;
  const tail = text.slice(i + label.length, i + label.length + 80);
  const m = tail.match(/[0-9][0-9.,]*/);
  return m ? m[0] : null;
}

function extractDate(text) {
  const label = "Ultimo Contratto:";
  const i = text.toLowerCase().indexOf(label.toLowerCase());
  if (i < 0) return null;
  const tail = text.slice(i + label.length, i + label.length + 40);
  const m = tail.match(/\d{2}\/\d{2}\/\d{2}/);
  if (!m) return null;
  const [dd, mm, yy] = m[0].split("/");
  return "20" + yy + "-" + mm + "-" + dd;
}

async function fetchOfficial(item) {
  const url =
    "https://www.borsaitaliana.it/borsa/azioni/listino-ufficiale.html?isin=" +
    item.isin +
    "&lang=it&mic=MTAA";

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      "Accept": "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  const html = await res.text();
  if (!res.ok) {
    throw new Error("Borsa Italiana HTTP " + res.status + " for " + item.key);
  }

  const text = textOf(html);
  const date = extractDate(text);
  const open = itNum(extractAfterLabel(text, "Prezzo di Asta di Apertura"));
  const high = itNum(extractAfterLabel(text, "Prezzo massimo"));
  const low = itNum(extractAfterLabel(text, "Prezzo minimo"));
  const close = itNum(extractAfterLabel(text, "Prezzo di Riferimento di Chiusura"));

  if (!date || ![open, high, low, close].every(Number.isFinite)) {
    throw new Error(
      "Could not parse official OHLC for " +
        item.key +
        "; date=" +
        date +
        "; open=" +
        open +
        "; high=" +
        high +
        "; low=" +
        low +
        "; close=" +
        close +
        "; htmlBytes=" +
        html.length
    );
  }

  return {
    key: item.key,
    isin: item.isin,
    source: "Borsa Italiana - Listino Ufficiale",
    date,
    open,
    high,
    low,
    close,
    sourceUrl: url
  };
}

(async () => {
  let ok = true;

  for (const item of ITEMS) {
    try {
      const result = await fetchOfficial(item);
      console.log("\nBORSA TEST " + item.key);
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } catch (e) {
      ok = false;
      console.log("\nBORSA TEST " + item.key);
      console.log(
        JSON.stringify(
          {
            ok: false,
            key: item.key,
            isin: item.isin,
            error: e instanceof Error ? e.message : String(e)
          },
          null,
          2
        )
      );
    }
  }

  if (!ok) process.exitCode = 1;
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
