import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import ts from 'typescript';

// Isolated regressions for upload metadata stripping and failed-upload cleanup. Every image is a synthetic
// fixture built below; the metadata in them is made up. Uses an in-memory database and a fake R2 bucket.

const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
for (const name of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
  database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
database.exec(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('editor', 'Fixture Editor', 'editor@example.invalid', 1, 0, 0)`);

// Batches run in a transaction, like D1's. `failBatches` makes the next batches throw, either before
// anything runs or after the statements commit (a lost response).
const fake = { failBatches: [], stored: new Map() };
const query = (sql) => {
  const statement = database.prepare(sql);
  let values = [];
  const q = {
    sql,
    bind(...args) { values = args; return q; },
    async all() { return { results: statement.all(...values) }; },
    async first() { return statement.get(...values) ?? null; },
    async run() { statement.run(...values); return { results: [] }; },
  };
  return q;
};
globalThis.__metadataEnv = {
  DB: {
    prepare: query,
    async batch(statements) {
      const failure = fake.failBatches.shift();
      if (failure === 'before') throw new Error('D1 unavailable');
      database.exec('BEGIN');
      try {
        const results = [];
        for (const s of statements) results.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
        database.exec('COMMIT');
        if (failure === 'after') throw new Error('Network connection lost');
        return results;
      } catch (error) {
        if (database.isTransaction) database.exec('ROLLBACK');
        throw error;
      }
    },
  },
  MEDIA: {
    async put(key, bytes) { fake.stored.set(key, new Uint8Array(bytes)); },
    async delete(key) { fake.stored.delete(key); },
  },
};

// Transpiles a source file and its relative imports into data: modules, with the fake Workers env.
const envModule = `data:text/javascript,${encodeURIComponent('export const env = globalThis.__metadataEnv;')}`;
const modules = new Map();
function sourceModule(url) {
  const key = url.href;
  if (!modules.has(key)) {
    const file = existsSync(url) ? url : new URL(`${url.href}.ts`);
    let source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
    source = source.replace(/from ['"]([^'"]+)['"]/g, (_m, s) => `from ${JSON.stringify(
      s === 'cloudflare:workers' ? envModule : s.startsWith('.') ? sourceModule(new URL(s, file)) : import.meta.resolve(s))}`);
    modules.set(key, `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  return modules.get(key);
}
const load = (path) => import(sourceModule(new URL(`../${path}`, import.meta.url)));
const media = await load('src/lib/media.ts');
const adsAdmin = await load('src/lib/ads-admin.ts');
const { POST } = await load('src/pages/api/admin/media.ts');

// ---- Fixtures ----

const SECRET = 'GPS 41.4489N 82.7080W SECRET';
const bytes = (...parts) => Buffer.concat(parts.map((p) => typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)));
const u16le = (n) => [n & 255, n >> 8];
const u24le = (n) => [n & 255, (n >> 8) & 255, n >> 16];
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const text = (b) => Buffer.from(b).toString('latin1');
const leaks = (b) => /SECRET|xmpmeta|Exif|Photoshop|GPS/.test(text(b));
const strip = (b, type) => media.stripImageMetadata(new Uint8Array(b), type);

