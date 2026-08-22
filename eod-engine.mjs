export const EOD_CONFIG=Object.freeze({minDailyCandles:120,rsiPeriod:14,volumePeriod:20,volumeMultiplier:1.5,longCandlePct:3,explosionPct:6,pivotWindow:2,atrPeriod:14,maxStopPct:4,stopBufferPct:.35,minScore:70,fibTolerancePct:.5});
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const pct=(a,b)=>b?(a-b)/b*100:0;
const bodyPct=c=>Math.abs(pct(c.close,c.open));
const valid=c=>c&&['open','high','low','close','volume'].every(k=>Number.isFinite(Number(c[k])))&&c.date;

export function normalizeCandles(rows){
  const unique=new Map();for(const row of rows||[]){const c={date:String(row.date).slice(0,10),open:+row.open,high:+row.high,low:+row.low,close:+row.close,volume:+row.volume};if(valid(c))unique.set(c.date,c)}
  return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function aggregate(candles,period){
  const groups=new Map();for(const c of candles){const d=new Date(`${c.date}T12:00:00Z`);let key;if(period==='month')key=c.date.slice(0,7);else{const day=d.getUTCDay(),shift=day===5?0:day===6?1:(day+2)%7;const th=new Date(d);th.setUTCDate(d.getUTCDate()+(4-day+7)%7);key=th.toISOString().slice(0,10)}if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c)}
  return [...groups.entries()].map(([key,a])=>({date:key,open:a[0].open,high:Math.max(...a.map(x=>x.high)),low:Math.min(...a.map(x=>x.low)),close:a.at(-1).close,volume:a.reduce((s,x)=>s+x.volume,0)}));
}

function rsiSeries(cs,n=14){const out=Array(cs.length).fill(null);if(cs.length<=n)return out;let g=0,l=0;for(let i=1;i<=n;i++){const d=cs[i].close-cs[i-1].close;g+=Math.max(d,0);l+=Math.max(-d,0)}let ag=g/n,al=l/n;out[n]=al?100-100/(1+ag/al):100;for(let i=n+1;i<cs.length;i++){const d=cs[i].close-cs[i-1].close;ag=(ag*(n-1)+Math.max(d,0))/n;al=(al*(n-1)+Math.max(-d,0))/n;out[i]=al?100-100/(1+ag/al):100}return out}
function atr(cs,n=14){const tr=cs.map((c,i)=>i?Math.max(c.high-c.low,Math.abs(c.high-cs[i-1].close),Math.abs(c.low-cs[i-1].close)):c.high-c.low);return avg(tr.slice(-n))}
function pivots(cs,w=2){const highs=[],lows=[];for(let i=w;i<cs.length-w;i++){const a=cs.slice(i-w,i+w+1);if(cs[i].high===Math.max(...a.map(x=>x.high)))highs.push(i);if(cs[i].low===Math.min(...a.map(x=>x.low)))lows.push(i)}return{highs,lows}}
function trendOf(cs,w){const p=pivots(cs,w),h=p.highs.slice(-2),l=p.lows.slice(-2);if(h.length<2||l.length<2)return'neutral';if(cs[h[1]].high>cs[h[0]].high&&cs[l[1]].low>cs[l[0]].low&&cs.at(-1).close>cs[l[1]].low)return'up';if(cs[h[1]].high<cs[h[0]].high&&cs[l[1]].low<cs[l[0]].low&&cs.at(-1).close<cs[h[1]].high)return'down';return'neutral'}
function divergence(cs,rsi,p){const L=p.lows.slice(-2),H=p.highs.slice(-2),ok=a=>a.length===2&&rsi[a[0]]!=null&&rsi[a[1]]!=null;return{bullishRegular:ok(L)&&cs[L[1]].low<cs[L[0]].low&&rsi[L[1]]>rsi[L[0]],bullishHidden:ok(L)&&cs[L[1]].low>cs[L[0]].low&&rsi[L[1]]<rsi[L[0]],bearishRegular:ok(H)&&cs[H[1]].high>cs[H[0]].high&&rsi[H[1]]<rsi[H[0]],bearishHidden:ok(H)&&cs[H[1]].high<cs[H[0]].high&&rsi[H[1]]>rsi[H[0]]}}
function fibNear(weekly,last,tol){const p=pivots(weekly,2),points=[...p.highs.slice(-2).map(i=>({i,v:weekly[i].high,type:'h'})),...p.lows.slice(-2).map(i=>({i,v:weekly[i].low,type:'l'}))].sort((a,b)=>a.i-b.i);if(points.length<2)return false;const a=points.at(-2).v,b=points.at(-1).v,span=Math.abs(b-a);return[.382,.5,.618].some(r=>Math.abs(last-(b+(a-b)*r))/last*100<=tol)}

