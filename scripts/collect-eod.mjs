import { mkdir, readFile, writeFile } from 'node:fs/promises';
const SYMBOLS=['ABQK','AHCS','AKHI','BEMA','BLDN','BRES','CBQK','DBIS','DHBK','DOHI','DUBK','ERES','FALH','GISS','GWCS','IGRD','IHGS','IQCD','MARK','MCCS','MCGS','MERS','MEZA','MFMS','MHAR','MKDM','MPHC','MRDS','NLCS','ORDS','QAMC','QATI','QCFS','QEWS','QFBQ','QFLS','QGMD','QGRI','QGTS','QIBK','QIGD','QIIK','QIMD','QISI','QLMI','QNBK','QNCD','QNNS','SIIS','TQES','UDCD','VFQS','WDAM','ZHCD'];
const URL='https://scanner.tradingview.com/qatar/scan',columns=['name','open','high','low','close','volume'];
const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qatar',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
if(!['Sun','Mon','Tue','Wed','Thu'].includes(parts.weekday)){console.log('Skipped: Qatar Exchange is closed today.');process.exit(0)}
const date=`${parts.year}-${parts.month}-${parts.day}`;
await mkdir('data',{recursive:true});
const response=await fetch(URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({symbols:{tickers:SYMBOLS.map(s=>`QSE:${s}`),query:{types:[]}},columns})});
if(!response.ok)throw new Error(`TradingView ${response.status}`);const payload=await response.json();
for(const row of payload.data||[]){const symbol=row.s.split(':')[1],x=Object.fromEntries(columns.map((k,i)=>[k,row.d[i]]));if(!['open','high','low','close','volume'].every(k=>Number.isFinite(Number(x[k]))))continue;const path=`data/${symbol}.json`;let old=[];try{old=JSON.parse(await readFile(path,'utf8'))}catch{}const byDate=new Map(old.map(c=>[c.date,c]));byDate.set(date,{date,open:+x.open,high:+x.high,low:+x.low,close:+x.close,volume:+x.volume});await writeFile(path,JSON.stringify([...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),null,2)+'\n')}
console.log(`Saved EOD candles for ${payload.data?.length||0} symbols on ${date}`);
