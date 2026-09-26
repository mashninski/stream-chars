// Рисует 6 персонажей-заглушек: characters/<імя>/sheet.png + character.json.
// Запуск: npm run stubs. Перезаписывает только папки этих шести персонажей;
// своя графика в других папках не трогается.
//
// Только встроенные модули Node: PNG собирается вручную (node:zlib сжимает данные).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = 32; // размер кадра

// Анимации: строка в листе = порядок в этом списке. Кадры — позы (см. drawFigure).
// bob — сдвиг верхней половины (голова, шапка, туловище, руки) вниз, dx — всей фигуры вбок.
const ANIMS = [
  ['idle', 2, [{}, { bob: 1 }]],
  ['walk', 8, [
    { legs: 'stepA', arms: 'swingA' },
    { legs: 'pass', bob: -1 },
    { legs: 'stepB', arms: 'swingB' },
    { legs: 'pass', bob: -1 },
  ]],
  ['jump', 8, [{ legs: 'squat', bob: 2, arms: 'out' }, { legs: 'tuck', bob: -1, arms: 'up' }]],
  ['fall', 8, [{ legs: 'stepA', arms: 'up' }, { legs: 'stepB', arms: 'up' }]],
  ['land', 10, [{ legs: 'squat', bob: 2, arms: 'out' }, { bob: 1 }]],
  ['shake', 16, [{ dx: -1, arms: 'out' }, { dx: 1 }, { dx: -1, arms: 'out' }, { dx: 1 }]],
  ['parachute', 3, [
    { canopy: true, legs: 'dangleA', arms: 'up' },
    { canopy: true, legs: 'dangleB', arms: 'up' },
  ]],
];

// canopy — цвет купола парашюта (полосы с белым).
// Прямоугольник [x0, y0, x1, y1, цвет], границы включительно. Кадры смотрят вправо.
const CHARACTERS = {
  кухар: {
    canopy: '#d63a3a', body: '#eeeeee', arm: '#d6d6d6', pants: '#3d3d3d', skin: '#8d5524',
    extra: [[15, 22, 15, 22, '#9a9a9a'], [15, 25, 15, 25, '#9a9a9a']],
    hat: [[11, 6, 20, 9, '#fafafa'], [12, 10, 19, 12, '#fafafa'], [12, 13, 19, 13, '#cfcfcf']],
  },
  рыцар: {
    canopy: '#7d8793', body: '#7d8793', arm: '#646d78', pants: '#4a4f57', skin: '#f2c29b',
    extra: [[12, 27, 19, 27, '#4a4f57']],
    hat: [[13, 8, 13, 9, '#d33b3b'], [14, 7, 16, 10, '#d33b3b'], [11, 11, 20, 15, '#aab2bb'], [17, 14, 20, 14, '#5b626b']],
  },
  маг: {
    canopy: '#7b4fd0', body: '#7b4fd0', arm: '#6340b0', pants: '#3a2a5a', skin: '#f2c29b',
    extra: [[12, 27, 19, 27, '#ffd83d']],
    hat: [
      [10, 13, 21, 13, '#55309a'], [12, 12, 19, 12, '#6a3fb5'], [13, 10, 18, 11, '#6a3fb5'],
      [14, 9, 17, 9, '#6a3fb5'], [15, 8, 16, 8, '#6a3fb5'], [17, 7, 18, 7, '#6a3fb5'], [15, 11, 15, 11, '#ffd83d'],
    ],
  },
  пастух: {
    canopy: '#3f8f3a', body: '#3f8f3a', arm: '#2f7030', pants: '#5a4630', skin: '#e0ac69',
    extra: [[12, 27, 19, 27, '#3b2410']],
    hat: [[12, 10, 19, 11, '#7a4a22'], [12, 12, 19, 12, '#3b2410'], [8, 13, 23, 13, '#7a4a22']],
  },
  турыст: {
    canopy: '#f39c26', body: '#f39c26', arm: '#d9821a', pants: '#2e4a7a', skin: '#c68642',
    extra: [[16, 21, 16, 27, '#b86a10']],
    hat: [[15, 9, 16, 10, '#ffffff'], [12, 11, 19, 12, '#d63a3a'], [12, 13, 19, 13, '#ffffff']],
  },
  марак: {
    canopy: '#1f3c88', body: '#f5f5f5', arm: '#f5f5f5', pants: '#1f3c88', skin: '#f1c27d',
    extra: [[12, 22, 19, 22, '#1f3c88'], [12, 24, 19, 24, '#1f3c88'], [12, 26, 19, 26, '#1f3c88']],
    hat: [[11, 11, 20, 12, '#ffffff'], [11, 13, 20, 13, '#1f3c88'], [20, 13, 22, 13, '#1b1b1b']],
  },
};

const OUTLINE = '#1b1b1b';
const EYE = '#1b1b1b';
const SHOE = '#2b2b2b';
const STRING = '#9a9a9a';

// ---------- кадр как массив пикселей RGBA ----------

function rgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function makeFrame() {
  return new Uint8Array(F * F * 4);
}

function setPx(frame, x, y, hex) {
  if (x < 0 || y < 0 || x >= F || y >= F) return;
  frame.set(rgba(hex), (y * F + x) * 4);
}

function rect(frame, x0, y0, x1, y1, hex, dx = 0, dy = 0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(frame, x + dx, y + dy, hex);
}

function line(frame, x0, y0, x1, y1, hex) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(frame, x0, y0, hex);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function opaque(frame, x, y) {
  return x >= 0 && y >= 0 && x < F && y < F && frame[(y * F + x) * 4 + 3] > 0;
}

