'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { SupportCaseError } = require('./contract');

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const SAFE_MEDIA = Object.freeze({
  'image/png': Object.freeze({ extensions: new Set(['.png']), sanitize: sanitizePng }),
  'image/jpeg': Object.freeze({ extensions: new Set(['.jpg', '.jpeg']), sanitize: sanitizeJpeg }),
  'image/webp': Object.freeze({ extensions: new Set(['.webp']), sanitize: sanitizeWebp }),
});
const CONTROL = /[\u0000-\u001f\u007f]/;

function invalid(message = 'The screenshot must be a valid PNG, JPEG, or WebP image.') {
  throw new SupportCaseError(400, 'invalid_support_screenshot', message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeFilename(value, extensions) {
  if (typeof value !== 'string' || !value || value !== value.trim() || CONTROL.test(value) || /[\\/]/.test(value) ||
      Buffer.byteLength(value, 'utf8') > 255 || Array.from(value).length > 180 ||
      value === '.' || value === '..') {
    invalid('The screenshot filename is invalid.');
  }
  const dot = value.lastIndexOf('.');
  const extension = dot >= 0 ? value.slice(dot).toLowerCase() : '';
  if (!extensions.has(extension)) invalid('The screenshot filename does not match its image type.');
  return value;
}

function assertDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    invalid('The screenshot dimensions are invalid or too large.');
  }
  return { width, height };
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function sanitizePng(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid();
  const kept = [bytes.subarray(0, 8)];
  const idat = [];
  let offset = 8;
  let header = null;
  let ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_SCREENSHOT_BYTES || offset + 12 + length > bytes.length) invalid();
    const typeBuffer = bytes.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(type)) invalid();
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) invalid();
    const complete = bytes.subarray(offset, offset + 12 + length);
    if (!header) {
      if (type !== 'IHDR' || length !== 13) invalid();
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const validDepths = {
        0: new Set([1, 2, 4, 8, 16]), 2: new Set([8, 16]), 3: new Set([1, 2, 4, 8]),
        4: new Set([8, 16]), 6: new Set([8, 16]),
      };
      if (!validDepths[colorType] || !validDepths[colorType].has(bitDepth) ||
          data[10] !== 0 || data[11] !== 0 || data[12] !== 0) invalid();
      header = { ...assertDimensions(width, height), bitDepth, colorType };
      kept.push(complete);
    } else if (type === 'IHDR') {
      invalid();
    } else if (type === 'IDAT') {
      idat.push(data);
      kept.push(complete);
    } else if (type === 'PLTE' || type === 'tRNS') {
      kept.push(complete);
    } else if (type === 'IEND') {
      if (length !== 0 || idat.length === 0 || offset + complete.length !== bytes.length) invalid();
      kept.push(complete);
      ended = true;
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      invalid();
    }
    offset += complete.length;
    if (ended) break;
  }
  if (!header || !ended) invalid();
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const rowBytes = Math.ceil((header.width * channels * header.bitDepth) / 8);
  const decodedLength = header.height * (rowBytes + 1);
  if (!Number.isSafeInteger(decodedLength) || decodedLength > MAX_DECODED_BYTES) invalid();
  let decoded;
  try {
    decoded = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: decodedLength + 1 });
  } catch (_error) {
    invalid();
  }
  if (decoded.length !== decodedLength) invalid();
  return { bytes: Buffer.concat(kept), width: header.width, height: header.height };
}

