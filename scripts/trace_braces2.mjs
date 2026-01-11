import fs from 'fs';
const s = fs.readFileSync('c:/mybazaar20/src/views/auth/UniversalLogin.jsx', 'utf8');
const lines = s.split('\n');
let braceBalance = 0;
// Start from line 890 (index 889)
for (let i = 889; i < lines.length; i++) {
  const line = lines[i];
  const opening = (line.match(/{/g) || []).length;
  const closing = (line.match(/}/g) || []).length;
  braceBalance += opening - closing;
  if (i >= 1020 && i <= 1035) {
    console.log(`Line ${i+1}: balance=${braceBalance} (${opening} open, ${closing} close): ${line.slice(0, 80)}`);
  }
}
