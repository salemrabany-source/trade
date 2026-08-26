import { readFile } from 'node:fs/promises';
import { analyzePatterns } from '../pattern-engine.mjs';

const SYMBOLS = ['ABQK','AHCS','AKHI','BEMA','BLDN','BRES','CBQK','DBIS','DHBK','DOHI','DUBK','ERES','FALH','GISS','GWCS','IGRD','IHGS','IQCD','MARK','MCCS','MCGS','MERS','MEZA','MFMS','MHAR','MKDM','MPHC','MRDS','NLCS','ORDS','QAMC','QATI','QCFS','QEWS','QFBQ','QFLS','QGMD','QGRI','QGTS','QIBK','QIGD','QIIK','QIMD','QISI','QLMI','QNBK','QNCD','QNNS','SIIS','TQES','UDCD','VFQS','WDAM','ZHCD'];
const NAMES = {
  ABQK:'الأهلي',AHCS:'أعمال',AKHI:'الخليج للتأمين',BEMA:'بيمه',BLDN:'بلدنا',BRES:'بروة',CBQK:'البنك التجاري',DBIS:'دلالة',DHBK:'بنك الدوحة',DOHI:'الدوحة للتأمين',DUBK:'بنك دخان',ERES:'إزدان',FALH:'الفالح',GISS:'الخليج الدولية',GWCS:'مخازن',IGRD:'استثمار',IHGS:'إنماء',IQCD:'صناعات قطر',MARK:'مصرف الريان',MCCS:'المناعي',MCGS:'الرعاية',MERS:'الميرة',MEZA:'ميزة',MFMS:'مساندة',MHAR:'المحار',MKDM:'مقدام',MPHC:'مسيعيد',MRDS:'مزايا',NLCS:'الإجارة',ORDS:'أريدُ',QAMC:'قامكو',QATI:'قطر للتأمين',QCFS:'السينما',QEWS:'نبراس',QFBQ:'لشا',QFLS:'وقود',QGMD:'الطبية',QGRI:'العامة للتأمين',QGTS:'ناقلات',QIBK:'المصرف',QIGD:'المستثمرين',QIIK:'الدولي الإسلامي',QIMD:'التحويلية',QISI:'الإسلامية للتأمين',QLMI:'QLM',QNBK:'QNB',QNCD:'الأسمنت',QNNS:'الملاحة',SIIS:'السلام',TQES:'تكنو كيو',UDCD:'المتحدة',VFQS:'فودافون',WDAM:'ودام',ZHCD:'زاد'
};

const qatarDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const rows = [];

for (const symbol of SYMBOLS) {
  try {
    const daily = JSON.parse(await readFile(new URL(`../data/${symbol}.json`, import.meta.url), 'utf8'));
    const intraday = JSON.parse(await readFile(new URL(`../data/intraday/${symbol}-60.json`, import.meta.url), 'utf8'));
    let minutes15=[];try{minutes15=JSON.parse(await readFile(new URL(`../data/intraday/${symbol}-15.json`,import.meta.url),'utf8'))}catch{}
    const analysis = analyzePatterns({ daily, hourly:intraday, minutes15 },{includeHistoricalStats:false});
    rows.push({ symbol, name: NAMES[symbol] || symbol, price: Number(daily.at(-1)?.close), date: daily.at(-1)?.date, ...analysis });
  } catch (error) {
    rows.push({ symbol, name: NAMES[symbol] || symbol, error: error.message });
  }
}

// لا يرسل التقرير إلا إشارة مؤكدة ناتجة عن شمعة اليوم نفسها.
const confirmed = rows.filter(x => x.date === qatarDate && (x.decision === 'buy' || x.decision === 'sell'));
const errors = rows.filter(x => x.error || x.mode === 'data-integrity-error' || x.mode === 'insufficient-history');
const arSide = side => side === 'buy' ? 'شراء' : 'بيع';
const num = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3) : '—';

function table(items, watch = false) {
  if (!items.length) return '<p>لا توجد.</p>';
  const body = items.map(x => {
    const signal = watch ? x.watch : x;
    return `<tr><td>${x.name} (${x.symbol})</td><td>${arSide(watch ? signal.side : x.decision)}</td><td>${signal.score}%</td><td>${num(signal.entry)}</td><td>${num(signal.stop)}</td><td>${num(x.price)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>السهم</th><th>الإشارة</th><th>الدرجة</th><th>التفعيل</th><th>الإلغاء</th><th>الإغلاق</th></tr></thead><tbody>${body}</tbody></table>`;
}

const styles = 'body{font-family:Arial,Tahoma,sans-serif;direction:rtl;color:#172033;line-height:1.7}h1{color:#123c69}h2{margin-top:26px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d7dee8;padding:8px;text-align:center}th{background:#eef4fb}.note{color:#5f6b7a;font-size:13px}';
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${styles}</style></head><body><h1>إشارات البيع والشراء لليوم — ${qatarDate}</h1><p>تم فحص <strong>${rows.length}</strong> سهمًا. يعرض هذا البريد إشارات اليوم المؤكدة فقط، ولا يشمل الانتظار أو المراقبة أو الإشارات التاريخية.</p><h2>بيع وشراء مؤكد (${confirmed.length})</h2>${table(confirmed)}${errors.length ? `<h2>بيانات تحتاج مراجعة (${errors.length})</h2><p>${errors.map(x => `${x.name} (${x.symbol})`).join('، ')}</p>` : ''}<p class="note">هذه نتائج تحليل فني آلي وليست ضمانًا للربح أو توصية استثمارية مباشرة.</p></body></html>`;
const subject = `بيع وشراء اليوم ${qatarDate}: ${confirmed.length} إشارة`;

console.log(JSON.stringify({ date: qatarDate, checked: rows.length, confirmed: confirmed.map(x => `${x.symbol}:${x.decision}:${x.score}`), errors: errors.map(x => x.symbol) }, null, 2));

const apiKey = process.env.RESEND_API_KEY;
const to = process.env.ALERT_EMAIL_TO;
const from = process.env.ALERT_EMAIL_FROM;
if (!apiKey || !to || !from) {
  console.log('Email skipped: add RESEND_API_KEY, ALERT_EMAIL_TO and ALERT_EMAIL_FROM to GitHub Actions secrets.');
  process.exit(0);
}

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ from, to: to.split(',').map(x => x.trim()).filter(Boolean), subject, html })
});
if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${await response.text()}`);
console.log(`Email sent successfully: ${(await response.json()).id}`);
