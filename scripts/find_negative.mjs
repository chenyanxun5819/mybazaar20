import fs from 'fs';
const s = fs.readFileSync('c:/mybazaar20/src/views/auth/UniversalLogin.jsx', 'utf8');
const lines = s.split('\n');
let b = 0;
for (let i = 27; i < lines.length; i++) {
  const line = lines[i];
  const o = (line.match(/{/g) || []).length;
  const c = (line.match(/}/g) || []).length;
  b += o - c;
  if (b < 0) {
    console.log(`Balance goes negative at line ${i+1}: ${line.slice(0, 80)}`);
    console.log(`Previous lines:`);
    for (let j = Math.max(27, i-3); j < i+1; j++) {
      const prevLine = lines[j];
      const po = (prevLine.match(/{/g) || []).length;
      const pc = (prevLine.match(/}/g) || []).length;
      const bi = j === 27 ? 1 : b - (lines.slice(28, j+1).reduce((acc, l) => acc + ((l.match(/{/g) || []).length - (l.match(/}/g) || []).length), 0));
      console.log(`  Line ${j+1}: ${prevLine.slice(0, 80)}`);
    }
    break;
  }
}
console.log(`Final balance: ${b}`);
