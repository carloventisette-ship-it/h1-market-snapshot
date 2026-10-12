const BASE = "https://demo-api.ig.com/gateway/deal";

async function ig(path, { method="GET", version="1", auth={}, body }={}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "X-IG-API-KEY": process.env.IG_API_KEY,
      "Version": version,
      "Accept": "application/json; charset=UTF-8",
      "Content-Type": "application/json; charset=UTF-8",
      ...auth
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
  if (!res.ok) throw new Error(`IG HTTP ${res.status}: ${JSON.stringify(data)}`);
  return {res,data};
}

async function login() {
  for (const k of ["IG_API_KEY","IG_USERNAME","IG_PASSWORD"]) {
    if (!process.env[k]) throw new Error(`${k} is not configured`);
  }
  const x = await ig("/session", {
    method:"POST", version:"2",
    body:{identifier:process.env.IG_USERNAME.trim(),password:process.env.IG_PASSWORD}
  });
  const cst=x.res.headers.get("cst");
  const sec=x.res.headers.get("x-security-token");
  if (!cst || !sec) throw new Error("IG session tokens missing");
  return {CST:cst,"X-SECURITY-TOKEN":sec};
}

(async()=>{
  const auth=await login();
  const queries=["ENI","Enel"];
  for (const q of queries) {
    const x=await ig("/markets?searchTerm="+encodeURIComponent(q), {version:"1",auth});
    const rows=(x.data.markets||[]).slice(0,20).map(m=>({
      epic:m.epic,
      instrumentName:m.instrumentName,
      instrumentType:m.instrumentType,
      expiry:m.expiry,
      marketStatus:m.marketStatus,
      bid:m.bid,
      offer:m.offer
    }));
    console.log("\nSEARCH "+q);
    console.log(JSON.stringify(rows,null,2));

    const chosen=rows[0];
    if (!chosen?.epic) throw new Error(`No EPIC found for ${q}`);

    try {
      const p=await ig(
        "/prices/"+encodeURIComponent(chosen.epic)+"?resolution=DAY&max=1&pageSize=1",
        {version:"3",auth}
      );
      const price=(p.data.prices||[])[0];
      if (!price) throw new Error(`No D1 price returned for ${q} (${chosen.epic})`);

      const mid=x=>{
        const bid=Number(x?.bid),ask=Number(x?.ask);
        return Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:null;
      };

      console.log("D1 TEST "+q);
      console.log(JSON.stringify({
        ok:true,
        epic:chosen.epic,
        instrumentName:chosen.instrumentName,
        snapshotTimeUTC:price.snapshotTimeUTC||null,
        open:mid(price.openPrice),
        high:mid(price.highPrice),
        low:mid(price.lowPrice),
        close:mid(price.closePrice),
        volume:price.lastTradedVolume??null,
        allowance:p.data.allowance||null
      },null,2));
    } catch (e) {
      console.log("D1 TEST "+q);
      console.log(JSON.stringify({
        ok:false,
        epic:chosen.epic,
        instrumentName:chosen.instrumentName,
        error:e instanceof Error?e.message:String(e)
      },null,2));
    }
  }
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
