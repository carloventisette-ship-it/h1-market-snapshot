const { getHistoricalRates } = require("dukascopy-node");
const fs = require("fs");

const HOUR_MS = 3600000;
const TWELVE_OUTPUT_SIZE = 150;
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
async function fetchTwelveData(symbol) {
  const apiKey=process.env.TWELVE_DATA_API_KEY; if(!apiKey) throw new Error("TWELVE_DATA_API_KEY is not configured.");
  const url=new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol",symbol); url.searchParams.set("interval","1h");
  url.searchParams.set("outputsize",String(TWELVE_OUTPUT_SIZE)); url.searchParams.set("format","JSON");
  url.searchParams.set("timezone","UTC"); url.searchParams.set("apikey",apiKey);
  const response=await fetch(url,{headers:{"User-Agent":"h1-market-snapshot/1.0"},cache:"no-store"});
  const payload=await response.json();
  if(!response.ok||payload.status==="error"||!Array.isArray(payload.values))
    throw new Error(`Twelve Data error for ${symbol}: ${payload.message||payload.code||"HTTP "+response.status}`);
  const bars=payload.values.map(x=>({timestamp:Date.parse(`${x.datetime.replace(" ","T")}Z`),
    open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume??null}));
  return {source:"Twelve Data",sourceSymbol:symbol,vwap:null,...decorateClosedBars(bars)};
}
async function fetchWti() {
  const now=new Date(), from=new Date(now.getTime()-14*24*HOUR_MS), to=new Date(now.getTime()+HOUR_MS);
  const data=await getHistoricalRates({instrument:"lightcmdusd",dates:{from,to},timeframe:"h1",format:"json",priceType:"bid",volumes:true});
  if(!Array.isArray(data)||!data.length) throw new Error("Dukascopy returned no WTI H1 data.");
  const bars=data.map(x=>({timestamp:x.timestamp,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume??null}));
  return {source:"Dukascopy",sourceSymbol:"lightcmdusd",vwap:null,...decorateClosedBars(bars)};
}
async function safeLoad(name, loader) {
  try { return {ok:true,name,data:await loader()}; }
  catch(e) { return {ok:false,name,error:e instanceof Error?e.message:String(e)}; }
}
(async()=>{
  const generatedAt=Date.now();
  const results=await Promise.all([
    safeLoad("EURUSD",()=>fetchTwelveData("EUR/USD")),
    safeLoad("XAUUSD",()=>fetchTwelveData("XAU/USD")),
    safeLoad("WTI",fetchWti)
  ]);
  const instruments={}, errors={};
  for(const r of results) r.ok ? instruments[r.name]=r.data : errors[r.name]=r.error;
  const output={ok:Object.keys(errors).length===0,generatedAtUtc:new Date(generatedAt).toISOString(),
    generatedAtEuropeRome:romeTime(generatedAt),timeframe:"1h",instruments,errors};
  fs.writeFileSync("h1-latest.json",JSON.stringify(output,null,2)+"\n");
  console.log(JSON.stringify({ok:output.ok,generatedAtUtc:output.generatedAtUtc,errors},null,2));
  if(!output.ok) process.exitCode=1;
})();