function sanitizeJpeg(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
  const kept = [bytes.subarray(0, 2)];
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let dimensions = null;
  let offset = 2;
  let foundScan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) invalid();
    const markerStart = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      kept.push(bytes.subarray(markerStart, offset));
      if (offset !== bytes.length) invalid();
      break;
    }
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length - 2) invalid();
      kept.push(bytes.subarray(markerStart, offset + length));
      offset += length;
      const scanStart = offset;
      let nextMarker = -1;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        let codeOffset = offset + 1;
        while (codeOffset < bytes.length && bytes[codeOffset] === 0xff) codeOffset += 1;
        if (codeOffset >= bytes.length) invalid();
        const code = bytes[codeOffset];
        if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) {
          offset = codeOffset + 1;
          continue;
        }
        nextMarker = offset;
        break;
      }
      if (nextMarker < 0) invalid();
      kept.push(bytes.subarray(scanStart, nextMarker));
      offset = nextMarker;
      foundScan = true;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) invalid();
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalid();
    const complete = bytes.subarray(markerStart, offset + length);
    if (sofMarkers.has(marker)) {
      if (length < 8 || dimensions) invalid();
      dimensions = assertDimensions(bytes.readUInt16BE(offset + 3), bytes.readUInt16BE(offset + 5));
    }
    // APP0..APP15 and COM can all carry thumbnails or arbitrary metadata.
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) kept.push(complete);
    offset += length;
  }
  if (!foundScan || !dimensions || offset !== bytes.length) invalid();
  return { bytes: Buffer.concat(kept), ...dimensions };
}

function webpDimensions(type, data) {
  if (type === 'VP8X') {
    if (data.length < 10) invalid();
    return assertDimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3));
  }
  if (type === 'VP8 ') {
    if (data.length < 10 || !data.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) invalid();
    return assertDimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff);
  }
  if (type === 'VP8L') {
    if (data.length < 5 || data[0] !== 0x2f) invalid();
    const bits = data.readUInt32LE(1);
    return assertDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

function sanitizeWebp(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      bytes.subarray(8, 12).toString('ascii') !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) invalid();
  const kept = [];
  let dimensions = null;
  let imageChunks = 0;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const length = bytes.readUInt32LE(offset + 4);
    const paddedLength = length + (length % 2);
    if (length > MAX_SCREENSHOT_BYTES || offset + 8 + paddedLength > bytes.length) invalid();
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const detected = webpDimensions(type, data);
    if (detected) {
      if (type !== 'VP8X') imageChunks += 1;
      if (!dimensions || type !== 'VP8X') dimensions = detected;
    }
    if (['EXIF', 'XMP ', 'ICCP'].includes(type)) {
      offset += 8 + paddedLength;
      continue;
    }
    if (!['VP8X', 'ALPH', 'VP8 ', 'VP8L'].includes(type)) invalid();
    if (type === 'VP8X') {
      const clean = Buffer.from(bytes.subarray(offset, offset + 8 + paddedLength));
      clean[8] &= ~0x2c; // Clear ICC, EXIF, and XMP feature flags after stripping those chunks.
      kept.push(clean);
    } else {
      kept.push(bytes.subarray(offset, offset + 8 + paddedLength));
    }
    offset += 8 + paddedLength;
  }
  if (offset !== bytes.length || !dimensions || imageChunks !== 1) invalid();
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...kept]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return { bytes: Buffer.concat([header, body]), ...dimensions };
}

function sanitizeScreenshot(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 1 ||
      file.buffer.length > MAX_SCREENSHOT_BYTES || file.size !== file.buffer.length) {
    invalid(`The screenshot must be no larger than ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB.`);
  }
  const policy = SAFE_MEDIA[file.mimetype];
  if (!policy) invalid();
  const originalFilename = safeFilename(file.originalname, policy.extensions);
  const sanitized = policy.sanitize(file.buffer);
  if (!sanitized || !Buffer.isBuffer(sanitized.bytes) || sanitized.bytes.length < 1 ||
      sanitized.bytes.length > MAX_SCREENSHOT_BYTES) invalid();
  return Object.freeze({
    id: crypto.randomUUID(),
    originalFilename,
    mediaType: file.mimetype,
    originalSize: file.buffer.length,
    storedSize: sanitized.bytes.length,
    originalSha256: sha256(file.buffer),
    storedSha256: sha256(sanitized.bytes),
    bytes: sanitized.bytes,
    width: sanitized.width,
    height: sanitized.height,
  });
}

module.exports = {
  MAX_DECODED_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_SCREENSHOT_BYTES,
  sanitizeScreenshot,
};
