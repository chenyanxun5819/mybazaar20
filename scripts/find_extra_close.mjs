import fs from 'fs';
const s = fs.readFileSync('c:/mybazaar20/src/views/auth/UniversalLogin.jsx', 'utf8');
const lines = s.split('\n');

// Track running balance
let balance = 1; // From line 28: const UniversalLogin = () => {
for (let i = 28; i < 1032; i++) {
  const line = lines[i];
  const open = (line.match(/{/g) || []).length;
  const close = (line.match(/}/g) || []).length;
  balance += open - close;
  
  // If close > open, we might have found an extra }
  if (close > open) {
    console.log(`Line ${i+1}: More closes than opens (${close} close, ${open} open) - NEW balance = ${balance}`);
    console.log(`  Content: ${line.slice(0, 100)}`);
  }
}
console.log(`\nFinal balance before line 1032: ${balance}`);
console.log(`Line 1032 has }; which would result in balance = ${balance - 1}`);
