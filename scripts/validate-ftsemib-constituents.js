const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("ftsemib-constituents.json", "utf8"));
const BASE = "https://www.borsaitaliana.it/borsa/azioni/ftse-mib/lista.html";
const normalize = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "it-IT,it;q=0.9" } });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.text();
}
async function main() {
  const pages = await Promise.all([get(BASE), get(BASE + "?page=2")]);
  console.log("HTML lengths", pages.map(x => x.length));
  console.log("ISIN tokens", pages.map(x => [...new Set(x.match(/IT[0-9A-Z]{10}/g) || [])].length));
  console.log("Scheda fragments", pages.flatMap(x => (x.match(/.{0,40}\/b\/azioni\/scheda\/.{0,90}/gi) || []).slice(0, 3)));
  // Inspect limited markup context around ISIN tokens without changing production data.
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const html = pages[pageIndex];
    const snippets = [];
    const token = /IT[0-9A-Z]{10}/g;
    for (const match of html.matchAll(token)) {
      const start = Math.max(0, match.index - 110);
      const end = Math.min(html.length, match.index + 110);
      snippets.push(html.slice(start, end).replace(/\\s+/g, " ").slice(0, 220));
      if (snippets.length >= 5) break;
    }
    console.log("ISIN markup samples page " + (pageIndex + 1), JSON.stringify(snippets));
  }
  const found = new Map();
  for (const html of pages) {
    const links = /<a\\b[^>]*href=["'][^"']*\\/borsa\\/azioni\\/scheda\\/([A-Z]{2}[A-Z0-9]{10})-[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
    for (const m of html.matchAll(links)) {
      const name = m[2].replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
      if (name) found.set(normalize(name), m[1]);
    }
  }
  console.log("Named instrument matches", found.size);
  const aliases = { bancamontedeipaschidisiena: "bancamontepaschisiena", recordati: "recordatiord", stm: "stmicroelectronics" };
  const output = manifest.instruments.map(item => {
    const key = normalize(item.name);
    const isin = found.get(key) || found.get(aliases[key]) || null;
    return { ...item, isin: isin || item.isin, status: isin ? "resolved_official_listing" : item.isin ? "previously_validated" : "unresolved" };
  });
  const unresolved = output.filter(x => !x.isin);
  const report = { checkedAt: new Date().toISOString(), expected: 40, resolved: output.length - unresolved.length, unresolved: unresolved.map(x => x.name), instruments: output };
  fs.writeFileSync("ftsemib-constituents-validation.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ resolved: report.resolved, unresolved: report.unresolved }, null, 2));
  if (unresolved.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
