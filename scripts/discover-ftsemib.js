const JS_URL = "https://grafici.borsaitaliana.it/assets/js/web-components-7921a5d0dc47cfe5baadae99b28536c5.js";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      "Accept": "*/*"
    },
    redirect: "follow"
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return { text, finalUrl: res.url, contentType: res.headers.get("content-type") };
}

function contexts(text, needle, before=240, after=520, max=30) {
  const out = [];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let pos = 0;
  while ((pos = lower.indexOf(n, pos)) >= 0 && out.length < max) {
    out.push(text.slice(Math.max(0,pos-before), Math.min(text.length,pos+after)));
    pos += n.length;
  }
  return out;
}

function unique(xs) { return [...new Set(xs)]; }

(async()=>{
  const r = await fetchText(JS_URL);
  const needles = ["fetch(", "api/", "history", "historical", "series", "price", "instrument", "chart", "interval", "resolution", "exchcode", "isin"];
  const result = {};
  for (const needle of needles) result[needle] = unique(contexts(r.text, needle));
  console.log(JSON.stringify({
    ok:true,
    finalUrl:r.finalUrl,
    contentType:r.contentType,
    jsBytes:r.text.length,
    contexts:result
  }, null, 2));
})().catch(e=>{
  console.error(e.stack || e.message);
  process.exit(1);
});
