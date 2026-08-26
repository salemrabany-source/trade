export const PATTERN_CONFIG=Object.freeze({
  minDaily:120,minIntraday:30,pivotWindow:2,levelLookback:250,levelTolerancePct:.7,
  volumePeriod:20,volumeRatio:1.5,strongVolumeRatio:2,largeAtrRatio:1.8,
  largeBodyRatio:.6,stopBufferPct:.35,nearZoneAtr:.7,maxRiskPct:4,includeHistoricalStats:true
});

const LABELS={
  'false-breakdown':'كسر وهمي شرائي','false-breakout':'اختراق وهمي بيعي',
  'volume-accumulation':'شمعة كميات شرائية','volume-distribution':'شمعة كميات بيعية',
  'large-bullish-candle':'شمعة أحجام صاعدة','large-bearish-candle':'شمعة أحجام هابطة',
  'institutional-demand-retest':'عودة إلى منطقة طلب لمحفظة','institutional-supply-retest':'عودة إلى منطقة عرض لمحفظة'
};
const FRAME_LABELS={'1D':'اليومي','60':'الساعة','15':'15 دقيقة'};
const FRAME_WEIGHT={'1D':3,'60':2,'15':1};
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const median=a=>{const x=a.filter(Number.isFinite).sort((m,n)=>m-n);if(!x.length)return 0;const i=Math.floor(x.length/2);return x.length%2?x[i]:(x[i-1]+x[i])/2};
const pct=(a,b)=>b?(a-b)/b*100:0;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const valid=c=>c&&c.date&&['open','high','low','close','volume'].every(k=>Number.isFinite(Number(c[k])));

export function normalizePatternCandles(rows,preserveTime=false){
  const map=new Map();
  for(const row of rows||[]){
    const raw=String(row.date||row.time||''),date=preserveTime?raw:raw.slice(0,10),c={date,open:+row.open,high:+row.high,low:+row.low,close:+row.close,volume:+(row.volume??row.Volume)};
    if(valid(c)&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close,c.high))map.set(date,c);
  }
  return[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function trueRange(c,prev){return prev?Math.max(c.high-c.low,Math.abs(c.high-prev.close),Math.abs(c.low-prev.close)):c.high-c.low}
function atrAt(cs,index,n=14){const start=Math.max(0,index-n+1),values=[];for(let i=start;i<=index;i++)values.push(trueRange(cs[i],cs[i-1]));return avg(values)}
function pivots(cs,w=2,end=cs.length){const highs=[],lows=[];for(let i=w;i<end-w;i++){const a=cs.slice(i-w,i+w+1);if(cs[i].high===Math.max(...a.map(x=>x.high)))highs.push(i);if(cs[i].low===Math.min(...a.map(x=>x.low)))lows.push(i)}return{highs,lows}}
function trendOf(cs,w=2){const p=pivots(cs,w),h=p.highs.slice(-2),l=p.lows.slice(-2);if(h.length<2||l.length<2)return'neutral';if(cs[h[1]].high>cs[h[0]].high&&cs[l[1]].low>cs[l[0]].low)return'up';if(cs[h[1]].high<cs[h[0]].high&&cs[l[1]].low<cs[l[0]].low)return'down';return'neutral'}
function closeLocation(c){const range=Math.max(Number.EPSILON,c.high-c.low);return(c.close-c.low)/range}
function bodyRatio(c){return Math.abs(c.close-c.open)/Math.max(Number.EPSILON,c.high-c.low)}
function volumeRatioAt(cs,index,n=20){return cs[index].volume/Math.max(1,median(cs.slice(Math.max(0,index-n),index).map(x=>x.volume)))}
function near(a,b,tolerance){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)/Math.max(Math.abs(a),.0001)*100<=tolerance}

