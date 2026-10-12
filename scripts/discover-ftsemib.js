const ITEMS = [
  { key: "ENI", isin: "IT0003132476" },
  { key: "ENEL", isin: "IT0003128367" }
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      "Accept": "text/html,application/xhtml+xml,*/*"
    },
    redirect: "follow"
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return { text, finalUrl: res.url };
}

(async()=>{
  let ok = true;

  for (const item of ITEMS) {
    try {
      const url =
        "https://grafici.borsaitaliana.it/interactive-chart/" +
        item.isin +
        "-XMIL?lang=it";

      const r = await fetchText(url);

      console.log("\nRAW CHART PAGE " + item.key);
      console.log("FINAL URL: " + r.finalUrl);
      console.log("HTML START");
      console.log(r.text);
      console.log("HTML END");
    } catch (e) {
      ok = false;
      console.log("\nRAW CHART PAGE " + item.key);
      console.log("ERROR: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (!ok) process.exitCode = 1;
})().catch(e=>{
  console.error(e.stack || e.message);
  process.exit(1);
});
