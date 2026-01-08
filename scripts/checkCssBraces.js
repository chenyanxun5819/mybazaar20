const fs = require('fs');
const path = require('path');
function walk(dir){
  let results = [];
  fs.readdirSync(dir).forEach(f=>{
    const fp = path.join(dir,f);
    const stat = fs.statSync(fp);
    if(stat.isDirectory()) results = results.concat(walk(fp));
    else if(fp.endsWith('.css')) results.push(fp);
  });
  return results;
}
const files = walk(path.join(__dirname,'..','src'));
let bad = [];
files.forEach(f=>{
  const txt = fs.readFileSync(f,'utf8');
  const open = (txt.match(/\{/g)||[]).length;
  const close = (txt.match(/\}/g)||[]).length;
  if(open !== close) bad.push({file:f,open,close});
});
if(bad.length===0){
  console.log('All CSS files balanced.');
}else{
  bad.forEach(b=>console.log(`${b.file} : { ${b.open} vs } ${b.close}`));
  process.exit(2);
}
