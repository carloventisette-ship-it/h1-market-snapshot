const BASE = 'https://demo-api.ig.com/gateway/deal';

async function ig(path, { method='GET', version='1', tokenHeaders={}, body }={}) {
  const headers = {
    'X-IG-API-KEY': process.env.IG_API_KEY,
    'Version': version,
    'Accept': 'application/json; charset=UTF-8',
    'Content-Type': 'application/json; charset=UTF-8',
    ...tokenHeaders,
  };
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return { res, data };
}

function mid(v) {
  if (!v) return null;
  const b = Number(v.bid), a = Number(v.ask);
  return Number.isFinite(b) && Number.isFinite(a) ? (b+a)/2 : null;
}

async function main() {
  for (const k of ['IG_API_KEY','IG_USERNAME','IG_PASSWORD']) {
    if (!process.env[k]) throw new Error(`Missing GitHub secret: ${k}`);
  }

  const login = await ig('/session', {
    method:'POST', version:'2',
    body:{ identifier:process.env.IG_USERNAME, password:process.env.IG_PASSWORD }
  });
  const cst = login.res.headers.get('cst');
  const sec = login.res.headers.get('x-security-token');
  if (!cst || !sec) throw new Error('IG login succeeded but session tokens were not returned.');
  const auth = { CST:cst, 'X-SECURITY-TOKEN':sec };

  console.log('IG DEMO LOGIN OK');
  console.log(JSON.stringify({
    accountType: login.data.accountType,
    currencyIsoCode: login.data.currencyIsoCode,
    currentAccountId: login.data.currentAccountId,
    lightstreamerEndpoint: login.data.lightstreamerEndpoint
  }, null, 2));

  const queries = ['EUR/USD','Spot Gold','US Crude'];
  for (const q of queries) {
    const s = await ig('/markets?searchTerm=' + encodeURIComponent(q), { version:'1', tokenHeaders:auth });
    const markets = (s.data.markets || []).slice(0,8).map(m => ({
      epic:m.epic, instrumentName:m.instrumentName, instrumentType:m.instrumentType,
      expiry:m.expiry, marketStatus:m.marketStatus, bid:m.bid, offer:m.offer
    }));
    console.log('\nSEARCH ' + q);
    console.log(JSON.stringify(markets, null, 2));
    if (!markets.length) continue;

    const chosen = markets[0];
    try {
      const p = await ig('/prices/' + encodeURIComponent(chosen.epic) + '?resolution=HOUR&max=5&pageSize=5', {
        version:'3', tokenHeaders:auth
      });
      console.log('H1 TEST ' + chosen.instrumentName + ' [' + chosen.epic + ']');
      console.log(JSON.stringify((p.data.prices || []).map(x => ({
        snapshotTime:x.snapshotTime,
        snapshotTimeUTC:x.snapshotTimeUTC,
        open:mid(x.openPrice), high:mid(x.highPrice), low:mid(x.lowPrice), close:mid(x.closePrice),
        lastTradedVolume:x.lastTradedVolume
      })), null, 2));
    } catch (e) {
      console.log('H1 TEST ERROR ' + chosen.epic + ': ' + e.message);
    }
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
