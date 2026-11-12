// A small PNG reader and writer for the island's height map: 8-bit RGB only.
// Node only (it uses zlib); the app reads the same file through the browser.
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};

/** rgb: width * height * 3 bytes, top row first. Returns the PNG file's bytes. */
export function encodePng(rgb, width, height) {
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Each row is stored as its difference from the row above (filter "Up"), which packs smooth ground well.
    raw[y * (stride + 1)] = y ? 2 : 0;
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = (rgb[y * stride + i] - (y ? rgb[(y - 1) * stride + i] : 0)) & 255;
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The bytes of an 8-bit RGB PNG → { width, height, rgb }. */
export function decodePng(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let at = 8, width = 0, height = 0;
  const data = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at), type = file.toString('latin1', at + 4, at + 8), body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 2 || body[12] !== 0) throw new Error('only 8-bit RGB, not interlaced');
    } else if (type === 'IDAT') data.push(body);
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data)), stride = width * 3, rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? rgb[row + i - 3] : 0, b = y ? rgb[row - stride + i] : 0, c = y && i >= 3 ? rgb[row - stride + i - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      rgb[row + i] = (raw[y * (stride + 1) + 1 + i] + predict) & 255;
    }
  }
  return { width, height, rgb };
}
