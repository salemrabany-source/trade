import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [csvPath, symbolArg] = process.argv.slice(2);
if (!csvPath || !symbolArg) {
  throw new Error('Usage: node scripts/import-tradingview-csv.mjs <csv-path> <symbol>');
}

const symbol = symbolArg.trim().toUpperCase();
const text = (await readFile(csvPath, 'utf8')).replace(/^\uFEFF/, '').trim();
const lines = text.split(/\r?\n/).filter(Boolean);
const headers = lines.shift().split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
const column = Object.fromEntries(headers.map((name, index) => [name.toLowerCase(), index]));

for (const required of ['time', 'open', 'high', 'low', 'close', 'volume']) {
  if (!(required in column)) throw new Error(`Missing CSV column: ${required}`);
}

const candles = lines.map((line) => {
  const cells = line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
  return {
    date: cells[column.time].slice(0, 10),
    open: Number(cells[column.open]),
    high: Number(cells[column.high]),
    low: Number(cells[column.low]),
    close: Number(cells[column.close]),
    volume: Number(cells[column.volume]),
  };
}).filter((candle) => candle.date && ['open', 'high', 'low', 'close', 'volume']
  .every((key) => Number.isFinite(candle[key])));

const unique = [...new Map(candles.map((candle) => [candle.date, candle])).values()]
  .sort((a, b) => a.date.localeCompare(b.date));

const outputDir = path.resolve('data');
const outputPath = path.join(outputDir, `${symbol}.json`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ symbol, candles: unique.length, first: unique[0]?.date, last: unique.at(-1)?.date, outputPath }));
