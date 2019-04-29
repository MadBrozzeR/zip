const MBRZip = require('../zip-reader.js');
const fs = require('fs');
const file = fs.readFileSync('./test.zip');

const zip = new MBRZip(file);
zip.extract(4, function (error, data) {
  if (error) {
    console.log(error);
  } else {
    console.log(data.toString());
  }
});
