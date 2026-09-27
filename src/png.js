// PNG без библиотек: размер из заголовка, чтение (8 бит на канал, палитра 1–8 бит) и запись RGBA.
// Нужен каталогу (проверка размеров листов), заглушкам и импорту графики.
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Размер PNG — из заголовка, картинку целиком разбирать не нужно.
export function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!head.subarray(0, 8).equals(SIGNATURE) || head.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${file.split(/[\\/]/).pop()} — не PNG-файл`);
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// pixels — RGBA, width × height × 4 байт.
export function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  // Каждая строка начинается с байта фильтра 0 (без фильтра).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Чтение PNG → { width, height, pixels: RGBA Uint8Array }. Поддержка: серый, RGB, палитра, серый+альфа, RGBA;
// 8 бит на канал (палитра и серый — 1, 2, 4, 8 бит). 16 бит и чересстрочный PNG — ошибка с понятным текстом.
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('не PNG-файл (JPEG і іншыя фарматы трэба перазахаваць як PNG)');
  let pos = 8;
  let ihdr;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG без загалоўка IHDR');
  const { width, height, depth, colorType, interlace } = ihdr;
  if (interlace) throw new Error('чераслаковы (interlaced) PNG не падтрымліваецца — перазахавайце без яго');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`невядомы тып колеру PNG ${colorType}`);
  if (depth === 16) throw new Error('16 біт на канал не падтрымліваецца — перазахавайце як 8 біт');
  if (depth !== 8 && !(colorType === 0 || colorType === 3)) throw new Error(`глыбіня ${depth} біт не падтрымліваецца`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`невядомы фільтр радка PNG ${filter}`);
      out[x] = v & 255;
    }
    prev = out;
  }
  const pixels = new Uint8Array(width * height * 4);
  const sample = (row, i) => {
    // i-й образец строки при depth < 8
    const bit = i * depth;
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = depth === 8 ? row[x] : sample(row, x);
        pixels[o] = palette[idx * 3];
        pixels[o + 1] = palette[idx * 3 + 1];
        pixels[o + 2] = palette[idx * 3 + 2];
        pixels[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0) {
        const g = depth === 8 ? row[x] : Math.round((sample(row, x) * 255) / ((1 << depth) - 1));
        pixels.set([g, g, g, 255], o);
      } else if (colorType === 4) {
        pixels.set([row[x * 2], row[x * 2], row[x * 2], row[x * 2 + 1]], o);
      } else if (colorType === 2) {
        pixels.set([row[x * 3], row[x * 3 + 1], row[x * 3 + 2], 255], o);
      } else {
        pixels.set(row.subarray(x * 4, x * 4 + 4), o);
      }
    }
  }
  return { width, height, pixels };
}