// Тёмная обводка по контуру: фигурка читается на любом фоне стрима.
function outline(frame) {
  const add = [];
  for (let y = 0; y < F; y++) {
    for (let x = 0; x < F; x++) {
      if (opaque(frame, x, y)) continue;
      if (opaque(frame, x - 1, y) || opaque(frame, x + 1, y) || opaque(frame, x, y - 1) || opaque(frame, x, y + 1)) add.push([x, y]);
    }
  }
  for (const [x, y] of add) setPx(frame, x, y, OUTLINE);
}

// ---------- фигурка ----------

// Ноги: [x дальней, x ближней, верхняя строка, нижняя строка]. Дальняя темнее — видно, какая впереди.
const LEGS = {
  stand: [13, 17, 26, 31],
  stepA: [12, 18, 26, 31],
  stepB: [18, 12, 26, 31],
  pass: [14, 16, 26, 31],
  squat: [11, 19, 27, 31],
  tuck: [13, 17, 24, 29],
  dangleA: [12, 17, 26, 31],
  dangleB: [14, 18, 26, 31],
};

function shade(hex, k) {
  const [r, g, b] = rgba(hex);
  const c = (v) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function drawLeg(frame, x, top, bottom, color, dx) {
  rect(frame, x, top, x + 1, bottom - 1, color, dx);
  rect(frame, x, bottom, x + 2, bottom, SHOE, dx); // ботинок носком вперёд (вправо)
}

function drawArms(frame, c, kind, dx, bob) {
  const r = (x0, y0, x1, y1, hex) => rect(frame, x0, y0, x1, y1, hex, dx, bob);
  if (kind === 'up') {
    r(10, 16, 11, 21, c.arm); r(10, 15, 11, 15, c.skin);
    r(20, 16, 21, 21, c.arm); r(20, 15, 21, 15, c.skin);
  } else if (kind === 'out') {
    r(8, 22, 11, 23, c.arm); r(7, 22, 7, 23, c.skin);
    r(20, 22, 23, 23, c.arm); r(24, 22, 24, 23, c.skin);
  } else {
    // down / swingA / swingB: рука, которая «впереди» шага, чуть выше.
    const back = kind === 'swingB' ? -1 : 0;
    const front = kind === 'swingA' ? -1 : 0;
    r(10, 21 + back, 11, 25 + back, c.arm); r(10, 26 + back, 11, 26 + back, c.skin);
    r(20, 21 + front, 21, 25 + front, c.arm); r(20, 26 + front, 21, 26 + front, c.skin);
  }
}

function drawCanopy(frame, c) {
  const rows = [[10, 21], [7, 24], [5, 26], [4, 27], [3, 28], [3, 28]];
  rows.forEach(([x0, x1], i) => {
    for (let x = x0; x <= x1; x++) setPx(frame, x, i + 1, Math.floor((x - 3) / 4) % 2 ? '#ffffff' : c.canopy);
  });
}

function drawFigure(c, pose) {
  const frame = makeFrame();
  const dx = pose.dx ?? 0;
  const bob = pose.bob ?? 0;
  const [farX, nearX, legTop, legBottom] = LEGS[pose.legs ?? 'stand'];

  if (pose.canopy) drawCanopy(frame, c);

  drawLeg(frame, farX, legTop, legBottom, shade(c.pants, 0.7), dx);
  drawLeg(frame, nearX, legTop, legBottom, c.pants, dx);

  // Туловище и голова.
  rect(frame, 12, 21, 19, 27, c.body, dx, bob);
  for (const [x0, y0, x1, y1, hex] of c.extra) rect(frame, x0, y0, x1, y1, hex, dx, bob);
  rect(frame, 12, 14, 19, 20, c.skin, dx, bob);
  drawArms(frame, c, pose.arms ?? 'down', dx, bob);
  for (const [x0, y0, x1, y1, hex] of c.hat) rect(frame, x0, y0, x1, y1, hex, dx, bob);
  // Глаза — со стороны взгляда (вправо).
  setPx(frame, 16 + dx, 16 + bob, EYE);
  setPx(frame, 18 + dx, 16 + bob, EYE);

  outline(frame);

  // Стропы парашюта — после обводки, чтобы остались тонкими.
  if (pose.canopy) {
    line(frame, 4, 7, 10 + dx, 14 + bob, STRING);
    line(frame, 27, 7, 21 + dx, 14 + bob, STRING);
  }
  return frame;
}

// ---------- PNG ----------

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

function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  // Каждая строка начинается с байта фильтра 0 (без фильтра).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- лист ----------

// Одноразовые анимации: проигрываются один раз и держат последний кадр.
const ONCE = new Set(['jump', 'land', 'shake']);

const cols = Math.max(...ANIMS.map(([, , frames]) => frames.length));
const sheetW = cols * F;
const sheetH = ANIMS.length * F;

for (const [name, c] of Object.entries(CHARACTERS)) {
  const sheet = new Uint8Array(sheetW * sheetH * 4);
  const animations = {};
  ANIMS.forEach(([anim, fps, poses], row) => {
    animations[anim] = { row, frames: poses.length, fps };
    if (ONCE.has(anim)) animations[anim].loop = false;
    poses.forEach((pose, col) => {
      const frame = drawFigure(c, pose);
      for (let y = 0; y < F; y++) {
        sheet.set(frame.subarray(y * F * 4, (y + 1) * F * 4), ((row * F + y) * sheetW + col * F) * 4);
      }
    });
  });

  const dir = path.join(root, 'characters', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sheet.png'), encodePng(sheetW, sheetH, sheet));
  const json = { frameWidth: F, frameHeight: F, animations };
  fs.writeFileSync(path.join(dir, 'character.json'), JSON.stringify(json, null, 2) + '\n');
  console.log(`Намаляваны ${name}`);
}
