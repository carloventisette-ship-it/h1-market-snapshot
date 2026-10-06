const fs = require("fs");

const HOUR_MS=3600000, IG_BASE="https://demo-api.ig.com/gateway/deal";
const HISTORY_FILE="h1-history.json", RECENT_BARS=8, BOOTSTRAP_BARS=150, INCREMENTAL_BARS=3;
const MARKETS={
  EURUSD:{epic:"CS.D.EURUSD.CEB.IP",name:"EUR/USD",scale:1},
  XAUUSD:{epic:"CS.D.CFEGOLD.CEB.IP",name:"Spot Gold ($1)",scale:1},
  WTI:{epic:"CC.D.CL.UEB.IP",name:"Oil - US Crude (1$)",scale:100}
};

function floorHour(t=Date.now()){return Math.floor(t/HOUR_MS)*HOUR_MS;}
function round(v,d=8){return v==null||Number.isNaN(v)?null:Number(Number(v).toFixed(d));}
function romeTime(t){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(t));
  const g=k=>p.find(x=>x.type===k)?.value;
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}
function sma(v,p){const o=new Array(v.length).fill(null);let s=0;for(let i=0;i<v.length;i++){s+=v[i];if(i>=p)s-=v[i-p];if(i>=p-1)o[i]=s/p;}return o;}
function ema(v,p){const o=new Array(v.length).fill(null);if(v.length<p)return o;let s=0;for(let i=0;i<p;i++)s+=v[i];let e=s/p;o[p-1]=e;const m=2/(p+1);for(let i=p;i<v.length;i++){e=(v[i]-e)*m+e;o[i]=e;}return o;}
function normalize(b){return {timestamp:Number(b.timestamp),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:b.volume==null?null:Number(b.volume)};}
function merge(oldBars,newBars){
  const m=new Map(); for(const b of [...oldBars,...newBars]) if(Number.isFinite(Number(b.timestamp)))m.set(Number(b.timestamp),normalize(b));
  return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-BOOTSTRAP_BARS);
}
function decorate(raw,now=Date.now()){
  const current=floorHour(now);
  const closed=raw.map(normalize).filter(b=>[b.timestamp,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.timestamp<current).sort((a,b)=>a.timestamp-b.timestamp);
  if(closed.length<50)throw new Error(`Only ${closed.length} completed H1 bars available; at least 50 required.`);
  const c=closed.map(b=>b.close),e=ema(c,10),s20=sma(c,20),s50=sma(c,50);
  const d=closed.map((b,i)=>({...b,startUtc:new Date(b.timestamp).toISOString(),endUtc:new Date(b.timestamp+HOUR_MS).toISOString(),
    startEuropeRome:romeTime(b.timestamp),endEuropeRome:romeTime(b.timestamp+HOUR_MS),
    ema10:round(e[i]),sma20:round(s20[i]),sma50:round(s50[i])}));
  const latest=d.at(-1),prev=d.at(-2),ct=latest.timestamp+HOUR_MS;
  return {barsUsed:d.length,currentOpenCandleExcluded:true,latestCompleted:latest,previousCompleted:prev,recentCompleted:d.slice(-RECENT_BARS),
    indicators:{ema10:latest.ema10,sma20:latest.sma20,sma50:latest.sma50,previous:{ema10:prev.ema10,sma20:prev.sma20,sma50:prev.sma50}},
    freshness:{latestCandleClosedAtUtc:new Date(ct).toISOString(),latestCandleClosedAtEuropeRome:romeTime(ct),
      minutesSinceLatestCandleClose:round((now-ct)/60000,1),expectedLatestCandleStartUtc:new Date(current-HOUR_MS).toISOString(),
      hasLatestExpectedClosedCandle:latest.timestamp===current-HOUR_MS}};
}
async function ig(path,{method="GET",version="1",auth={},body}={}){
  const res=await fetch(IG_BASE+path,{method,headers:{"X-IG-API-KEY":process.env.IG_API_KEY,"Version":version,
    "Accept":"application/json; charset=UTF-8","Content-Type":"application/json; charset=UTF-8",...auth},body:body?JSON.stringify(body):undefined});
  const text=await res.text();let data;try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!res.ok)throw new Error(`IG HTTP ${res.status}: ${JSON.stringify(data)}`);return {res,data};
}
async function login(){
  for(const k of ["IG_API_KEY","IG_USERNAME","IG_PASSWORD"])if(!process.env[k])throw new Error(`${k} is not configured.`);
  const x=await ig("/session",{method:"POST",version:"2",body:{identifier:process.env.IG_USERNAME.trim(),password:process.env.IG_PASSWORD}});
  const c=x.res.headers.get("cst"),s=x.res.headers.get("x-security-token");if(!c||!s)throw new Error("IG session tokens missing.");
  return {CST:c,"X-SECURITY-TOKEN":s};
}
function mid(p){const b=Number(p?.bid),a=Number(p?.ask);return Number.isFinite(b)&&Number.isFinite(a)?(b+a)/2:null;}
async function fetchBars(auth,cfg,max){
  const x=await ig("/prices/"+encodeURIComponent(cfg.epic)+"?resolution=HOUR&max="+max+"&pageSize="+max,{version:"3",auth});
  if(!Array.isArray(x.data.prices)||!x.data.prices.length)throw new Error(`IG returned no H1 data for ${cfg.name}.`);
  return {bars:x.data.prices.map(p=>({timestamp:Date.parse(p.snapshotTimeUTC+"Z"),open:mid(p.openPrice)/cfg.scale,
    high:mid(p.highPrice)/cfg.scale,low:mid(p.lowPrice)/cfg.scale,close:mid(p.closePrice)/cfg.scale,volume:p.lastTradedVolume??null})),
    allowance:x.data.allowance||null};
}
(async()=>{
  const now=Date.now(),auth=await login();
  let history={instruments:{}};
  if(fs.existsSync(HISTORY_FILE)){try{history=JSON.parse(fs.readFileSync(HISTORY_FILE,"utf8"));}catch{}}
  const instruments={},errors={};
  for(const [key,cfg] of Object.entries(MARKETS)){
    try{
      const old=history.instruments[key]?.bars||[];
      const max=old.length>=50?INCREMENTAL_BARS:BOOTSTRAP_BARS;
      const got=await fetchBars(auth,cfg,max);
      const merged=merge(old,got.bars);
      history.instruments[key]={epic:cfg.epic,sourceInstrument:cfg.name,bars:merged};
      instruments[key]={source:"IG Demo",sourceSymbol:cfg.epic,sourceInstrument:cfg.name,vwap:null,
        updateMode:old.length>=50?"incremental":"bootstrap",barsRequested:max,allowance:got.allowance,...decorate(merged,now)};
    }catch(e){errors[key]=e instanceof Error?e.message:String(e);}
  }
  const output={ok:Object.keys(errors).length===0,generatedAtUtc:new Date(now).toISOString(),generatedAtEuropeRome:romeTime(now),timeframe:"1h",instruments,errors};
  if(Object.keys(instruments).length)fs.writeFileSync(HISTORY_FILE,JSON.stringify(history,null,2)+"\n");
  fs.writeFileSync("h1-latest.json",JSON.stringify(output,null,2)+"\n");
  console.log(JSON.stringify({ok:output.ok,generatedAtUtc:output.generatedAtUtc,
    modes:Object.fromEntries(Object.entries(instruments).map(([k,v])=>[k,{mode:v.updateMode,barsRequested:v.barsRequested,allowance:v.allowance}])),errors},null,2));
  if(!output.ok)process.exitCode=1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
