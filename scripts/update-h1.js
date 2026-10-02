const fs = require("fs");

const HOUR_MS = 3600000;
const IG_MAX_BARS = 150;
const IG_BASE = "https://demo-api.ig.com/gateway/deal";
const RECENT_BARS = 8;

function floorToUtcHour(timestamp = Date.now()) { return Math.floor(timestamp / HOUR_MS) * HOUR_MS; }
function round(value, digits = 8) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(Number(value).toFixed(digits));
}
function romeTime(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(timestamp));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
function normalizeBar(bar) {
  return {
    timestamp: Number(bar.timestamp),
    startUtc: new Date(Number(bar.timestamp)).toISOString(),
    endUtc: new Date(Number(bar.timestamp) + HOUR_MS).toISOString(),
    startEuropeRome: romeTime(Number(bar.timestamp)),
    endEuropeRome: romeTime(Number(bar.timestamp) + HOUR_MS),
    open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close),
    volume: bar.volume == null ? null : Number(bar.volume)
  };
}
function calculateSma(values, period) {
  const result = new Array(values.length).fill(null); let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]; if (i >= period) sum -= values[i-period];
    if (i >= period-1) result[i] = sum / period;
  } return result;
}
function calculateEma(values, period) {
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let seed = 0; for (let i=0;i<period;i++) seed += values[i];
  let ema = seed/period; result[period-1] = ema; const m = 2/(period+1);
  for (let i=period;i<values.length;i++) { ema=(values[i]-ema)*m+ema; result[i]=ema; }
  return result;
}
function decorateClosedBars(rawBars, now=Date.now()) {
  const currentHourStart=floorToUtcHour(now);
  const closed=rawBars.map(normalizeBar).filter(b =>
    Number.isFinite(b.timestamp)&&Number.isFinite(b.open)&&Number.isFinite(b.high)&&
    Number.isFinite(b.low)&&Number.isFinite(b.close)&&b.timestamp<currentHourStart
  ).sort((a,b)=>a.timestamp-b.timestamp);
  if (closed.length<50) throw new Error(`Only ${closed.length} completed H1 bars available; at least 50 required.`);
  const closes=closed.map(b=>b.close), e=calculateEma(closes,10), s20=calculateSma(closes,20), s50=calculateSma(closes,50);
  const d=closed.map((b,i)=>({...b,ema10:round(e[i]),sma20:round(s20[i]),sma50:round(s50[i])}));
  const latest=d.at(-1), previous=d.at(-2), closeTime=latest.timestamp+HOUR_MS;
  return {
    barsUsed:d.length,currentOpenCandleExcluded:true,latestCompleted:latest,previousCompleted:previous,
    recentCompleted:d.slice(-RECENT_BARS),
    indicators:{ema10:latest.ema10,sma20:latest.sma20,sma50:latest.sma50,
      previous:{ema10:previous.ema10,sma20:previous.sma20,sma50:previous.sma50}},
    freshness:{latestCandleClosedAtUtc:new Date(closeTime).toISOString(),
      latestCandleClosedAtEuropeRome:romeTime(closeTime),
      minutesSinceLatestCandleClose:round((now-closeTime)/60000,1),
      expectedLatestCandleStartUtc:new Date(currentHourStart-HOUR_MS).toISOString(),
      hasLatestExpectedClosedCandle:latest.timestamp===currentHourStart-HOUR_MS}
  };
}
async function ig(path, { method="GET", version="1", auth={}, body }={}) {
  const res=await fetch(IG_BASE+path,{method,headers:{
    "X-IG-API-KEY":process.env.IG_API_KEY,"Version":version,
    "Accept":"application/json; charset=UTF-8","Content-Type":"application/json; charset=UTF-8",...auth
  },body:body?JSON.stringify(body):undefined});
  const text=await res.text(); let data;
  try { data=text?JSON.parse(text):{}; } catch { data={raw:text}; }
  if(!res.ok) throw new Error(`IG HTTP ${res.status}: ${JSON.stringify(data)}`);
  return {res,data};
}
async function loginIg() {
  for(const k of ["IG_API_KEY","IG_USERNAME","IG_PASSWORD"]) if(!process.env[k]) throw new Error(`${k} is not configured.`);
  const x=await ig("/session",{method:"POST",version:"2",
    body:{identifier:process.env.IG_USERNAME.trim(),password:process.env.IG_PASSWORD}});
  const cst=x.res.headers.get("cst"), sec=x.res.headers.get("x-security-token");
  if(!cst||!sec) throw new Error("IG session tokens missing.");
  return {CST:cst,"X-SECURITY-TOKEN":sec};
}
function mid(p) {
  const b=Number(p?.bid),a=Number(p?.ask);
  return Number.isFinite(b)&&Number.isFinite(a)?(b+a)/2:null;
}
async function fetchIg(auth, epic, sourceInstrument, scale=1) {
  const x=await ig("/prices/"+encodeURIComponent(epic)+"?resolution=HOUR&max="+IG_MAX_BARS+"&pageSize="+IG_MAX_BARS,
    {version:"3",auth});
  if(!Array.isArray(x.data.prices)||!x.data.prices.length) throw new Error(`IG returned no H1 data for ${sourceInstrument}.`);
  const bars=x.data.prices.map(p=>({
    timestamp:Date.parse(p.snapshotTimeUTC+"Z"),
    open:mid(p.openPrice)/scale,high:mid(p.highPrice)/scale,
    low:mid(p.lowPrice)/scale,close:mid(p.closePrice)/scale,
    volume:p.lastTradedVolume??null
  }));
  return {source:"IG Demo",sourceSymbol:epic,sourceInstrument,vwap:null,...decorateClosedBars(bars)};
}
async function safeLoad(name, loader) {
  try { return {ok:true,name,data:await loader()}; }
  catch(e) { return {ok:false,name,error:e instanceof Error?e.message:String(e)}; }
}
(async()=>{
  const generatedAt=Date.now();
  const auth=await loginIg();
  const results=await Promise.all([
    safeLoad("EURUSD",()=>fetchIg(auth,"CS.D.EURUSD.CEB.IP","EUR/USD")),
    safeLoad("XAUUSD",()=>fetchIg(auth,"CS.D.CFEGOLD.CEB.IP","Spot Gold ($1)")),
    safeLoad("WTI",()=>fetchIg(auth,"CC.D.CL.UEB.IP","Oil - US Crude (1$)",100))
  ]);
  const instruments={}, errors={};
  for(const r of results) r.ok ? instruments[r.name]=r.data : errors[r.name]=r.error;
  const output={ok:Object.keys(errors).length===0,generatedAtUtc:new Date(generatedAt).toISOString(),
    generatedAtEuropeRome:romeTime(generatedAt),timeframe:"1h",instruments,errors};
  fs.writeFileSync("h1-latest.json",JSON.stringify(output,null,2)+"\n");
  console.log(JSON.stringify({ok:output.ok,generatedAtUtc:output.generatedAtUtc,errors},null,2));
  if(!output.ok) process.exitCode=1;
})();