function historicalLevels(cs,index,c){
  const start=Math.max(0,index-c.levelLookback),past=cs.slice(start,index),p=pivots(past,c.pivotWindow),raw=[...p.lows.map(i=>({side:'support',price:past[i].low,date:past[i].date})),...p.highs.map(i=>({side:'resistance',price:past[i].high,date:past[i].date}))].sort((a,b)=>a.price-b.price),groups=[];
  for(const level of raw){const group=groups.find(g=>g.side===level.side&&near(g.price,level.price,c.levelTolerancePct));if(group){group.points.push(level);group.price=avg(group.points.map(x=>x.price))}else groups.push({...level,points:[level]})}
  return groups.map(g=>({side:g.side,price:g.price,touches:g.points.length,lastDate:g.points.at(-1).date,strength:clamp(35+g.points.length*12,35,95)}));
}

function pattern(type,side,frame,candle,extra={}){return{type,label:LABELS[type],side,timeframe:frame,timeframeLabel:FRAME_LABELS[frame],date:candle.date,detected:true,...extra}}

function detectFalseMove(cs,index,frame,c){
  const x=cs[index],prev=cs[index-1],a=atrAt(cs,index),levels=historicalLevels(cs,index,c),out=[];
  const supports=levels.filter(l=>l.side==='support'&&l.price<Math.max(x.high,prev?.high??x.high)).sort((m,n)=>Math.abs(x.low-m.price)-Math.abs(x.low-n.price));
  const resistances=levels.filter(l=>l.side==='resistance'&&l.price>Math.min(x.low,prev?.low??x.low)).sort((m,n)=>Math.abs(x.high-m.price)-Math.abs(x.high-n.price));
  const support=supports[0],resistance=resistances[0],vr=volumeRatioAt(cs,index,c.volumePeriod),loc=closeLocation(x);
  if(support&&x.low<support.price&&x.close>support.price&&(support.price-x.low)<=a&&loc>=.5){
    out.push(pattern('false-breakdown','buy',frame,x,{level:support.price,entry:x.high,stop:x.low*(1-c.stopBufferPct/100),volumeRatio:vr,atrRatio:trueRange(x,prev)/Math.max(a,.0001),levelTouches:support.touches,evidence:[`عاد الإغلاق فوق دعم ${support.price.toFixed(3)}`,`الإغلاق في النصف العلوي من الشمعة`,...(vr>=c.volumeRatio?[`الكميات ${vr.toFixed(1)}× المعتاد`]:[])]}));
  }
  if(resistance&&x.high>resistance.price&&x.close<resistance.price&&(x.high-resistance.price)<=a&&loc<=.5){
    out.push(pattern('false-breakout','sell',frame,x,{level:resistance.price,entry:x.low,stop:x.high*(1+c.stopBufferPct/100),volumeRatio:vr,atrRatio:trueRange(x,prev)/Math.max(a,.0001),levelTouches:resistance.touches,evidence:[`عاد الإغلاق تحت مقاومة ${resistance.price.toFixed(3)}`,`الإغلاق في النصف السفلي من الشمعة`,...(vr>=c.volumeRatio?[`الكميات ${vr.toFixed(1)}× المعتاد`]:[])]}));
  }
  return out;
}

function detectVolume(cs,index,frame,c){
  if(index<c.volumePeriod)return[];const x=cs[index],vr=volumeRatioAt(cs,index,c.volumePeriod);if(vr<c.volumeRatio)return[];
  const loc=closeLocation(x),a=atrAt(cs,index),levels=historicalLevels(cs,index,c),nearSupport=levels.some(l=>l.side==='support'&&Math.abs(x.low-l.price)<=a*c.nearZoneAtr),nearResistance=levels.some(l=>l.side==='resistance'&&Math.abs(x.high-l.price)<=a*c.nearZoneAtr),out=[];
  if(loc>=.6&&(x.close>x.open||nearSupport))out.push(pattern('volume-accumulation','buy',frame,x,{entry:x.high,stop:x.low*(1-c.stopBufferPct/100),volumeRatio:vr,atrRatio:trueRange(x,cs[index-1])/Math.max(a,.0001),level:nearSupport?levels.find(l=>l.side==='support'&&Math.abs(x.low-l.price)<=a*c.nearZoneAtr)?.price:null,evidence:[`حجم التداول ${vr.toFixed(1)}× وسيط 20 شمعة`,`إغلاق في الجزء العلوي من الشمعة`,...(nearSupport?['ظهرت قرب دعم تاريخي']:[])]}));
  if(loc<=.4&&(x.close<x.open||nearResistance))out.push(pattern('volume-distribution','sell',frame,x,{entry:x.low,stop:x.high*(1+c.stopBufferPct/100),volumeRatio:vr,atrRatio:trueRange(x,cs[index-1])/Math.max(a,.0001),level:nearResistance?levels.find(l=>l.side==='resistance'&&Math.abs(x.high-l.price)<=a*c.nearZoneAtr)?.price:null,evidence:[`حجم التداول ${vr.toFixed(1)}× وسيط 20 شمعة`,`إغلاق في الجزء السفلي من الشمعة`,...(nearResistance?['ظهرت قرب مقاومة تاريخية']:[])]}));
  return out;
}

