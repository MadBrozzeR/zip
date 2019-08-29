const Reader = require('mbr-buffer').Reader;
const zlib = require('zlib');
const HEADERS = require('./constants.js').HEADERS;

const EXTRACTION = {
  '0': function (data, options, callback) {
    callback(null, data);
  },
  '8': function (data, options, callback) {
    zlib.inflateRaw(data, callback);
  }
};
EXTRACTION[9] = EXTRACTION[8];

function ZipReader (data) {
  Reader.call(this, data);
}

ZipReader.prototype = Object.create(Reader.prototype);

ZipReader.prototype.getEOCD = function () {
  const oldIndex = this.index;
  let result = null;

  const index = this.last(HEADERS.EOCD);
  if (index > -1) {
    this.goTo(index + 4);
    result = {
      diskNumber: this.readUIntLE(2),
      diskCDStart: this.readUIntLE(2),
      CDCountOnDisk: this.readUIntLE(2),
      CDCount: this.readUIntLE(2),
      CDSize: this.readUIntLE(4),
      CDStart: this.readUIntLE(4)
    };
    const commentLength = this.readUIntLE(2);
    result.comment = this.read(commentLength);

    this.goTo(oldIndex);
  }

  return result;
}

ZipReader.prototype.readCD = function () {
  const header = this.read(4, 'base64');
  let result = null;
  if (header === HEADERS.CENTRAL.toString('base64')) {
    result = {
      versionMadeBy: this.readUIntLE(2),
      versionToExtract: this.readUIntLE(2),
      purposeBitFlag: this.readUIntLE(2),
      method: this.readUIntLE(2),
      modTime: this.readUIntLE(2),
      modDate: this.readUIntLE(2),
      crc32: this.slice(4),
      compressedSize: this.readUIntLE(4),
      uncompressedSize: this.readUIntLE(4),
      nameLen: this.readUIntLE(2),
      extraLen: this.readUIntLE(2),
      commentLen: this.readUIntLE(2),
      disk: this.readUIntLE(2),
      attributes: this.readUIntLE(2),
      extAttributes: this.readUIntLE(4),
      offset: this.readUIntLE(4)
    };
    result.name = this.read(result.nameLen);
    result.extra = this.read(result.extraLen);
    result.comment = this.read(result.commentLen);
  } else {
    this.skip(-4);
  }
  return result;
};

ZipReader.prototype.readLocalHeader = function () {
  const header = this.read(4, 'base64');
  let result = null;
  if (header === HEADERS.LOCAL.toString('base64')) {
    result = {
      versionToExtract: this.readUIntLE(2),
      purposeBitFlag: this.readUIntLE(2),
      method: this.readUIntLE(2),
      modTime: this.readUIntLE(2),
      modDate: this.readUIntLE(2),
      crc32: this.slice(4),
      compressedSize: this.readUIntLE(4),
      uncompressedSize: this.readUIntLE(4)
    };
    const nameLen = this.readUIntLE(2);
    const extraLen = this.readUIntLE(2);
    result.name = this.read(nameLen);
    result.extra = this.read(extraLen);
    result.offset = this.index;
  }
  result.isDataDescriptor = result.purposeBitFlag & 0x08;

  return result;
};

function Record (cd, zip) {
  this.header = cd;
  this.localHeader;
  this.data;
  this.zip = zip;
}
Record.prototype.getLocalHeader = function () {
  if (!this.localHeader) {
    this.zip.reader.goTo(this.header.offset);

    this.localHeader = this.zip.reader.readLocalHeader();
  }

  return this.localHeader;
}
Record.prototype.getData = function () {
  if (!this.data) {
    const localHeader = this.getLocalHeader();

    this.zip.reader.goTo(localHeader.offset);
    this.data = this.zip.reader.slice(localHeader.compressedSize || this.header.compressedSize);
  }

  return this.data;
}
Record.prototype.extract = function (callback) {
  const data = this.getData();
  const method = this.localHeader.method || this.header.method;

  if (data) {
    (EXTRACTION[method] || EXTRACTION[0])(data, null, callback);
  }

  return this;
}

function MBRZip (buffer) {
  this.reader = new ZipReader(buffer);
  this.eocd = this.reader.getEOCD();
  this.records = [];

  if (this.eocd) {
    this.reader.goTo(this.eocd.CDStart);
    for (let index = 0 ; index < this.eocd.CDCount ; ++index) {
      this.records.push(new Record(this.reader.readCD(), this));
    }
  }
}
MBRZip.prototype.get = function (index) {
  return this.records[index] && this.records[index].getLocalHeader();
};
MBRZip.prototype.extract = function (index, callback) {
  if (this.records[index]) {
    this.records[index].extract(callback);
  } else {
    callback(new Error('Record not found. Index: ' + index + '. Total records: ' + this.records.length));
  }

  return this;
};
MBRZip.prototype.iterate = function (callback) {
  for (let index = 0 ; index < this.records.length ; ++index) {
    callback.call(this, this.records[index].header.name, this.records[index]);
  }

  return this;
}

module.exports = MBRZip;
