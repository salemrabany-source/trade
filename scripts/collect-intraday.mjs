import { mkdir, readFile, writeFile } from 'node:fs/promises';

const SYMBOLS=['ABQK','AHCS','AKHI','BEMA','BLDN','BRES','CBQK','DBIS','DHBK','DOHI','DUBK','ERES','FALH','GISS','GWCS','IGRD','IHGS','IQCD','MARK','MCCS','MCGS','MERS','MEZA','MFMS','MHAR','MKDM','MPHC','MRDS','NLCS','ORDS','QAMC','QATI','QCFS','QEWS','QFBQ','QFLS','QGMD','QGRI','QGTS','QIBK','QIGD','QIIK','QIMD','QISI','QLMI','QNBK','QNCD','QNNS','SIIS','TQES','UDCD','VFQS','WDAM','ZHCD'];
const URL='https://scanner.tradingview.com/qatar/scan';
const columns=['name','time|60','open|60','high|60','low|60','close|60','volume|60'];

const now=new Date();
const weekday=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Qatar',weekday:'short'}).format(now);
if(!['Sun','Mon','Tue','Wed','Thu'].includes(weekday)){
  console.log('Skipped: Qatar Exchange is closed today.');
  process.exit(0);
}

const response=await fetch(URL,{
  method:'POST',
  headers:{'content-type':'text/plain;charset=UTF-8'},
  body:JSON.stringify({symbols:{tickers:SYMBOLS.map(s=>`QSE:${s}`),query:{types:[]}},columns})
});
if(!response.ok)throw new Error(`TradingView ${response.status}`);
const payload=await response.json();
await mkdir('data/intraday',{recursive:true});

let saved=0;
for(const row of payload.data||[]){
  const symbol=row.s.split(':')[1];
  const x=Object.fromEntries(columns.map((key,index)=>[key,row.d[index]]));
  const timestamp=Number(x['time|60']);
  if(!Number.isFinite(timestamp)||!['open|60','high|60','low|60','close|60','volume|60'].every(key=>Number.isFinite(Number(x[key]))))continue;
  const date=new Date(timestamp*1000).toISOString().replace('.000Z','Z');
  const candle={date,open:+x['open|60'],high:+x['high|60'],low:+x['low|60'],close:+x['close|60'],volume:+x['volume|60']};
  const path=`data/intraday/${symbol}-60.json`;
  let old=[];
  try{old=JSON.parse(await readFile(path,'utf8'))}catch{}
  const byDate=new Map((Array.isArray(old)?old:[]).map(item=>[item.date,item]));
  byDate.set(date,candle);
  await writeFile(path,JSON.stringify([...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),null,2)+'\n');
  saved++;
}
console.log(`Saved/updated hourly candles for ${saved} symbols.`);
