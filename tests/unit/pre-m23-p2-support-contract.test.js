'use strict';

const crypto = require('crypto');
const zlib = require('zlib');

const {
  MAX_DESCRIPTION_BYTES,
  SupportCaseError,
  normalizeSubmission,
} = require('../../src/support/contract');
const {
  MAX_SCREENSHOT_BYTES,
  sanitizeScreenshot,
} = require('../../src/support/attachment');

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

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function pngWithMetadata() {
  const header = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('GPS\0do-not-retain', 'utf8')),
    pngChunk('eXIf', Buffer.from('4578696600004d4d', 'hex')),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function jpegWithMetadata() {
  const segment = (marker, data) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(data.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, data]);
  };
  const sof = Buffer.from([8, 0, 1, 0, 1, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF thumbnail private metadata', 'utf8')),
    segment(0xfe, Buffer.from('GPS private metadata', 'utf8')),
    segment(0xc0, sof),
    segment(0xda, Buffer.alloc(0)),
    Buffer.from([0x01, 0xff, 0x00, 0x02, 0xff, 0xd0, 0x03]),
    segment(0xe1, Buffer.from('EXIF after scan', 'utf8')),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webpChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(type, 'ascii'), length, data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function webpWithMetadata() {
  const extended = Buffer.alloc(10);
  extended[0] = 0x2c;
  const vp8 = Buffer.alloc(10);
  vp8.set([0x9d, 0x01, 0x2a], 3);
  vp8.writeUInt16LE(1, 6);
  vp8.writeUInt16LE(1, 8);
  const chunks = Buffer.concat([
    webpChunk('VP8X', extended),
    webpChunk('EXIF', Buffer.from('GPS private metadata', 'utf8')),
    webpChunk('XMP ', Buffer.from('customer private metadata', 'utf8')),
    webpChunk('VP8 ', vp8),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(chunks.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, chunks]);
}

describe('Pre-Mission-23 P2 durable support-case contract', () => {
  test('preserves bounded hostile report text as data and derives non-secret idempotency evidence', () => {
    const attachment = {
      id: crypto.randomUUID(),
      originalFilename: '<img src=x onerror=globalThis.compromised=true>.png',
      mediaType: 'image/png',
      originalSize: 120,
      storedSize: 4,
      originalSha256: 'a'.repeat(64),
      storedSha256: 'b'.repeat(64),
      bytes: Buffer.from('safe'),
      width: 1,
      height: 1,
    };
    const parsed = normalizeSubmission({
      body: {
        title: '  Calendar button shows <script>not code</script>  ',
        description: 'Steps:\n1. Open Calendar\n2. Click <img src=x onerror=alert(1)>',
      },
      idempotencyKey: 'p2-support-idempotency-0001',
      attachment,
    });

    expect(parsed.title).toBe('Calendar button shows <script>not code</script>');
    expect(parsed.description).toContain('<img src=x onerror=alert(1)>');
    expect(parsed.idempotencyKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed).not.toHaveProperty('idempotencyKey');
    expect(parsed.attachment.originalFilename).toBe(attachment.originalFilename);
  });

  test.each([
    ['missing title', { description: 'A useful description.' }, 'p2-support-idempotency-0002'],
    ['unsupported field', { title: 'Bug', description: 'Description', status: 'resolved' }, 'p2-support-idempotency-0003'],
    ['control character', { title: 'Bug\u000c', description: 'Description' }, 'p2-support-idempotency-0004'],
    ['multiline title', { title: 'Bug\nforged field', description: 'Description' }, 'p2-support-idempotency-0006'],
    ['short idempotency', { title: 'Bug', description: 'Description' }, 'short'],
    ['overlong description', { title: 'Bug', description: 'x'.repeat(MAX_DESCRIPTION_BYTES + 1) }, 'p2-support-idempotency-0005'],
  ])('rejects %s without silently truncating or reinterpreting input', (_label, body, key) => {
    expect(() => normalizeSubmission({ body, idempotencyKey: key, attachment: null }))
      .toThrow(SupportCaseError);
  });

  test('verifies PNG bytes, strips metadata chunks, and records original/stored provenance', () => {
    const original = pngWithMetadata();
    const result = sanitizeScreenshot({
      buffer: original,
      mimetype: 'image/png',
      originalname: 'customer-calendar.png',
      size: original.length,
    });

    expect(result.mediaType).toBe('image/png');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.originalSize).toBe(original.length);
    expect(result.storedSize).toBeLessThan(original.length);
    expect(result.originalSha256).toBe(crypto.createHash('sha256').update(original).digest('hex'));
    expect(result.storedSha256).toBe(crypto.createHash('sha256').update(result.bytes).digest('hex'));
    expect(result.bytes.includes(Buffer.from('GPS'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('eXIf'))).toBe(false);
    expect(result.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  test.each([
    ['JPEG', 'image/jpeg', 'customer-calendar.jpg', jpegWithMetadata(), ['JFIF', 'GPS', 'EXIF']],
    ['WebP', 'image/webp', 'customer-calendar.webp', webpWithMetadata(), ['EXIF', 'XMP ', 'GPS']],
  ])('strips all supported %s metadata while retaining bounded image evidence',
    (_label, mimetype, originalname, original, removed) => {
      const result = sanitizeScreenshot({ buffer: original, mimetype, originalname, size: original.length });
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.storedSize).toBeLessThan(result.originalSize);
      for (const marker of removed) expect(result.bytes.includes(Buffer.from(marker))).toBe(false);
    });

  test.each([
    ['SVG declaration', { buffer: Buffer.from('<svg onload=alert(1)>'), mimetype: 'image/svg+xml', originalname: 'proof.svg' }],
    ['spoofed PNG', { buffer: Buffer.from('<html>not an image</html>'), mimetype: 'image/png', originalname: 'proof.png' }],
    ['executable filename', { buffer: pngWithMetadata(), mimetype: 'image/png', originalname: 'proof.png\u0000.exe' }],
    ['ambiguous padded filename', { buffer: pngWithMetadata(), mimetype: 'image/png', originalname: ' proof.png ' }],
    ['oversized bytes', { buffer: Buffer.alloc(MAX_SCREENSHOT_BYTES + 1), mimetype: 'image/png', originalname: 'proof.png' }],
  ])('rejects %s safely', (_label, file) => {
    expect(() => sanitizeScreenshot({ ...file, size: file.buffer.length })).toThrow(SupportCaseError);
  });
});
