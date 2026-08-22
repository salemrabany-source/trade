import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [csvPath,symbolArg,intervalArg='60']=process.argv.slice(2);
if(!csvPath||!symbolArg)throw new Error('Usage: node scripts/import-intraday-csv.mjs <csv-path> <symbol> [minutes]');
const symbol=symbolArg.trim().toUpperCase(),interval=String(intervalArg).trim();
const text=(await readFile(csvPath,'utf8')).replace(/^\uFEFF/,'').trim(),lines=text.split(/\r?\n/).filter(Boolean),headers=lines.shift().split(',').map(x=>x.trim().replace(/^"|"$/g,'')),column=Object.fromEntries(headers.map((name,index)=>[name.toLowerCase(),index]));
for(const required of ['time','open','high','low','close','volume'])if(!(required in column))throw new Error(`Missing CSV column: ${required}`);
const rows=lines.map(line=>{const cells=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));return{date:cells[column.time],open:+cells[column.open],high:+cells[column.high],low:+cells[column.low],close:+cells[column.close],volume:+cells[column.volume]}}).filter(c=>c.date&&['open','high','low','close','volume'].every(k=>Number.isFinite(c[k])));
const unique=[...new Map(rows.map(c=>[c.date,c])).values()].sort((a,b)=>a.date.localeCompare(b.date)),outputDir=path.resolve('data','intraday'),outputPath=path.join(outputDir,`${symbol}-${interval}.json`);await mkdir(outputDir,{recursive:true});await writeFile(outputPath,`${JSON.stringify(unique,null,2)}\n`,'utf8');console.log(JSON.stringify({symbol,interval,candles:unique.length,first:unique[0]?.date,last:unique.at(-1)?.date,outputPath}));
