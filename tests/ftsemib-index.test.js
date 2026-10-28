const test=require('node:test'),assert=require('node:assert/strict');
const {parseYahooChart,completedOnly,mergeBars,decorate}=require('../scripts/update-ftsemib-index');
test('Parse OHLC and reject missing prices',()=>{
 const s={chart:{result:[{meta:{symbol:'FTSEMIB.MI'},timestamp:[1793000000,1793086400],indicators:{quote:[{open:[49000,null],high:[49500,null],low:[48800,null],close:[49300,null]}]}}]}};
 const b=parseYahooChart(s);assert.equal(b.length,1);assert.equal(b[0].close,49300);
});
test('Exclude unfinished candle',()=>{
 const b=[{date:'2026-10-26'},{date:'2026-10-27'}];
 assert.equal(completedOnly(b,'2026-10-27 17:50').length,1);
 assert.equal(completedOnly(b,'2026-10-27 21:00').length,2);
});
test('Merge revisions and compute moving averages',()=>{
 const old=Array.from({length:80},(_,i)=>{const timestamp=Date.UTC(2026,0,i+1);return {date:new Date(timestamp).toISOString().slice(0,10),timestamp,close:49000+i};});
 const merged=mergeBars(old,[{...old[78],close:50000}]),d=decorate(merged);
 assert.equal(merged.length,80);assert.equal(merged[78].close,50000);
 assert.equal(d[48].sma50,null);assert.ok(d[79].sma50>0&&d[79].sma20>0&&d[79].ema10>0);
});
