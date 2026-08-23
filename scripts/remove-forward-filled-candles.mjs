import { readdir, readFile, writeFile } from 'node:fs/promises';

const directories=['data','data/intraday'];
let totalRemoved=0,filesChanged=0;
for(const directory of directories){
  const files=(await readdir(directory)).filter(name=>name.endsWith('.json'));
  for(const file of files){
    const path=`${directory}/${file}`,rows=JSON.parse(await readFile(path,'utf8'));
    const keys=['open','high','low','close','volume'];
    const clean=rows.filter((row,index,array)=>index===0||!keys.every(key=>row[key]===array[index-1][key]));
    if(clean.length===rows.length)continue;
    await writeFile(path,`${JSON.stringify(clean,null,2)}\n`,'utf8');
    totalRemoved+=rows.length-clean.length;filesChanged++;
    console.log(`${path}: removed ${rows.length-clean.length}`);
  }
}
console.log(`Removed ${totalRemoved} forward-filled candles from ${filesChanged} files.`);
