import { listStocks } from '../server.mjs';

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin',process.env.ALLOWED_ORIGIN||'*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Cache-Control','public, max-age=300');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{return res.status(200).json({stocks:await listStocks(),updatedAt:new Date().toISOString()})}
  catch(error){return res.status(502).json({error:error.message||'تعذر جلب قائمة الأسهم.'})}
}