export function analyzeEod(input,config={}){
  const c={...EOD_CONFIG,...config},daily=normalizeCandles(input),warnings=[];
  if(daily.length<c.minDailyCandles)return{decision:'wait',score:0,mode:'insufficient-history',reason:`يلزم ${c.minDailyCandles} شمعة يومية؛ المتوفر ${daily.length}.`,warnings:['لم يصدر المحرك توصية من تاريخ غير كافٍ.'],checks:[]};
  const weekly=aggregate(daily,'week'),monthly=aggregate(daily,'month'),last=daily.at(-1),prev=daily.at(-2),wp=pivots(weekly,c.pivotWindow),dp=pivots(daily,c.pivotWindow),rs=rsiSeries(daily,c.rsiPeriod),div=divergence(daily,rs,dp),trend=trendOf(weekly,c.pivotWindow);
  const volAvg=avg(daily.slice(-c.volumePeriod-1,-1).map(x=>x.volume)),highVolume=last.volume>=volAvg*c.volumeMultiplier&&(last.high-last.low)>=atr(daily,c.atrPeriod)*1.2;
  const long=bodyPct(last)>=c.longCandlePct,explosion=bodyPct(last)>=c.explosionPct||(()=>{const a=daily.slice(-3);return a.every(x=>x.close>=x.open)&&pct(a.at(-1).close,a[0].open)>=c.explosionPct||a.every(x=>x.close<x.open)&&pct(a.at(-1).close,a[0].open)<=-c.explosionPct})();
  const priorLow=dp.lows.length?daily[dp.lows.at(-1)].low:Math.min(...daily.slice(-21,-1).map(x=>x.low)),priorHigh=dp.highs.length?daily[dp.highs.at(-1)].high:Math.max(...daily.slice(-21,-1).map(x=>x.high));
  const falseBreak=last.low<priorLow&&last.close>priorLow,falseBreakout=last.high>priorHigh&&last.close<priorHigh;
  const haramiBull=prev.close<prev.open&&last.close>last.open&&Math.max(last.open,last.close)<prev.open&&Math.min(last.open,last.close)>prev.close;
  const haramiBear=prev.close>prev.open&&last.close<last.open&&Math.max(last.open,last.close)<prev.close&&Math.min(last.open,last.close)>prev.open;
  const confirmBuy=(falseBreak&&last.close>priorLow)||(haramiBull&&last.close>last.open)||(last.close>prev.high&&last.close>last.open);
  const confirmSell=(falseBreakout&&last.close<priorHigh)||(haramiBear&&last.close<last.open)||(last.close<prev.low&&last.close<last.open);
  const nearFib=fibNear(weekly,last.close,c.fibTolerancePct),nearWeeklyLow=wp.lows.some(i=>Math.abs(last.close-weekly[i].low)/last.close*100<=1),nearWeeklyHigh=wp.highs.some(i=>Math.abs(last.close-weekly[i].high)/last.close*100<=1);
  const buy=[['المسار الأسبوعي صاعد',trend==='up',25],['منطقة مشترين أسبوعية/فيبوناتشي',nearWeeklyLow||nearFib,20],['نموذج شراء مؤكد بالإغلاق',confirmBuy,25],['حجم مرتفع',highVolume,10],['دايفرجنس إيجابي',div.bullishRegular||div.bullishHidden&&trend==='up',10],['انفجار/شمعة طويلة داعمة',(explosion||long)&&last.close>last.open,10]];
  const sell=[['المسار الأسبوعي هابط',trend==='down',25],['منطقة بائعين أسبوعية/فيبوناتشي',nearWeeklyHigh||nearFib,20],['نموذج بيع مؤكد بالإغلاق',confirmSell,25],['حجم مرتفع',highVolume,10],['دايفرجنس سلبي',div.bearishRegular||div.bearishHidden&&trend==='down',10],['انفجار/شمعة طويلة داعمة',(explosion||long)&&last.close<last.open,10]];
  const score=a=>a.reduce((s,x)=>s+(x[1]?x[2]:0),0),buyScore=score(buy),sellScore=score(sell);let decision='wait',selected=buyScore>=sellScore?buy:sell,finalScore=Math.max(buyScore,sellScore);
  const buyGate=(trend==='up'||nearWeeklyLow||nearFib)&&confirmBuy,sellGate=(trend==='down'||nearWeeklyHigh||nearFib)&&confirmSell;
  if(buyGate&&buyScore>=c.minScore&&buyScore>sellScore)decision='buy';else if(sellGate&&sellScore>=c.minScore&&sellScore>buyScore)decision='sell';
  let entry=decision==='buy'?last.high:decision==='sell'?last.low:null,stop=decision==='buy'?Math.min(last.low,priorLow)*(1-c.stopBufferPct/100):decision==='sell'?Math.max(last.high,priorHigh)*(1+c.stopBufferPct/100):null;
  const stopPct=entry&&stop?Math.abs(entry-stop)/entry*100:null;if(stopPct>c.maxStopPct){warnings.push(`مسافة الوقف ${stopPct.toFixed(1)}% تتجاوز ${c.maxStopPct}%.`);decision='wait';entry=stop=null}
  return{decision,score:finalScore,buyScore,sellScore,mode:'full-eod',reason:decision==='buy'?'اكتملت بوابة الاتجاه وتأكيد الشراء المسائي.':decision==='sell'?'اكتملت بوابة الاتجاه وتأكيد البيع المسائي.':'لم تكتمل البوابة الإلزامية أو الدرجة المطلوبة.',entry,stop,trend,timeframes:{daily:daily.length,weekly:weekly.length,monthly:monthly.length},signals:{highVolume,longCandle:long,explosion,falseBreak,falseBreakout,haramiBull,haramiBear,nearFib,...div},checks:selected.map(([name,passed,weight])=>({name,passed,weight})),warnings};
}
