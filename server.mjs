import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeEod } from './eod-engine.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const PORT=Number(process.env.PORT||8080);
const GROUP_URL='https://www.thegroup.com.qa/LiveQuotesV2/LiveQuotesV2.aspx?fload=1&lang=ar';
const TV_URL='https://scanner.tradingview.com/qatar/scan';
const STATIC_NAMES={QNBK:'بنك قطر الوطني',QIBK:'مصرف قطر الإسلامي',IQCD:'صناعات قطر',ORDS:'أريدُ',QGTS:'ناقلات',MARK:'مصرف الريان',CBQK:'البنك التجاري',DUBK:'بنك دخان',QAMC:'قامكو',BRES:'بروة',IGRD:'استثمار القابضة',VFQS:'فودافون قطر',MPHC:'مسيعيد',QEWS:'نبراس للطاقة',QNNS:'الملاحة القطرية',QGRI:'العامة للتأمين'};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
let catalogCache={expires:0,data:null};

async function fetchWithTimeout(url,options={},timeout=12000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 QSE-Analysis-Prototype/1.0',...(options.headers||{})}})}finally{clearTimeout(timer)}
}

function parseGroupCatalog(html){
  const found={};
  for(const match of html.matchAll(/\b([A-Z]{4}),([^,;]+),([^,;]+),[\d.]+,[\d.]+;/g))found[match[1]]={symbol:match[1],englishName:match[2],arabicName:match[3]};
  return found;
}

async function groupCatalog(){
  if(catalogCache.data&&Date.now()<catalogCache.expires)return catalogCache.data;
  const response=await fetchWithTimeout(GROUP_URL);if(!response.ok)throw new Error(`Group HTTP ${response.status}`);
  const data=parseGroupCatalog(await response.text());if(!Object.keys(data).length)throw new Error('تعذر قراءة قائمة الأسهم من المجموعة.');
  catalogCache={data,expires:Date.now()+15*60_000};return data;
}

async function tradingViewSnapshot(symbol){
  const columns=['name','description','open','high','low','close','volume','change','Recommend.All','RSI','SMA20','SMA50','average_volume_30d_calc'];
  const body={symbols:{tickers:[`QSE:${symbol}`],query:{types:[]}},columns};
  const response=await fetchWithTimeout(TV_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`TradingView HTTP ${response.status}`);
  const payload=await response.json(),row=payload.data?.[0];if(!row)throw new Error('الرمز غير موجود في TradingView.');
  return Object.fromEntries(columns.map((name,index)=>[name,row.d[index]]));
}

function buildAnalysis(x){
  const close=Number(x.close),open=Number(x.open),rsi=Number(x.RSI),sma20=Number(x.SMA20),sma50=Number(x.SMA50),recommend=Number(x['Recommend.All']);
  const volumeRatio=Number(x.average_volume_30d_calc)>0?Number(x.volume)/Number(x.average_volume_30d_calc):null;
  const bullishTrend=close>sma20&&sma20>sma50,bearishTrend=close<sma20&&sma20<sma50;
  const checksBuy=[
    {name:'المسار العام صاعد',passed:bullishTrend,value:`${sma20.toFixed(2)} / ${sma50.toFixed(2)}`},
    {name:'ملخص مؤشرات TradingView إيجابي',passed:recommend>=.1,value:recommend.toFixed(2)},
    {name:'RSI يدعم الشراء',passed:rsi>=40&&rsi<=70,value:rsi.toFixed(1)},
    {name:'إغلاق الشمعة أعلى الافتتاح',passed:close>open,value:`${close.toFixed(2)} / ${open.toFixed(2)}`},
    {name:'حجم التداول أعلى المتوسط',passed:volumeRatio!=null&&volumeRatio>=1.2,value:volumeRatio==null?'—':`${volumeRatio.toFixed(1)}×`}
  ];
  const checksSell=[
    {name:'المسار العام هابط',passed:bearishTrend,value:`${sma20.toFixed(2)} / ${sma50.toFixed(2)}`},
    {name:'ملخص مؤشرات TradingView سلبي',passed:recommend<=-.1,value:recommend.toFixed(2)},
    {name:'RSI يدعم البيع',passed:rsi<=60,value:rsi.toFixed(1)},
    {name:'إغلاق الشمعة أدنى الافتتاح',passed:close<open,value:`${close.toFixed(2)} / ${open.toFixed(2)}`},
    {name:'حجم التداول أعلى المتوسط',passed:volumeRatio!=null&&volumeRatio>=1.2,value:volumeRatio==null?'—':`${volumeRatio.toFixed(1)}×`}
  ];
  const weights=[30,25,15,15,15],score=checks=>checks.reduce((sum,c,i)=>sum+(c.passed?weights[i]:0),0);
  const buyScore=score(checksBuy),sellScore=score(checksSell);let decision='wait',checks=buyScore>=sellScore?checksBuy:checksSell,finalScore=Math.max(buyScore,sellScore);
  if(buyScore>=60&&buyScore>sellScore)decision='buy';else if(sellScore>=60&&sellScore>buyScore)decision='sell';
  return {decision,score:finalScore,entry:decision==='buy'?x.high:decision==='sell'?x.low:null,stop:decision==='buy'?Number(x.low)*.9965:decision==='sell'?Number(x.high)*1.0035:null,reason:decision==='buy'?'توافقت خلفية المسار مع مؤشرات الشراء.':decision==='sell'?'توافقت خلفية المسار مع مؤشرات البيع.':'الشروط الحالية متعارضة أو لم تبلغ حد التأكيد.',checks,buyScore,sellScore};
}