function detectLargeCandle(cs,index,frame,c){
  if(index<15)return[];const x=cs[index],a=atrAt(cs,index-1),tr=trueRange(x,cs[index-1]),ratio=tr/Math.max(a,.0001),body=bodyRatio(x);if(ratio<c.largeAtrRatio||body<c.largeBodyRatio)return[];
  const vr=volumeRatioAt(cs,index,c.volumePeriod),side=x.close>x.open?'buy':x.close<x.open?'sell':null;if(!side)return[];
  return[pattern(side==='buy'?'large-bullish-candle':'large-bearish-candle',side,frame,x,{entry:side==='buy'?x.high:x.low,stop:(side==='buy'?x.low*(1-c.stopBufferPct/100):x.high*(1+c.stopBufferPct/100)),volumeRatio:vr,atrRatio:ratio,zone:{low:side==='buy'?x.low:x.open,high:side==='buy'?x.open:x.high},evidence:[`مدى الشمعة ${ratio.toFixed(1)}× ATR`,`جسم الشمعة ${(body*100).toFixed(0)}% من المدى`,...(vr>=c.volumeRatio?[`الكميات ${vr.toFixed(1)}× المعتاد`]:[])]})];
}

function detectInstitutionalRetest(cs,index,frame,c){
  const current=cs[index],a=atrAt(cs,index),out=[];
  for(let i=Math.max(15,index-120);i<index-1;i++){
    const large=detectLargeCandle(cs,i,frame,c)[0];if(!large)continue;const z=large.zone,touched=current.low<=z.high&&current.high>=z.low,loc=closeLocation(current);if(!touched)continue;
    if(large.side==='buy'&&current.close>=z.low&&loc>=.6)out.push(pattern('institutional-demand-retest','buy',frame,current,{level:z.low,entry:current.high,stop:Math.min(current.low,z.low)*(1-c.stopBufferPct/100),volumeRatio:volumeRatioAt(cs,index,c.volumePeriod),atrRatio:trueRange(current,cs[index-1])/Math.max(a,.0001),originDate:large.date,zone:z,evidence:[`عودة إلى منطقة شمعة صاعدة كبيرة من ${large.date}`,`رفض الهبوط والإغلاق أعلى المنطقة`]}));
    if(large.side==='sell'&&current.close<=z.high&&loc<=.4)out.push(pattern('institutional-supply-retest','sell',frame,current,{level:z.high,entry:current.low,stop:Math.max(current.high,z.high)*(1+c.stopBufferPct/100),volumeRatio:volumeRatioAt(cs,index,c.volumePeriod),atrRatio:trueRange(current,cs[index-1])/Math.max(a,.0001),originDate:large.date,zone:z,evidence:[`عودة إلى منطقة شمعة هابطة كبيرة من ${large.date}`,`رفض الصعود والإغلاق أسفل المنطقة`]}));
  }
  return out.slice(-1);
}

