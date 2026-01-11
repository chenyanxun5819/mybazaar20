import fs from 'fs';
const s = fs.readFileSync('c:/mybazaar20/src/views/auth/UniversalLogin.jsx', 'utf8');
const lines = s.split('\n');
let b = 1; // Start with 1 from line 28: const UniversalLogin = () => {
for (let i = 28; i < lines.length; i++) {
  const line = lines[i];
  const o = (line.match(/{/g) || []).length;
  const c = (line.match(/}/g) || []).length;
  b += o - c;
  if (b === 0) {
    console.log(`Balance returns to 0 at line ${i+1}: ${line.slice(0, 80)}`);
    console.log(`Context:`);
    for (let j = i-2; j <= i+3; j++) {
      if (j >= 28) {
        console.log(`  Line ${j+1}: ${lines[j].slice(0, 80)}`);
      }
    }
    break;
  }
}
