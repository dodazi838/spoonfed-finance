const { PDFParse } = require('pdf-parse');
try {
  const p = new PDFParse({ file: 'C:\\Users\\duddn\\AppData\\Local\\Temp\\test.pdf' });
  console.log('Success with {file}');
} catch (e) {
  console.error(e);
}
