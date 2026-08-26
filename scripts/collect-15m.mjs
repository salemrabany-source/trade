import { mkdir, readFile, writeFile } from 'node:fs/promises';

const SYMBOLS=['ABQK','AHCS','AKHI','BEMA','BLDN','BRES','CBQK','DBIS','DHBK','DOHI','DUBK','ERES','FALH','GISS','GWCS','IGRD','IHGS','IQCD','MARK','MCCS','MCGS','MERS','MEZA','MFMS','MHAR','MKDM','MPHC','MRDS','NLCS','ORDS','QAMC','QATI','QCFS','QEWS','QFBQ','QFLS','QGMD','QGRI','QGTS','QIBK','QIGD','QIIK','QIMD','QISI','QLMI','QNBK','QNCD','QNNS','SIIS','TQES','UDCD','VFQS','WDAM','ZHCD'];
const URL='https://scanner.tradingview.com/qatar/scan';
const columns=['name','time|15','open|15','high|15','low|15','close|15','volume|15'];
const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qatar',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
if(!['Sun','Mon','Tue','Wed','Thu'].includes(parts.weekday)){console.log('Skipped: Qatar Exchange is closed today.');process.exit(0)}

const response=await fetch(URL,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({symbols:{tickers:SYMBOLS.map(s=>`QSE:${s}`),query:{types:[]}},columns})});
if(!response.ok)throw new Error(`TradingView ${response.status}`);const payload=await response.json();await mkdir('data/intraday',{recursive:true});
let saved=0;
for(const row of payload.data||[]){
  const symbol=row.s.split(':')[1],x=Object.fromEntries(columns.map((key,index)=>[key,row.d[index]])),timestamp=Number(x['time|15']);
  if(!Number.isFinite(timestamp)||!['open|15','high|15','low|15','close|15','volume|15'].every(key=>Number.isFinite(Number(x[key]))))continue;
  const date=new Date(timestamp*1000).toISOString().replace('.000Z','Z'),candle={date,open:+x['open|15'],high:+x['high|15'],low:+x['low|15'],close:+x['close|15'],volume:+x['volume|15']},path=`data/intraday/${symbol}-15.json`;let old=[];try{old=JSON.parse(await readFile(path,'utf8'))}catch{}
  const map=new Map((Array.isArray(old)?old:[]).map(item=>[item.date,item]));map.set(date,candle);await writeFile(path,JSON.stringify([...map.values()].sort((a,b)=>a.date.localeCompare(b.date)),null,2)+'\n');saved++;
}
console.log(`Saved/updated 15-minute candles for ${saved} symbols at Qatar ${parts.hour}:${parts.minute}.`);
