'use strict';

// Derives a compact, read-only screening window from the full Borsa Italiana series.
// The upstream pipeline computes EMA10, SMA20 and SMA50 on the FULL history.
const fs = require('node:fs');
const HISTORY = 'ftsemib-history.json';
const LATEST = 'ftsemib-latest.json';
const OUTPUT = 'ftsemib-scan-history.json';
const WINDOW = 30;
const SOURCE = 'Borsa Italiana official chart API';
const FIELDS = ['timestamp', 'date', 'open', 'high', 'low', 'close', 'ema10', 'sma20', 'sma50'];
const NUMERIC_FIELDS = FIELDS.filter(k => k !== 'date');

function buildScan(history, latest) {
  if (!latest || latest.ok !== true || latest.source !== SOURCE ||
      latest.expectedInstruments !== 40 || latest.completedInstruments !== 40 ||
      latest.failedInstruments !== 0) {
    throw new Error('Incomplete or unexpected FTSE MIB latest snapshot; scan file not updated');
  }
  const symbols = Object.keys(latest.instruments || {}).sort();
  if (symbols.length !== 40 || Object.keys(history.instruments || {}).length !== 40) {
    throw new Error('Expected exactly 40 stocks in both full history and latest');
  }
  const instruments = {};
  let dataDate = null;
  for (const symbol of symbols) {
    const full = history.instruments[symbol];
    const current = latest.instruments[symbol];
    if (!full || full.source !== SOURCE || !Array.isArray(full.bars) || full.bars.length < WINDOW) {
      throw new Error('Missing Borsa Italiana history or fewer than 30 bars: ' + symbol);
    }
    const recent = full.bars.slice(-WINDOW);
    for (let i = 0; i < recent.length; i++) {
      const b = recent[i];
      if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
          NUMERIC_FIELDS.some(k => !Number.isFinite(b[k])) ||
          (i && recent[i - 1].date >= b.date)) {
        throw new Error('Invalid ordered OHLC/indicator history: ' + symbol);
      }
    }
    const last = recent[recent.length - 1];
    if (!current.latestCompleted || last.date !== current.latestCompleted.date ||
        last.close !== current.latestCompleted.close) {
      throw new Error('History/latest mismatch for ' + symbol);
    }
    if (dataDate && dataDate !== last.date) {
      throw new Error('40 stocks have inconsistent last completed sessions');
    }
    dataDate = last.date;
    instruments[symbol] = {
      name: full.name,
      isin: full.isin,
      exchange: full.exchange,
      bars: recent.map(b => Object.fromEntries(FIELDS.map(k => [k, b[k]])))
    };
  }
  return {
    ok: true,
    schemaVersion: 1,
    generatedAtUtc: latest.generatedAtUtc,
    generatedAtEuropeRome: latest.generatedAtEuropeRome,
    timeframe: '1d',
    source: SOURCE,
    indicators: ['EMA10', 'SMA20', 'SMA50'],
    windowSessions: WINDOW,
    dataDate,
    expectedInstruments: 40,
    completedInstruments: 40,
    instruments
  };
}

function main() {
  const history = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
  const latest = JSON.parse(fs.readFileSync(LATEST, 'utf8'));
  const scan = buildScan(history, latest);
  const temp = OUTPUT + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(scan) + '\n', 'utf8');
  fs.renameSync(temp, OUTPUT);
  console.log(JSON.stringify({
    output: OUTPUT, dataDate: scan.dataDate,
    instruments: scan.completedInstruments, barsPerInstrument: scan.windowSessions,
    bytes: fs.statSync(OUTPUT).size, source: scan.source
  }));
}

if (require.main === module) main();
module.exports = {buildScan};
