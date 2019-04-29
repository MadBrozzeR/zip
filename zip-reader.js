const Reader = require('mbr-buffer').Reader;
const zlib = require('zlib');

const HEADERS = {
  LOCAL: Buffer.from([80, 75, 3, 4]),
  CENTRAL: Buffer.from([80, 75, 1, 2]),
  EOCD: Buffer.from([80, 75, 5, 6])
};

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
      crc32: this.readUIntLE(4),
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
      crc32: this.readUIntLE(4),
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

function MBRZip (buffer) {
  this.reader = new ZipReader(buffer);
  this.eocd = this.reader.getEOCD();
  this.cd = [];

  if (this.eocd) {
    this.reader.goTo(this.eocd.CDStart);
    for (let index = 0 ; index < this.eocd.CDCount ; ++index) {
      this.cd.push(this.reader.readCD());
    }
  }
}
MBRZip.prototype.get = function (index) {
  const cd = this.cd[index];

  if (cd) {
    this.reader.goTo(cd.offset);
    return (this.reader.readLocalHeader());
  }
};
MBRZip.prototype.extract = function (index, callback) {
  const header = this.get(index);

  if (header) {
    this.reader.goTo(header.offset);
    const data = this.reader.slice(header.compressedSize);
    (EXTRACTION[header.method] || EXTRACTION[0])(data, null, callback);
  }

  return this;
};

module.exports = MBRZip;
