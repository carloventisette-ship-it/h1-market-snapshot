const ITEMS = [
  { key: "ENI", isin: "IT0003132476", market: "MTAA" },
  { key: "ENEL", isin: "IT0003128367", market: "MTAA" }
];

function uniq(xs){ return [...new Set(xs.filter(Boolean))]; }

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
  return { text, finalUrl: res.url, contentType: res.headers.get("content-type") };
}

function extractDiagnostics(html) {
  const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m=>m[1]);
  const urls = [...html.matchAll(/https?:\/\/[^"' <>)]+/gi)].map(m=>m[0]);
  const apiLike = [...html.matchAll(/["']([^"']*(?:api|chart|history|historical|timeseries|series|data)[^"']*)["']/gi)]
    .map(m=>m[1])
    .filter(x=>x.length<300);
  return {
    scriptSrcs: uniq(scriptSrcs).slice(0,50),
    absoluteUrls: uniq(urls).slice(0,50),
    apiLikeStrings: uniq(apiLike).slice(0,100)
  };
}

(async()=>{
  let ok=true;

  for(const item of ITEMS){
    try{
      const url =
        "https://grafici.borsaitaliana.it/interactive-chart/" +
        item.isin + "-" + item.market + "?lang=it";

      const r = await fetchText(url);
      const diag = extractDiagnostics(r.text);

      console.log("\nCHART DIAGNOSTIC " + item.key);
      console.log(JSON.stringify({
        ok:true,
        requestedUrl:url,
        finalUrl:r.finalUrl,
        contentType:r.contentType,
        htmlBytes:r.text.length,
        ...diag
      },null,2));
    }catch(e){
      ok=false;
      console.log("\nCHART DIAGNOSTIC " + item.key);
      console.log(JSON.stringify({
        ok:false,
        error:e instanceof Error?e.message:String(e)
      },null,2));
    }
  }

  if(!ok) process.exitCode=1;
})().catch(e=>{
  console.error(e.stack||e.message);
  process.exit(1);
});
