import fs from 'fs';
const s = fs.readFileSync('c:/mybazaar20/src/views/auth/UniversalLogin.jsx', 'utf8');
const lines = s.split('\n');

// From the top of UniversalLogin function to line 1032
let total_open = 0, total_close = 0;
for (let i = 27; i < 1032; i++) {
  const line = lines[i];
  total_open += (line.match(/{/g) || []).length;
  total_close += (line.match(/}/g) || []).length;
}
console.log(`Lines 28-1032: total open = ${total_open}, total close = ${total_close}, diff = ${total_open - total_close}`);

// Check lines 1033 onwards (styles object)
let styles_open = 0, styles_close = 0;
for (let i = 1033; i < lines.length; i++) {
  const line = lines[i];
  const o = (line.match(/{/g) || []).length;
  const c = (line.match(/}/g) || []).length;
  styles_open += o;
  styles_close += c;
  if (i >= 1050) break; // Just check first few lines of styles
}
console.log(`Lines 1034-1050: styles open = ${styles_open}, styles close = ${styles_close}, diff = ${styles_open - styles_close}`);
