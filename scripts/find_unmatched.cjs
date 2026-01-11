const fs = require('fs');
const path = 'c:/mybazaar20/src/views/auth/UniversalLogin.jsx';
const s = fs.readFileSync(path, 'utf8');
const tagRegex = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
const selfClosingTags = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);
let m;
const stack = [];
while ((m = tagRegex.exec(s)) !== null) {
  const full = m[0];
  const name = m[1];
  const isClosing = full.startsWith('</');
  const isSelfClosing = /\/$/.test(full) || selfClosingTags.has(name.toLowerCase());
  if (isSelfClosing) continue;
  if (!isClosing) {
    stack.push({name, index: m.index});
  } else {
    if (stack.length === 0) {
      console.log('Unmatched closing tag at', m.index, full);
      break;
    }
    const last = stack[stack.length-1];
    if (last.name.toLowerCase() === name.toLowerCase()) {
      stack.pop();
    } else {
      console.log('Tag mismatch at', m.index, 'expected closing for', last.name, 'but found', name);
      break;
    }
  }
}
if (stack.length > 0) {
  const last = stack[stack.length-1];
  console.log('Unmatched opening tag:', last);
  const snippet = s.slice(Math.max(0, last.index-100), last.index+200);
  console.log('Snippet around unmatched tag:\n', snippet);
} else {
  console.log('All tags matched');
}
