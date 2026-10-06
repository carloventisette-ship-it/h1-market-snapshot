const fs = require("fs");

const BASE="https://demo-api.ig.com/gateway/deal";
const HISTORY_FILE="ftsemib-history.json";
const SNAPSHOT_FILE="ftsemib-latest.json";
const BOOTSTRAP_BARS=80;

const INSTRUMENTS=[
  {symbol:"ENI",name:"Eni",epic:process.env.IG_EPIC_ENI||null},
  {symbol:"ENEL",name:"Enel",epic:process.env.IG_EPIC_ENEL||null}
];

function round(v,d=6){ return v==null||Number.isNaN(v)?null:Number(Number(v).toFixed(d)); }
function mid(p){
  const b=Number(p?.bid),a=Number(p?.ask);
  return Number.isFinite(b)&&Number.isFinite(a)?(b+a)/2:null;
}
function sma(values,p){
  const out=new Array(values.length).fill(null); let sum=0;
  for(let i=0;i<values.length;i++){sum+=values[i];if(i>=p)sum-=values[i-p];if(i>=p-1)out[i]=sum/p;}
  return out;
}
function ema(values,p){
  const out=new Array(values.length).fill(null); if(values.length<p)return out;
  let seed=0;for(let i=0;i<p;i++)seed+=values[i];
  let e=seed/p;out[p-1]=e;const k=2/(p+1);
  for(let i=p;i<values.length;i++){e=(values[i]-e)*k+e;out[i]=e;}
  return out;
}
function decorate(bars){
  const sorted=[...bars].sort((a,b)=>a.timestamp-b.timestamp);
  const closes=sorted.map(x=>x.close);
  const e10=ema(closes,10),s20=sma(closes,20),s50=sma(closes,50);
  return sorted.map((b,i)=>({...b,ema10:round(e10[i]),sma20:round(s20[i]),sma50:round(s50[i])}));
}
function mergeBars(oldBars,newBars){
  const m=new Map();
  for(const b of [...oldBars,...newBars])m.set(b.date,b);
  return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp);
}
async function ig(path,{method="GET",version="1",auth={},body}={}){
  const res=await fetch(BASE+path,{method,headers:{
    "X-IG-API-KEY":process.env.IG_API_KEY,"Version":version,
    "Accept":"application/json; charset=UTF-8","Content-Type":"application/json; charset=UTF-8",...auth
  },body:body?JSON.stringify(body):undefined});
  const text=await res.text();let data;
  try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!res.ok)throw new Error(`IG HTTP ${res.status}: ${JSON.stringify(data)}`);
  return {res,data};
}
async function login(){
  for(const k of ["IG_API_KEY","IG_USERNAME","IG_PASSWORD"])if(!process.env[k])throw new Error(`${k} is not configured`);
  const x=await ig("/session",{method:"POST",version:"2",body:{identifier:process.env.IG_USERNAME.trim(),password:process.env.IG_PASSWORD}});
  const cst=x.res.headers.get("cst"),sec=x.res.headers.get("x-security-token");
  if(!cst||!sec)throw new Error("IG session tokens missing");
  return {CST:cst,"X-SECURITY-TOKEN":sec};
}
async function searchEpic(auth,q){
  const x=await ig("/markets?searchTerm="+encodeURIComponent(q),{version:"1",auth});
  const markets=x.data.markets||[];
  const exact=markets.find(m=>String(m.instrumentName||"").toLowerCase()===q.toLowerCase());
  const italy=markets.find(m=>/eni|enel/i.test(m.instrumentName||"") && /DFB|SHARES/i.test(String(m.instrumentType||"")+" "+String(m.expiry||"")));
  const chosen=exact||italy||markets[0];
  if(!chosen)throw new Error(`No IG market found for ${q}`);
  return {epic:chosen.epic,instrumentName:chosen.instrumentName};
}
function parsePrice(p){
  const t=Date.parse((p.snapshotTimeUTC||p.snapshotTime)+"Z");
  return {timestamp:t,date:new Date(t).toISOString().slice(0,10),
    open:mid(p.openPrice),high:mid(p.highPrice),low:mid(p.lowPrice),close:mid(p.closePrice),
    volume:p.lastTradedVolume??null};
}
async function fetchDaily(auth,epic,max){
  const x=await ig("/prices/"+encodeURIComponent(epic)+"?resolution=DAY&max="+max+"&pageSize="+max,{version:"3",auth});
  const allowance=x.data.allowance||null;
  const prices=(x.data.prices||[]).map(parsePrice).filter(b=>[b.open,b.high,b.low,b.close].every(Number.isFinite));
  return {prices,allowance};
}
(async()=>{
  const auth=await login();
  const history=fs.existsSync(HISTORY_FILE)?JSON.parse(fs.readFileSync(HISTORY_FILE,"utf8")):{instruments:{}};
  const output={ok:true,generatedAtUtc:new Date().toISOString(),timeframe:"1d",indicators:["EMA10","SMA20","SMA50"],instruments:{},errors:{}};

  for(const cfg of INSTRUMENTS){
    try{
      const resolved=cfg.epic?{epic:cfg.epic,instrumentName:cfg.name}:await searchEpic(auth,cfg.name);
      const old=history.instruments[cfg.symbol]?.bars||[];
      const max=old.length>=50?2:BOOTSTRAP_BARS;
      const got=await fetchDaily(auth,resolved.epic,max);
      const merged=decorate(mergeBars(old,got.prices));
      history.instruments[cfg.symbol]={name:resolved.instrumentName,epic:resolved.epic,bars:merged};
      const latest=merged.at(-1)||null,previous=merged.at(-2)||null;
      output.instruments[cfg.symbol]={
        name:resolved.instrumentName,epic:resolved.epic,barsStored:merged.length,
        mode:old.length>=50?"incremental":"bootstrap",
        latestCompleted:latest,previousCompleted:previous,
        indicators:latest?{ema10:latest.ema10,sma20:latest.sma20,sma50:latest.sma50}:null,
        allowance:got.allowance
      };
    }catch(e){
      output.ok=false;output.errors[cfg.symbol]=e instanceof Error?e.message:String(e);
    }
  }
  fs.writeFileSync(HISTORY_FILE,JSON.stringify(history,null,2)+"\n");
  fs.writeFileSync(SNAPSHOT_FILE,JSON.stringify(output,null,2)+"\n");
  console.log(JSON.stringify({ok:output.ok,instruments:Object.keys(output.instruments),errors:output.errors},null,2));
  if(!output.ok)process.exitCode=1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
