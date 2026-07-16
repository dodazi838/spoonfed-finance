const { PDFParse } = require('pdf-parse');
const fs = require('fs');

async function test() {
  // Create a dummy PDF just for testing buffer parsing
  // Actually, we can just test if the constructor throws on data
  try {
    const p = new PDFParse({ data: new Uint8Array([1,2,3]) });
    console.log('Success with {data}');
  } catch(e) {
    console.error(e);
  }
}
test();
