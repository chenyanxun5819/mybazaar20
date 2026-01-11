import fs from 'fs';
const path = 'c:/mybazaar20/src/views/auth/UniversalLogin.jsx';
const s = fs.readFileSync(path, 'utf8');
function count(regex){return (s.match(regex)||[]).length}
const counts = {
  openDiv: count(/<div(?=\s|>)/g),
  closeDiv: count(/<\/div>/g),
  openForm: count(/<form(?=\s|>)/g),
  closeForm: count(/<\/form>/g),
  openP: count(/<p(?=\s|>)/g),
  closeP: count(/<\/p>/g),
  openButton: count(/<button(?=\s|>)/g),
  closeButton: count(/<\/button>/g),
  openImg: count(/<img(?=\s|>)/g),
};
console.log(JSON.stringify(counts, null, 2));