function scanFrame(rows,frame,c,{historical=false}={}){
  const cs=normalizePatternCandles(rows,frame!=='1D');if(cs.length<(frame==='1D'?c.minDaily:c.minIntraday))return{timeframe:frame,available:false,candles:cs.length,trend:'neutral',patterns:[],watch:[]};
  const trend=trendOf(cs,c.pivotWindow),patterns=[],start=Math.max(c.volumePeriod,cs.length-2);
  for(let i=start;i<cs.length;i++)patterns.push(...detectFalseMove(cs,i,frame,c),...detectVolume(cs,i,frame,c),...detectLargeCandle(cs,i,frame,c),...detectInstitutionalRetest(cs,i,frame,c));
  const unique=[...new Map(patterns.map(p=>[`${p.type}:${p.side}:${p.date}`,p])).values()],current=unique.filter(p=>p.date===cs.at(-1).date),levels=historicalLevels(cs,cs.length-1,c),last=cs.at(-1),a=atrAt(cs,cs.length-1),watch=[];
  if(!current.length){
    const support=levels.filter(l=>l.side==='support').sort((m,n)=>Math.abs(last.close-m.price)-Math.abs(last.close-n.price))[0],resistance=levels.filter(l=>l.side==='resistance').sort((m,n)=>Math.abs(last.close-m.price)-Math.abs(last.close-n.price))[0];
    if(support&&Math.abs(last.close-support.price)<=a*c.nearZoneAtr)watch.push({side:'buy',timeframe:frame,timeframeLabel:FRAME_LABELS[frame],type:'near-support',label:'قرب دعم تاريخي',level:support.price,entry:last.high,stop:support.price*(1-c.stopBufferPct/100),distanceAtr:Math.abs(last.close-support.price)/Math.max(a,.0001),reason:'السعر قريب من دعم تاريخي وينتظر نموذجًا شرائيًا مكتملًا.'});
    if(resistance&&Math.abs(last.close-resistance.price)<=a*c.nearZoneAtr)watch.push({side:'sell',timeframe:frame,timeframeLabel:FRAME_LABELS[frame],type:'near-resistance',label:'قرب مقاومة تاريخية',level:resistance.price,entry:last.low,stop:resistance.price*(1+c.stopBufferPct/100),distanceAtr:Math.abs(last.close-resistance.price)/Math.max(a,.0001),reason:'السعر قريب من مقاومة تاريخية وينتظر نموذجًا بيعيًا مكتملًا.'});
  }
  return{timeframe:frame,available:true,candles:cs.length,trend,patterns:current,watch,levels:levels.slice(-30),lastDate:last.date,historical:historical?historicalStats(cs,current[0],frame,c):null};
}

function historicalStats(cs,primary,frame,c){
  if(!primary)return null;const matches=[];
  for(let i=Math.max(c.volumePeriod,15);i<cs.length-10;i++){
    const detectors=[...detectFalseMove(cs,i,frame,c),...detectVolume(cs,i,frame,c),...detectLargeCandle(cs,i,frame,c),...detectInstitutionalRetest(cs,i,frame,c)],hit=detectors.find(x=>x.type===primary.type&&x.side===primary.side);if(!hit)continue;
    const entry=hit.entry,stop=hit.stop,risk=Math.abs(entry-stop);if(!risk)continue;const future=cs.slice(i+1,i+11),target=primary.side==='buy'?entry+2*risk:entry-2*risk,stopHit=future.findIndex(x=>primary.side==='buy'?x.low<=stop:x.high>=stop),targetHit=future.findIndex(x=>primary.side==='buy'?x.high>=target:x.low<=target);matches.push({success:targetHit>=0&&(stopHit<0||targetHit<stopHit)});
  }
  const wins=matches.filter(x=>x.success).length;return{pattern:primary.type,cases:matches.length,wins,successRate:matches.length?Math.round(wins/matches.length*100):null,sufficient:matches.length>=10,horizonBars:10,targetRiskMultiple:2};
}

function patternRank(p,frameTrend){let rank=50+FRAME_WEIGHT[p.timeframe]*5;if(p.volumeRatio>=2)rank+=10;else if(p.volumeRatio>=1.5)rank+=5;if((p.side==='buy'&&frameTrend==='up')||(p.side==='sell'&&frameTrend==='down'))rank+=8;if((p.levelTouches||0)>=2)rank+=5;return rank}
function strength(score,count,frames){if(count>=2&&frames>=2||score>=85)return'strong';if(count>=2||score>=70)return'good';return'initial'}

