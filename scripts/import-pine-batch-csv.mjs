import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const [csvPath,intervalArg='60',...mappingArgs]=process.argv.slice(2);
if(!csvPath||!mappingArgs.length)throw new Error('Usage: node scripts/import-pine-batch-csv.mjs <csv> <interval> S1=QNBK S2=QIBK');
const interval=String(intervalArg).trim(),mappings=mappingArgs.map(item=>{const [prefix,symbol]=item.split('=');if(!/^S\d+$/i.test(prefix)||!/^[A-Z0-9]{3,6}$/i.test(symbol))throw new Error(`Invalid mapping: ${item}`);return{prefix:prefix.toUpperCase(),symbol:symbol.toUpperCase()}});
const now=new Date(),qatar=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,x.value])),qatarToday=`${qatar.year}-${qatar.month}-${qatar.day}`,qatarAfterClose=(+qatar.hour*60)+(+qatar.minute)>=13*60+30,currentUtcHour=now.toISOString().slice(0,13);
const text=(await readFile(csvPath,'utf8')).replace(/^\uFEFF/,'').trim(),lines=text.split(/\r?\n/).filter(Boolean),headers=lines.shift().split(',').map(x=>x.trim().replace(/^"|"$/g,'')),column=Object.fromEntries(headers.map((name,index)=>[name.toLowerCase(),index]));
if(!('time' in column))throw new Error('Missing CSV column: time');
const dailyMode=/^(1?D|DAY|DAILY)$/i.test(interval),outputDir=dailyMode?path.resolve('data'):path.resolve('data','intraday');await mkdir(outputDir,{recursive:true});const results=[];
async function findDuplicateSeries(rows,targetPath){
  if(rows.length<120)return null;
  const names=await readdir(outputDir).catch(()=>[]),target=path.resolve(targetPath),source=new Map(rows.map(c=>[c.date,c]));
  for(const name of names.filter(name=>name.endsWith('.json'))){
    const candidatePath=path.resolve(outputDir,name);if(candidatePath===target)continue;
    let candidate=[];try{candidate=JSON.parse(await readFile(candidatePath,'utf8'))}catch{continue}
    let overlap=0,exact=0;
    for(const candle of candidate){const current=source.get(candle.date);if(!current)continue;overlap++;if(['open','high','low','close','volume'].every(key=>current[key]===candle[key]))exact++}
    if(overlap>=120&&exact===overlap)return{name,overlap};
  }
  return null;
}
for(const {prefix,symbol} of mappings){
  const keys=['open','high','low','close','volume'],indexes=Object.fromEntries(keys.map(key=>[key,column[`${prefix.toLowerCase()}_${key}`]]));
  if(keys.some(key=>indexes[key]===undefined))throw new Error(`Missing OHLCV columns for ${prefix}`);
  const rows=lines.map(line=>{const cells=line.split(',').map(x=>x.trim().replace(/^"|"$/g,'')),raw=Object.fromEntries(keys.map(key=>[key,cells[indexes[key]]])),time=cells[column.time];if(keys.some(key=>raw[key]===''||raw[key]==null))return null;if(dailyMode&&time.slice(0,10)===qatarToday&&!qatarAfterClose)return null;if(!dailyMode&&time.slice(0,13)===currentUtcHour)return null;return{date:dailyMode?time.slice(0,10):time,open:+raw.open,high:+raw.high,low:+raw.low,close:+raw.close,volume:+raw.volume}}).filter(c=>c&&c.date&&keys.every(key=>Number.isFinite(c[key])));
  const outputPath=path.join(outputDir,dailyMode?`${symbol}.json`:`${symbol}-${interval}.json`),duplicate=await findDuplicateSeries(rows,outputPath);
  if(duplicate)throw new Error(`Refusing ${symbol}: ${rows.length} imported candles duplicate ${duplicate.name} exactly across ${duplicate.overlap} dates. Check the Pine S1/S2 symbol mapping.`);
  let existing=[];try{existing=JSON.parse(await readFile(outputPath,'utf8'))}catch{}const unique=[...new Map([...existing,...rows].map(c=>[c.date,c])).values()].sort((a,b)=>a.date.localeCompare(b.date));await writeFile(outputPath,`${JSON.stringify(unique,null,2)}\n`,'utf8');results.push({prefix,symbol,interval:dailyMode?'1D':interval,candles:unique.length,imported:rows.length,first:unique[0]?.date,last:unique.at(-1)?.date,outputPath});
}
console.log(JSON.stringify(results));
