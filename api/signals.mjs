import { listCurrentSignals } from '../server.mjs';

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin',process.env.ALLOWED_ORIGIN||'*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{return res.status(200).json(await listCurrentSignals())}
  catch(error){return res.status(502).json({error:error.message||'تعذر جرد الإشارات.'})}
}