// JPEG: a marker segment is FF, marker, a two-byte length that counts itself, then the body.
const seg = (marker, ...body) => { const b = bytes(...body); return bytes([0xff, marker, (b.length + 2) >> 8, (b.length + 2) & 255], b); };
const jpegParts = {
  jfifThumb: seg(0xe0, 'JFIF\0', [1, 2, 1, 0, 72, 0, 72, 1, 1], [9, 9, 9]),
  jfif: seg(0xe0, 'JFIF\0', [1, 2, 1, 0, 72, 0, 72, 0, 0]),
  jfxx: seg(0xe0, 'JFXX\0', [0x10], SECRET),
  exif: seg(0xe1, 'Exif\0\0', 'MM\0*', SECRET),
  xmp: seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0', `<x:xmpmeta>${SECRET}</x:xmpmeta>`),
  icc: seg(0xe2, 'ICC_PROFILE\0', [1, 1], 'synthetic colour profile'),
  mpf: seg(0xe2, 'MPF\0', SECRET),
  makerNote: seg(0xe9, SECRET),
  iptc: seg(0xed, 'Photoshop 3.0\0', '8BIM', SECRET),
  adobe: seg(0xee, 'Adobe', [0, 100, 0, 0, 0, 0, 1]),
  app15: seg(0xef, SECRET),
  jpgExtension: seg(0xf7, SECRET),
  comment: seg(0xfe, SECRET),
  dqt: seg(0xdb, [0], new Array(64).fill(1)),
  sof: seg(0xc0, [8, 0, 3, 0, 2, 1, 1, 0x11, 0]), // 2×3
  dht: seg(0xc4, [0], new Array(16).fill(0)),
  sos: seg(0xda, [1, 1, 0, 0, 63, 0]),
  // Entropy-coded data with an escaped FF00 and a restart marker, which must not end the scan.
  scan: bytes([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
};
const j = jpegParts;
const SOI = [0xff, 0xd8], EOI = [0xff, 0xd9];
const jpegCore = [j.dqt, j.sof, j.dht, j.sos, j.scan];
const jpegWithMetadata = bytes(SOI, j.jfifThumb, j.jfxx, j.exif, j.xmp, j.icc, j.mpf, j.makerNote, j.iptc, j.adobe, j.app15, j.jpgExtension, j.comment,
  ...jpegCore, j.comment, j.dht, [0xff, 0xff], j.sos, j.scan, EOI, `motion photo video ${SECRET}`);
const jpegExpected = bytes(SOI, j.jfif, j.icc, j.adobe, ...jpegCore, j.dht, j.sos, j.scan, EOI);
const jpegNoTrailer = jpegWithMetadata.subarray(0, jpegWithMetadata.length - `motion photo video ${SECRET}`.length);

// PNG: length, type, data, CRC over type and data.
const chunk = (type, ...data) => { const td = bytes(type, ...data); return bytes(u32be(td.length - 4), td, u32be(crc32(td))); };
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = {
  ihdr: chunk('IHDR', u32be(2), u32be(3), [8, 6, 0, 0, 0]),
  iccp: chunk('iCCP', 'sRGB profile\0\0', deflateSync('synthetic colour profile')),
  gama: chunk('gAMA', u32be(45455)),
  phys: chunk('pHYs', u32be(2835), u32be(2835), [1]),
  trns: chunk('tRNS', [0, 0]),
  text: chunk('tEXt', 'Comment\0', SECRET),
  ztxt: chunk('zTXt', 'Description\0\0', deflateSync(SECRET)),
  itxt: chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0', `<x:xmpmeta>${SECRET}</x:xmpmeta>`),
  exif: chunk('eXIf', 'MM\0*', SECRET),
  time: chunk('tIME', [0x07, 0xea, 10, 4, 12, 0, 0]),
  splt: chunk('sPLT', 'palette\0', [8, 0, 0, 0, 0, 0, 0]),
  private: chunk('prVt', SECRET),
  idat: chunk('IDAT', deflateSync(Buffer.alloc(2 * 3 * 4 + 3))),
  emptyIdat: chunk('IDAT'),
  iend: chunk('IEND'),
};
const pngWithMetadata = bytes(pngSignature, png.ihdr, png.text, png.iccp, png.time, png.gama, png.itxt, png.phys, png.exif, png.splt, png.trns, png.ztxt,
  png.idat, png.private, png.emptyIdat, png.iend, SECRET);
const pngExpected = bytes(pngSignature, png.ihdr, png.iccp, png.gama, png.phys, png.trns, png.idat, png.emptyIdat, png.iend);
const pngNoTrailer = pngWithMetadata.subarray(0, pngWithMetadata.length - SECRET.length);

// WebP: RIFF chunks are a FourCC, a little-endian size, the data and a padding byte when the size is odd.
const wchunk = (type, ...data) => { const d = bytes(...data); return bytes(type, u32le(d.length), d, d.length & 1 ? [0] : []); };
const riff = (...chunks) => { const body = bytes('WEBP', ...chunks); return bytes('RIFF', u32le(body.length), body); };
// VP8L: signature, then 14-bit width-1 and height-1 (2×3), then some opaque image data.
const vp8l = wchunk('VP8L', [0x2f, 0x01, 0x80, 0x00, 0x00], new Array(10).fill(7));
const vp8x = (flags) => wchunk('VP8X', [flags, 0, 0, 0], u24le(1), u24le(2));
const webp = {
  iccp: wchunk('ICCP', 'synthetic colour profile'),
  exif: wchunk('EXIF', 'MM\0*', SECRET),
  xmp: wchunk('XMP ', `<x:xmpmeta>${SECRET}</x:xmpmeta>!`), // odd size, so padded
  unknown: wchunk('ABCD', SECRET),
};
const webpWithMetadata = bytes(riff(vp8x(0x20 | 0x10 | 0x08 | 0x04), webp.iccp, webp.exif, vp8l, webp.xmp, webp.unknown), SECRET);
const webpExpected = riff(vp8x(0x20 | 0x10), webp.iccp, vp8l);
const webpSimpleWithTrailer = bytes(riff(vp8l, webp.exif), SECRET);
const webpSimpleExpected = riff(vp8l);

// GIF: blocks of data sub-blocks (a size byte and that many bytes) ending with a zero size.
const sub = (data) => { const d = Buffer.from(data, 'latin1'); const out = []; for (let k = 0; k < d.length; k += 255) { const part = d.subarray(k, k + 255); out.push([part.length], part); } return bytes(...out, [0]); };
const gif = {
  header: bytes('GIF89a', u16le(2), u16le(3), [0x80, 0, 0], [0, 0, 0, 255, 255, 255]),
  netscape: bytes([0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0]),
  xmp: bytes([0x21, 0xff, 11], 'XMP DataXMP', sub(`<x:xmpmeta>${SECRET.repeat(12)}</x:xmpmeta>`)),
  icc: bytes([0x21, 0xff, 11], 'ICCRGBG1012', sub('synthetic colour profile')),
  comment: bytes([0x21, 0xfe], sub(SECRET)),
  plainText: bytes([0x21, 0x01, 12], new Array(12).fill(0), sub(SECRET)),
  gce: bytes([0x21, 0xf9, 4, 0x04, 10, 0, 0, 0]),
  image: bytes([0x2c, 0, 0, 0, 0, ...u16le(2), ...u16le(3), 0], [2], [3, 0x4c, 0x01, 0x05], [0]),
  localImage: bytes([0x2c, 0, 0, 0, 0, ...u16le(2), ...u16le(3), 0x80], [0, 0, 0, 9, 9, 9], [2], [2, 0x4c, 0x01], [0]),
};
const gifWithMetadata = bytes(gif.header, gif.netscape, gif.xmp, gif.comment, gif.gce, gif.image, gif.icc, gif.plainText, gif.gce, gif.localImage, [0x3b], SECRET);
const gifExpected = bytes(gif.header, gif.netscape, gif.gce, gif.image, gif.gce, gif.localImage, [0x3b]);
const gifNoTrailer = gifWithMetadata.subarray(0, gifWithMetadata.length - SECRET.length);

const FIXTURES = [
  { type: 'image/jpeg', input: jpegWithMetadata, expected: jpegExpected, bare: jpegNoTrailer },
  { type: 'image/png', input: pngWithMetadata, expected: pngExpected, bare: pngNoTrailer },
  { type: 'image/webp', input: webpWithMetadata, expected: webpExpected, bare: webpWithMetadata.subarray(0, webpWithMetadata.length - SECRET.length) },
  { type: 'image/gif', input: gifWithMetadata, expected: gifExpected, bare: gifNoTrailer },
];

// ---- Stripping ----

test('fixtures carry the metadata they are meant to test', () => {
  for (const { input } of FIXTURES) assert.ok(leaks(input));
});

test('JPEG keeps decoding segments, JFIF without its thumbnail, ICC and Adobe, and drops the rest', () => {
  const out = strip(jpegWithMetadata, 'image/jpeg');
  assert.deepEqual(Buffer.from(out), jpegExpected);
  assert.equal(leaks(out), false);
  assert.ok(!text(out).includes('\x09\x09\x09'), 'JFIF thumbnail pixels are gone');
});

test('PNG keeps rendering chunks with valid CRCs and drops text, eXIf, tIME and private chunks', () => {
  const out = strip(pngWithMetadata, 'image/png');
  assert.deepEqual(Buffer.from(out), pngExpected);
  assert.equal(leaks(out), false);
  for (const type of ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'sPLT', 'prVt']) assert.ok(!text(out).includes(type), type);
  let i = 8;
  while (i < out.length) {
    const length = Buffer.from(out).readUInt32BE(i);
    assert.equal(Buffer.from(out).readUInt32BE(i + 8 + length), crc32(out.subarray(i + 4, i + 8 + length)));
    i += 12 + length;
  }
});

test('WebP drops EXIF, XMP and unknown chunks, clears their VP8X flags and rewrites the RIFF size', () => {
  const out = strip(webpWithMetadata, 'image/webp');
  assert.deepEqual(Buffer.from(out), webpExpected);
  assert.equal(Buffer.from(out).readUInt32LE(4), out.length - 8);
  assert.equal(out[20] & 0x0c, 0, 'EXIF and XMP flags cleared');
  assert.equal(out[20] & 0x30, 0x30, 'ICC and alpha flags kept');
  assert.equal(leaks(out), false);
  assert.deepEqual(Buffer.from(strip(webpSimpleWithTrailer, 'image/webp')), webpSimpleExpected);
});

test('GIF keeps frames, timing and looping, and drops comments, plain text, XMP and other application blocks', () => {
  const out = strip(gifWithMetadata, 'image/gif');
  assert.deepEqual(Buffer.from(out), gifExpected);
  assert.equal(leaks(out), false);
  assert.ok(text(out).includes('NETSCAPE2.0'));
  assert.ok(!text(out).includes('ICCRGBG1'));
  const looping = bytes(gif.header, [0x21, 0xff, 11], 'ANIMEXTS1.0', [3, 1, 0, 0, 0], gif.image, [0x3b]);
  assert.deepEqual(Buffer.from(strip(looping, 'image/gif')), looping);
});

test('stripping is idempotent and a clean file passes through unchanged', () => {
  for (const { type, expected } of FIXTURES) {
    assert.deepEqual(Buffer.from(strip(expected, type)), expected, type);
  }
});

test('every truncation of every fixture is refused', () => {
  for (const { type, bare } of FIXTURES) {
    for (let n = 0; n < bare.length; n++) assert.equal(strip(bare.subarray(0, n), type), null, `${type} cut at ${n}`);
  }
});

test('malformed lengths, orders and blocks are refused', () => {
  const cases = {
    'image/jpeg': [
      bytes(SOI, [0xff, 0xe1, 0, 0], ...jpegCore, EOI), // zero length
      bytes(SOI, [0xff, 0xe1, 0, 1], ...jpegCore, EOI), // length shorter than itself
      bytes(SOI, [0xff, 0xe1, 0xff, 0xff], 'short', EOI), // length past the end
      bytes(SOI, j.dqt, j.sos, j.scan, EOI), // scan before any frame
      bytes(SOI, j.dqt, j.sof, EOI), // no scan
      bytes(SOI, SOI, ...jpegCore, EOI), // second SOI
      bytes(SOI, [0xff, 0xd3], ...jpegCore, EOI), // restart outside a scan
      bytes(SOI, 'not a marker', ...jpegCore, EOI),
      bytes(SOI, ...jpegCore, [0xff]), // ends inside the scan
      bytes(SOI, new Array(4096).fill(0xff)), // nothing but fill bytes
    ],
    'image/png': [
      bytes(pngSignature, png.text, png.ihdr, png.idat, png.iend), // IHDR not first
      bytes(pngSignature, png.ihdr, png.ihdr, png.idat, png.iend), // second IHDR
      bytes(pngSignature, chunk('IHDR', u32be(2), u32be(3)), png.idat, png.iend), // short IHDR
      bytes(pngSignature, png.ihdr, png.iend), // no image data
      bytes(pngSignature, png.ihdr, chunk('CgBI', [0]), png.idat, png.iend), // unknown critical chunk
      bytes(pngSignature, png.ihdr, chunk('tE+t', [0]), png.idat, png.iend), // invalid chunk type
      bytes(pngSignature, png.ihdr, u32be(0xffffffff), 'IDAT', png.iend), // huge length
      bytes(pngSignature, png.ihdr, u32be(0x7ffffff0), 'IDAT', png.iend), // length past the end
      bytes(pngSignature, png.ihdr, ...new Array(500).fill(png.emptyIdat)), // no IEND
    ],
    'image/webp': [
      bytes('RIFF', u32le(0xfffffff0), 'WEBP', vp8l), // RIFF size past the end
      riff(webp.exif, vp8l), // first chunk not an image or VP8X
      riff(vp8x(0), webp.iccp), // VP8X without an image
      riff(vp8x(0), vp8l, vp8x(0)), // second VP8X
      riff(wchunk('VP8X', [0, 0, 0, 0]), vp8l), // short VP8X
      riff(vp8x(0), bytes('EXIF', u32le(0xffffffff)), vp8l), // chunk size past the end
      riff(vp8x(0), bytes('XMP ', u32le(3), 'abc')), // missing padding byte at the end
      riff(vp8x(0), ...new Array(500).fill(wchunk('ABCD'))), // zero-sized chunks, no image
    ],
    'image/gif': [
      bytes('GIF89a', u16le(2), u16le(3), [0x87, 0, 0], [0, 0, 0]), // colour table past the end
      bytes(gif.header, [0x3b]), // no image
      bytes(gif.header, gif.comment), // no trailer
      bytes(gif.header, [0x21, 0xfe, 200, 1, 2, 3]), // sub-block past the end
      bytes(gif.header, [0x21, 0xfe], new Array(300).fill(1)), // sub-blocks never terminate
      bytes(gif.header, [0x2c, 0, 0, 0, 0, 2, 0, 3, 0, 0x87], [2, 1, 1, 0], [0x3b]), // local table past the end
      bytes(gif.header, [0x2c, 0, 0, 0, 0, 2, 0, 3, 0, 0], [200, 1, 1, 0], [0x3b]), // impossible code size
      bytes(gif.header, gif.image, [0x00], [0x3b]), // unknown block
      bytes('GIF90a', gif.header.subarray(6), gif.image, [0x3b]), // unknown version
    ],
  };
  for (const [type, inputs] of Object.entries(cases)) {
    inputs.forEach((input, k) => assert.equal(strip(input, type), null, `${type} case ${k}`));
  }
  assert.equal(strip(jpegExpected, 'image/svg+xml'), null);
});

test('random corruption never throws or hangs, and any output is stable', () => {
  let seed = 0x5eed;
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (const { type, input } of FIXTURES) {
    for (let round = 0; round < 3000; round++) {
      const copy = Buffer.from(input);
      for (let k = 1 + Math.floor(random() * 4); k > 0; k--) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      const out = strip(copy, type);
      if (out) assert.deepEqual(Buffer.from(strip(out, type)), Buffer.from(out), `${type} round ${round} is stable`);
    }
  }
});

// ---- Uploads ----

const file = (b, name = 'photo') => new File([b], name);

test('checkUpload stores the stripped file and refuses damaged ones', async () => {
  for (const { type, input, expected } of FIXTURES) {
    const checked = await media.checkUpload(file(input));
    assert.equal(typeof checked, 'object', type);
    assert.equal(checked.type, type);
    assert.deepEqual([checked.width, checked.height], [2, 3]);
    assert.deepEqual(Buffer.from(checked.bytes), expected);
  }
  const damaged = await media.checkUpload(file(jpegNoTrailer.subarray(0, jpegNoTrailer.length - 2)), undefined, 'Banner');
  assert.match(damaged, /^Banner couldn’t be read/);
});

const editor = { user: { id: 'editor', name: 'Fixture Editor' }, staffRole: 'editor' };
function uploadRequest(b, name) {
  const body = new FormData();
  body.set('action', 'upload');
  body.set('file', new File([b], name, { type: 'application/octet-stream' }));
  body.set('alt', 'Two sailboats leave Sandusky Bay at dawn.');
  body.set('credit', 'Photo by Fixture');
  return new Request('http://localhost/api/admin/media', { method: 'POST', headers: { Origin: 'http://localhost' }, body });
}
const mediaRows = () => database.prepare('SELECT id, object_key, bytes FROM media').all();

test('a direct API upload, skipping the browser, is stored without metadata and audited', async () => {
  for (const { type, input, expected } of FIXTURES) {
    const response = await POST({ request: uploadRequest(input, `direct.${type.split('/')[1]}`), locals: editor });
    assert.equal(response.status, 201, type);
    const { item } = await response.json();
    const key = item.url.replace('/media/', '');
    assert.deepEqual(Buffer.from(fake.stored.get(key)), expected);
    assert.equal(database.prepare('SELECT bytes FROM media WHERE id = ?').get(item.id).bytes, expected.length);
    assert.equal(database.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE target_media_id = ? AND action = 'media-upload'").get(item.id).n, 1);
  }
});

test('a direct upload of a damaged file is refused before anything is stored', async () => {
  const before = { files: fake.stored.size, rows: mediaRows().length };
  const response = await POST({ request: uploadRequest(bytes(SOI, j.exif, j.sof, j.dqt), 'cut.jpg'), locals: editor });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /couldn’t be read/);
  assert.deepEqual({ files: fake.stored.size, rows: mediaRows().length }, before);
});

test('a failed database write removes the just-stored file', async () => {
  const before = { files: [...fake.stored.keys()], rows: mediaRows().length };
  fake.failBatches.push('before');
  await assert.rejects(POST({ request: uploadRequest(pngWithMetadata, 'fail.png'), locals: editor }), /D1 unavailable/);
  assert.deepEqual([...fake.stored.keys()], before.files);
  assert.equal(mediaRows().length, before.rows);
});

test('a write that committed but reported failure keeps its file', async () => {
  const before = mediaRows().length;
  fake.failBatches.push('after');
  await assert.rejects(POST({ request: uploadRequest(gifWithMetadata, 'committed.gif'), locals: editor }), /connection lost/);
  const rows = mediaRows();
  assert.equal(rows.length, before + 1);
  for (const row of rows) assert.ok(fake.stored.has(row.object_key), `${row.object_key} still has its file`);
});

test('when the reference check also fails, the file is left alone', async () => {
  const before = fake.stored.size;
  fake.failBatches.push('before', 'before');
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(POST({ request: uploadRequest(pngWithMetadata, 'unknown.png'), locals: editor }), /D1 unavailable/);
  } finally { console.warn = warn; }
  assert.equal(fake.stored.size, before + 1);
});

