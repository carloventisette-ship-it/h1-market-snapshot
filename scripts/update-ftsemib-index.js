// FTSE MIB cash index D1. Separate from 40-stock pipeline.
const fs=require('node:fs');
const HISTORY='ftsemib-index-history.json', LATEST='ftsemib-index-latest.json';
const KEY='FTSEMIB', TICKER='FTSEMIB.MI', ZONE='Europe/Rome';
const SOURCE='Yahoo Finance chart v8 (FTSEMIB.MI, cash price index)';
function romeDay(ms){return new Intl.DateTimeFormat('sv-SE',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));}
function romeNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());}
// Require the latest completed weekday session; weekends roll back to Friday.
// Exchange holidays intentionally fail closed rather than marking stale data fresh.
function expectedSessionDate(now=romeNow()){
 const day=now.slice(0,10),hour=now.slice(11,16);
 const d=new Date(day+'T00:00:00Z');
 const weekday=d.getUTCDay();
 if(weekday>=1&&weekday<=5&&hour>='18:30')return day;
 do{d.setUTCDate(d.getUTCDate()-1);}while(d.getUTCDay()===0||d.getUTCDay()===6);
 return d.toISOString().slice(0,10);
}
function round(v){return Number.isFinite(v)?Number(v.toFixed(6)):null;}
function sma(v,p){let s=0;return v.map((x,i)=>{s+=x;if(i>=p)s-=v[i-p];return i>=p-1?s/p:null;});}
function ema(v,p){let a=Array(v.length).fill(null);if(v.length<p)return a;let x=v.slice(0,p).reduce((s,n)=>s+n,0)/p;a[p-1]=x;for(let i=p;i<v.length;i++){x=(v[i]-x)*(2/(p+1))+x;a[i]=x;}return a;}
function decorate(bars){
 const a=[...bars].sort((x,y)=>x.timestamp-y.timestamp), closes=a.map(x=>x.close);
 const e=ema(closes,10),m=sma(closes,20),l=sma(closes,50);
 return a.map((b,i)=>({...b,ema10:round(e[i]),sma20:round(m[i]),sma50:round(l[i])}));
}
function mergeBars(oldBars,newBars){
 const m=new Map();for(const b of [...oldBars,...newBars])if(b&&b.date&&Number.isFinite(b.close))m.set(b.date,b);
 return [...m.values()].sort((a,b)=>a.timestamp-b.timestamp);
}
function parseYahooChart(body){
 if(body?.chart?.error)throw Error('Yahoo error: '+JSON.stringify(body.chart.error));
 const s=body?.chart?.result?.[0], ts=s?.timestamp,q=s?.indicators?.quote?.[0];
 if(!Array.isArray(ts)||!q)throw Error('Missing daily data');
 if(s.meta?.symbol&&s.meta.symbol.toUpperCase()!==TICKER)throw Error('Unexpected symbol '+s.meta.symbol);
 const map=new Map();
 for(let i=0;i<ts.length;i++){
  const values=['open','high','low','close'].map(k=>q[k]?.[i]);
  if(!Number.isFinite(ts[i])||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))continue;
  const [open,high,low,close]=values;
  if(low<=0||low>Math.min(open,close)+0.05||high<Math.max(open,close)-0.05)continue;
  const date=romeDay(ts[i]*1000);
  map.set(date,{date,timestamp:Date.parse(date+'T00:00:00Z'),open:round(open),high:round(high),low:round(low),close:round(close)});
 }
 return [...map.values()].sort((a,b)=>a.timestamp-b.timestamp);
}
function completedOnly(bars,now=romeNow()){
 const today=now.slice(0,10),ready=now.slice(11,16)>='18:30';
 return bars.filter(b=>b.date<today||(b.date===today&&ready));
}
async function fetchDaily(mode){
 const range=mode==='full'?'1y':'1mo';let err;
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
  try{
   const url='https://'+host+'/v8/finance/chart/'+TICKER+'?range='+range+'&interval=1d&events=history';
   const res=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'}});
   if(!res.ok)throw Error('HTTP '+res.status+' '+host);
   const bars=parseYahooChart(await res.json());
   if(bars.length<(mode==='full'?80:2))throw Error('Insufficient candles: '+bars.length);
   return {bars,range,host};
  }catch(e){err=e;}
 }
 throw err||Error('Chart API unavailable');
}
function save(file,data){const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n');fs.renameSync(temp,file);}
async function main(){
 const requestedMode=String(process.env.FTSEMIB_INDEX_REFRESH_MODE||'auto').toLowerCase();
 if(!['auto','incremental','full'].includes(requestedMode))throw Error('Invalid refresh mode '+requestedMode);
 const existing=fs.existsSync(HISTORY)?JSON.parse(fs.readFileSync(HISTORY,'utf8')):{instruments:{}};
 const old=existing.instruments?.[KEY]?.bars||[];
 const mode=requestedMode==='full'||old.length<80?'full':'incremental';
 const downloaded=await fetchDaily(mode), valid=completedOnly(downloaded.bars);
 if(valid.length<(mode==='full'?80:2))throw Error('Not enough completed daily candles: '+valid.length);
 const bars=decorate(mergeBars(old,mode==='full'?valid.slice(-80):valid.slice(-2)));
 const last=bars.at(-1),before=bars.at(-2);
 const expected=expectedSessionDate();
 if(last.date!==expected)throw Error('FTSE MIB index D1 NOT CURRENT: expected completed session '+expected+', Yahoo returned latest '+last.date+'. No JSON files written; retry at 05:00 Europe/Rome.');
 if([last.ema10,last.sma20,last.sma50].some(v=>!Number.isFinite(v)))throw Error('FTSE MIB indicators missing for '+last.date);
 const generatedAtUtc=new Date().toISOString();
 const instrument={name:'FTSE MIB',symbol:KEY,vendorSymbol:TICKER,kind:'cash_price_index',currency:'EUR',source:SOURCE,bars};
 save(HISTORY,{generatedAtUtc,timeframe:'1d',source:SOURCE,instruments:{[KEY]:instrument}});
 save(LATEST,{ok:true,generatedAtUtc,generatedAtEuropeRome:romeNow(),timeframe:'1d',source:SOURCE,
  indicators:['EMA10','SMA20','SMA50'],expectedInstruments:1,completedInstruments:1,requestedMode,mode,
  instruments:{[KEY]:{name:'FTSE MIB',symbol:KEY,vendorSymbol:TICKER,kind:'cash_price_index',
   barsStored:bars.length,latestCompleted:last,previousCompleted:before,
   indicators:{ema10:last.ema10,sma20:last.sma20,sma50:last.sma50},source:SOURCE,sourceRange:downloaded.range}}});
 console.log(JSON.stringify({ok:true,mode,barsStored:bars.length,latestDate:last.date,latestClose:last.close,sourceHost:downloaded.host}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
module.exports={parseYahooChart,completedOnly,mergeBars,decorate,expectedSessionDate};
