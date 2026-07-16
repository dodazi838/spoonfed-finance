const p = require('pdf-parse');
console.log('exports:', Object.keys(p));
console.log('default:', p.default);
if (p.default) {
  console.log('default type:', typeof p.default);
}