test('cleanup never deletes a file that a library row, story, event or ad banner refers to', async () => {
  const keep = (key) => { fake.stored.set(key, new Uint8Array([1])); return key; };
  const row = mediaRows()[0];
  const story = { id: 'unsaved-story-ref', object_key: keep('library/story-ref.png') };
  const event = { id: 'unsaved-event-ref', object_key: keep('library/event-ref.png') };
  const banner = { id: 'unsaved-banner-ref', object_key: keep('library/banner-ref.png') };
  database.exec(`INSERT INTO news_articles (id, slug, headline, summary, body, section, community, byline, status, created_at, updated_at)
    VALUES ('story', 'story', 'Story', 'Summary', '![Boats](/media/${story.object_key})', 'local', 'sandusky', 'Fixture', 'draft', 1, 1)`);
  database.exec(`INSERT INTO events (id, slug, title, summary, description, category, starts_on, venue, community, status, created_at, updated_at)
    VALUES ('event', 'event', 'Event', 'Summary', '![Boats](/media/${event.object_key})', 'community', '2026-10-11', 'Library', 'sandusky', 'draft', 1, 1)`);
  database.exec(`INSERT INTO ad_images (ad_id, size, object_key, content_type, width, height, created_at) VALUES ('ad', 'rectangle', '${banner.object_key}', 'image/png', 300, 250, 1)`);
  const unused = { id: 'unsaved-unused', object_key: keep('library/unused.png') };
  await media.discardUnsavedMedia([{ id: row.id, object_key: row.object_key }, story, event, banner, unused]);
  for (const key of [row.object_key, story.object_key, event.object_key, banner.object_key]) assert.ok(fake.stored.has(key), key);
  assert.equal(fake.stored.has(unused.object_key), false);
});