export async function analyzeSymbol(symbol){
  if(!/^[A-Z0-9]{3,6}$/.test(symbol))throw new Error('رمز السهم غير صالح.');
  let catalog={},groupStatus='connected';
  try{catalog=await groupCatalog()}catch(error){groupStatus=`unavailable: ${error.message}`}
  if(Object.keys(catalog).length&&!catalog[symbol])throw new Error('الرمز غير مدرج في قائمة المجموعة.');
  const market=await tradingViewSnapshot(symbol),company=catalog[symbol];
  let history=[];try{history=JSON.parse(await readFile(join(ROOT,'data',`${symbol}.json`),'utf8'))}catch{}
  const qatarDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  history.push({date:qatarDate,open:+market.open,high:+market.high,low:+market.low,close:+market.close,volume:+market.volume});
  const full=analyzeEod(history),snapshot=buildAnalysis(market);
  const analysis=full.mode?.startsWith('full-')?full:{...snapshot,mode:'snapshot-partial',provisional:true,availableConditions:5,totalConditions:'المحرك الكامل',warnings:[full.reason,'هذه إشارة أولية مبنية على الشروط المتاحة فقط، وليست توصية مكتملة أو نسبة نجاح.']};
  const chartCandles=[...new Map(history.map(c=>[c.date,c])).values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-300);
  return {symbol,companyName:company?.arabicName||STATIC_NAMES[symbol]||market.description,englishName:company?.englishName||market.description,quote:{last:market.close,open:market.open,high:market.high,low:market.low,volume:market.volume,change:market.change,bid:null,ask:null},analysis,history:{storedCandles:Math.max(0,history.length-1),requiredCandles:120,fullEngine:full.mode?.startsWith('full-')},chart:{interval:'1D',candles:chartCandles},updatedAt:new Date().toISOString(),sources:{group:{url:GROUP_URL,status:groupStatus,usage:'التحقق من الرمز واسم الشركة'},tradingView:{status:'connected',usage:'السعر والمؤشرات الفنية ولقطة EOD'}}};
}

export async function listStocks(){
  const catalog=await groupCatalog();
  const nonCompanyInstruments=new Set(['QATR','QETF']);
  return Object.values(catalog).filter(stock=>!nonCompanyInstruments.has(stock.symbol)).sort((a,b)=>(a.arabicName||a.symbol).localeCompare(b.arabicName||b.symbol,'ar'));
}

function json(res,status,data){res.writeHead(status,{'content-type':MIME['.json'],'cache-control':'no-store'});res.end(JSON.stringify(data))}
async function serveFile(req,res){
  const requested=new URL(req.url,'http://localhost').pathname==='/'?'index-production.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1));
  const safe=normalize(requested).replace(/^(\.\.[/\\])+/,''),path=join(ROOT,safe);if(!path.startsWith(ROOT))return json(res,403,{error:'Forbidden'});
  try{const file=await readFile(path);res.writeHead(200,{'content-type':MIME[extname(path)]||'application/octet-stream'});res.end(file)}catch{json(res,404,{error:'Not found'})}
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/analyze'){
      const symbol=(url.searchParams.get('symbol')||'').trim().toUpperCase();
      try{return json(res,200,await analyzeSymbol(symbol))}catch(error){return json(res,502,{error:error.message})}
    }
    if(url.pathname==='/api/stocks')return json(res,200,{stocks:await listStocks(),updatedAt:new Date().toISOString()});
    return serveFile(req,res);
  }catch(error){return json(res,500,{error:'خطأ داخلي في الخادم.'})}
});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  server.listen(PORT,'127.0.0.1',()=>console.log(`QSE analyzer: http://127.0.0.1:${PORT}`));
}
