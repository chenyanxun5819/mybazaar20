import fs from 'fs';
const s = fs.readFileSync('c:/mybazaar20/src/views/auth/UniversalLogin.jsx', 'utf8');
const lines = s.split('\n');
let braceBalance = 0;
for (let i = 800; i <= 895; i++) {
  const line = lines[i];
  const opening = (line.match(/{/g) || []).length;
  const closing = (line.match(/}/g) || []).length;
  braceBalance += opening - closing;
  if (opening > 0 || closing > 0) {
    console.log(`Line ${i+1}: balance=${braceBalance} (${opening} open, ${closing} close): ${line.slice(0, 80)}`);
  }
}
console.log(`\nFinal balance at line 896: ${braceBalance}`);