// ---- Ad banners ----

const actor = { id: 'editor', name: 'Fixture Editor' };
const bannerUpload = async () => ({ ...(await media.checkUpload(file(pngWithMetadata))), filename: 'banner.png' });

test('an ad save that fails removes its newly uploaded banners', async () => {
  const before = { files: [...fake.stored.keys()], rows: mediaRows().length };
  const choices = [{ size: 'rectangle', upload: await bannerUpload() }, { size: 'mobile', upload: await bannerUpload() }];
  const { statements, uploads } = await adsAdmin.applyImages({ id: 'ad-new', name: 'Fixture ad' }, { name: 'Fixture Shop' }, choices, [], actor);
  assert.equal(uploads.length, 2);
  assert.equal(fake.stored.size, before.files.length + 2);
  fake.failBatches.push('before');
  await assert.rejects(media.batchWithUploads(uploads, statements), /D1 unavailable/);
  assert.deepEqual([...fake.stored.keys()], before.files);
  assert.equal(mediaRows().length, before.rows);
});

test('a banner upload that fails partway removes the banners already stored', async () => {
  const before = [...fake.stored.keys()];
  const choices = [{ size: 'rectangle', upload: await bannerUpload() }, { size: 'mobile', upload: await bannerUpload() }];
  const put = globalThis.__metadataEnv.MEDIA.put;
  let calls = 0;
  globalThis.__metadataEnv.MEDIA.put = async (key, b) => { if (++calls === 2) throw new Error('R2 unavailable'); return put(key, b); };
  try {
    await assert.rejects(adsAdmin.applyImages({ id: 'ad-new', name: 'Fixture ad' }, { name: 'Fixture Shop' }, choices, [], actor), /R2 unavailable/);
  } finally { globalThis.__metadataEnv.MEDIA.put = put; }
  assert.deepEqual([...fake.stored.keys()], before);
});

test('a successful ad save keeps its banners, stripped, and audits them', async () => {
  const choices = [{ size: 'rectangle', upload: await bannerUpload() }];
  const { statements, uploads } = await adsAdmin.applyImages({ id: 'ad-ok', name: 'Fixture ad' }, { name: 'Fixture Shop' }, choices, [], actor);
  await media.batchWithUploads(uploads, statements);
  const [record] = uploads;
  assert.deepEqual(Buffer.from(fake.stored.get(record.object_key)), pngExpected);
  assert.equal(database.prepare("SELECT media_id FROM ad_images WHERE ad_id = 'ad-ok'").get().media_id, record.id);
  assert.equal(database.prepare("SELECT count(*) AS n FROM admin_audit_log WHERE target_media_id = ? AND action = 'media-upload'").get(record.id).n, 1);
});