export function analyzePatterns(input,config={}){
  const c={...PATTERN_CONFIG,...config},frames=[scanFrame(input?.daily,'1D',c,{historical:c.includeHistoricalStats}),scanFrame(input?.hourly||input?.intraday,'60',c),scanFrame(input?.minutes15,'15',c)],available=frames.filter(x=>x.available),all=available.flatMap(f=>f.patterns.map(p=>({...p,rank:patternRank(p,f.trend)}))),buy=all.filter(p=>p.side==='buy'),sell=all.filter(p=>p.side==='sell'),sum=a=>a.reduce((s,p)=>s+p.rank,0),buyRank=sum(buy),sellRank=sum(sell);let decision='wait',selected=[];
  if(buy.length&&!sell.length||buyRank>sellRank)decision='buy',selected=buy;
  else if(sell.length&&!buy.length||sellRank>buyRank)decision='sell',selected=sell;
  const conflict=buy.length&&sell.length,primary=selected.sort((a,b)=>b.rank-a.rank)[0]||null,frameCount=new Set(selected.map(x=>x.timeframe)).size,score=primary?clamp(primary.rank+(selected.length-1)*8+(frameCount>1?7:0),50,95):0,signalStrength=primary?strength(score,selected.length,frameCount):null;
  let watch=null;if(decision==='wait'){const candidates=available.flatMap(f=>f.watch.map(w=>({...w,rank:FRAME_WEIGHT[w.timeframe]}))).sort((a,b)=>b.rank-a.rank||a.distanceAtr-b.distanceAtr);if(candidates[0])watch={...candidates[0],score:45,strength:'watch'}}
  const entry=primary?.entry??null,stop=primary?.stop??null,riskPct=entry&&stop?Math.abs(entry-stop)/entry*100:null,warnings=[];if(riskPct>c.maxRiskPct)warnings.push(`مسافة إلغاء الإشارة ${riskPct.toFixed(1)}% أعلى من حد المخاطرة الإرشادي ${c.maxRiskPct}%؛ الإشارة معروضة ولا تُلغى آليًا.`);if(!frames.find(x=>x.timeframe==='15')?.available)warnings.push('فاصل 15 دقيقة غير متوفر بعد؛ يعمل المسح حاليًا على اليومي والساعة.');if(conflict)warnings.push('ظهرت نماذج شراء وبيع متعارضة؛ اختير الجانب صاحب الأدلة الأقوى مع إبراز التعارض.');
  const checks=(selected.length?selected:all).map(p=>({id:p.type,name:`${p.label} — ${p.timeframeLabel}`,passed:true,available:true,group:'نماذج حركة السعر',detail:p.evidence?.join('؛ ')}));
  const trends=Object.fromEntries(frames.map(f=>[f.timeframe,f.trend])),historical=frames.find(f=>f.timeframe==='1D')?.historical||null;
  return{decision,score,strength:signalStrength,mode:'pattern-scanner',provisional:!frames.find(x=>x.timeframe==='15')?.available,reason:primary?`${primary.label} على فاصل ${primary.timeframeLabel}${selected.length>1?` مع ${selected.length-1} تأكيد إضافي`:''}.`:watch?watch.reason:'لم يظهر أي نموذج مستقل مكتمل على الشموع الأخيرة.',entry,stop,riskPct,watch,primaryPattern:primary,patterns:all,confirmations:selected.filter(x=>x!==primary),conflict,buyPatterns:buy.length,sellPatterns:sell.length,trend:trends['1D']||'neutral',trends:{daily:trends['1D']||'neutral',hourly:trends['60']||'neutral',minutes15:trends['15']||'neutral'},timeframes:{daily:frames[0].candles,hourly:frames[1].candles,minutes15:frames[2].candles},coverage:{courseConditions:true,daily:frames[0].available,hourly:frames[1].available,minutes15:frames[2].available,intraday:frames[1].available||frames[2].available},checks,warnings,historicalStats:historical,side:decision==='wait'?(watch?.side||null):decision};
}
