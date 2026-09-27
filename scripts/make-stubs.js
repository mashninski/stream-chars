// Рисует заглушки героев в heroes/: общее тело (body.json), 6 классов × 2 пола (слои тело, куртка-маска,
// украшения), головные уборы, ступени крыльев, реквизит и существа для сцен.
// Запуск: npm run stubs. Перезаписывает только файлы заглушек (список — ниже); своя графика в других
// папках не трогается.
//
// Только встроенные модули Node: PNG собирается вручную (src/png.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/png.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --out <папка> — писать не в heroes/, а в другую папку (проверить результат, не трогая свои файлы).
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'heroes');
const F = 32; // размер кадра тела, в котором рисуются заглушки
// Заглушки рисуются в сетке 32 и пишутся увеличенными ×UP: своя графика — кадр 96×96, показ ×1
// (`claude/heroes-plan.md`, «Паспорт стиля»). Размеры кадров и точки привязки в описаниях — тоже ×UP.
const UP = 3;

// ---------- холст кадра ----------

function rgba(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const a = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

class Frame {
  constructor(w = F, h = F) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }
  set(x, y, hex) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(rgba(hex), (y * this.w + x) * 4);
  }
  get(x, y) {
    return this.px.subarray((y * this.w + x) * 4, (y * this.w + x) * 4 + 4);
  }
  opaque(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.px[(y * this.w + x) * 4 + 3] > 0;
  }
  rect(x0, y0, x1, y1, hex, dx = 0, dy = 0) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x + dx, y + dy, hex);
  }
  rects(list, dx = 0, dy = 0) {
    for (const [x0, y0, x1, y1, hex] of list) this.rect(x0, y0, x1, y1, hex, dx, dy);
  }
  line(x0, y0, x1, y1, hex) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, hex);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  circle(cx, cy, r, hex) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.8) this.set(cx + x, cy + y, hex);
  }
  // Тёмная обводка по контуру union (рамка из нескольких слоёв) — пишется в этот кадр.
  outlineFrom(union, hex = '#1b1b1b') {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (union.opaque(x, y)) continue;
        if (union.opaque(x - 1, y) || union.opaque(x + 1, y) || union.opaque(x, y - 1) || union.opaque(x, y + 1)) this.set(x, y, hex);
      }
    }
  }
  outline(hex) {
    this.outlineFrom(this.copy(), hex);
    return this;
  }
  copy() {
    const f = new Frame(this.w, this.h);
    f.px.set(this.px);
    return f;
  }
  // Поверх: непрозрачные пиксели other.
  over(other) {
    for (let i = 0; i < this.px.length; i += 4) if (other.px[i + 3]) this.px.set(other.px.subarray(i, i + 4), i);
    return this;
  }
  // Поворот на 90° по часовой k раз (квадратный кадр).
  rotate(k) {
    let f = this;
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) {
      const r = new Frame(f.h, f.w);
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) r.px.set(f.get(x, y), (x * r.w + (f.h - 1 - y)) * 4);
      f = r;
    }
    return f;
  }
  shift(dx, dy) {
    const f = new Frame(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (this.opaque(x, y)) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.w && ny < this.h) f.px.set(this.get(x, y), (ny * f.w + nx) * 4);
      }
    return f;
  }
  mirror() {
    const f = new Frame(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) f.px.set(this.get(x, y), (y * f.w + (this.w - 1 - x)) * 4);
    return f;
  }
  bottom() {
    for (let y = this.h - 1; y >= 0; y--) for (let x = 0; x < this.w; x++) if (this.opaque(x, y)) return y;
    return -1;
  }
}

// Лист: строки анимаций, кадры слева направо; каждый пиксель заглушки — квадрат UP×UP.
function sheetPng(rows, fw, fh) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const w = cols * fw * UP, h = Math.max(1, rows.length) * fh * UP;
  const px = new Uint8Array(w * h * 4);
  rows.forEach((frames, row) =>
    frames.forEach((fr, col) => {
      for (let y = 0; y < fh * UP; y++) {
        for (let x = 0; x < fw * UP; x++) {
          const s = (Math.floor(y / UP) * fw + Math.floor(x / UP)) * 4;
          px.set(fr.px.subarray(s, s + 4), ((row * fh * UP + y) * w + col * fw * UP + x) * 4);
        }
      }
    }),
  );
  return encodePng(w, h, px);
}

const written = [];
function writeFile(rel, data) {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  written.push(rel);
}
// Описание из сетки заглушек — в сетку листа: кадры и точки привязки ×UP (поворот точки не меняется).
const upPt = (p) => p.map((v, i) => (i < 2 ? v * UP : v));
function upJson(v, key) {
  if (Array.isArray(v)) return key === 'anchor' ? upPt(v) : v.map((x) => upJson(x, key));
  if (v && typeof v === 'object') {
    if (key === 'anchors') return Object.fromEntries(Object.entries(v).map(([n, p]) => [n, Array.isArray(p) ? upPt(p) : upJson(p, 'anchors')]));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, upJson(x, k)]));
  }
  return key === 'frameWidth' || key === 'frameHeight' ? v * UP : v;
}
const writeJson = (rel, obj) => writeFile(rel, JSON.stringify(upJson(obj), null, 2) + '\n');

// ---------- тело: позы ----------

// Серые маски куртки: тень, основа, блик. Программа красит основу в цвет героя (color.js → MASK_BASE = 178).
const J_SHADOW = '#828282';
const J_BASE = '#b2b2b2';
const J_LIGHT = '#d7d7d7';
const SHOE = '#2b2b2b';
const EYE = '#1b1b1b';
const MOUTH = '#6a2a2a';

// Ноги: [x дальней, x ближней, верх, низ] или особые позы.
const LEGS = {
  stand: [13, 17, 26, 31],
  stepA: [12, 18, 26, 31],
  stepB: [18, 12, 26, 31],
  pass: [14, 16, 26, 31],
  runA: [11, 19, 26, 30],
  runB: [19, 11, 26, 31],
  runC: [13, 17, 25, 30],
  squat: [11, 19, 27, 31],
  tuck: [13, 17, 24, 29],
  dangleA: [12, 17, 26, 31],
  dangleB: [14, 18, 26, 31],
};

function drawLegs(f, pants, kind, dx) {
  const far = shade(pants, 0.7);
  if (kind === 'kneel') {
    // Дальняя нога — колено на земле, ближняя — согнута вперёд.
    f.rect(12, 28, 13, 30, far, dx); f.rect(12, 31, 15, 31, far, dx);
    f.rect(16, 27, 20, 28, pants, dx); f.rect(19, 29, 20, 30, pants, dx); f.rect(19, 31, 21, 31, SHOE, dx);
    return;
  }
  if (kind === 'sit') {
    f.rect(12, 29, 20, 30, far, dx); f.rect(13, 30, 21, 31, pants, dx); f.rect(22, 29, 22, 31, SHOE, dx);
    return;
  }
  if (kind === 'lift') {
    f.rect(13, 26, 14, 30, far, dx); f.rect(13, 31, 15, 31, SHOE, dx);
    f.rect(17, 25, 18, 27, pants, dx); f.rect(17, 28, 19, 28, SHOE, dx);
    return;
  }
  const [farX, nearX, top, bottom] = LEGS[kind];
  f.rect(farX, top, farX + 1, bottom - 1, far, dx); f.rect(farX, bottom, farX + 2, bottom, SHOE, dx);
  f.rect(nearX, top, nearX + 1, bottom - 1, pants, dx); f.rect(nearX, bottom, nearX + 2, bottom, SHOE, dx);
}

function shade(hex, k) {
  const [r, g, b] = rgba(hex);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Руки: у каждой стороны (front — ближняя, правая при взгляде вправо; back — дальняя) — рукав (куртка)
// и кисть (кожа), и где кисть — точка привязки руки. Координаты — до сдвига dx/bob.
const ARMS = {
  front: {
    down: { sleeve: [[20, 21, 21, 25]], hand: [20, 26, 21, 26] },
    swingA: { sleeve: [[20, 20, 21, 24]], hand: [20, 25, 21, 25] },
    swingB: { sleeve: [[20, 21, 21, 25]], hand: [20, 26, 21, 26] },
    up: { sleeve: [[20, 16, 21, 21]], hand: [20, 15, 21, 15] },
    out: { sleeve: [[20, 22, 23, 23]], hand: [24, 22, 24, 23] },
    forward: { sleeve: [[20, 21, 24, 22]], hand: [25, 21, 25, 22] },
    chin: { sleeve: [[20, 19, 21, 23]], hand: [19, 18, 20, 18] },
    mouth: { sleeve: [[20, 18, 21, 22]], hand: [20, 17, 21, 17] },
    face: { sleeve: [[20, 18, 21, 22]], hand: [18, 16, 19, 16] },
    hips: { sleeve: [[20, 21, 21, 23]], hand: [19, 24, 20, 25] },
    punch: { sleeve: [[20, 22, 25, 23]], hand: [26, 22, 27, 23] },
    waveA: { sleeve: [[21, 15, 22, 21]], hand: [22, 13, 23, 14] },
    waveB: { sleeve: [[20, 15, 21, 21]], hand: [19, 13, 20, 14] },
    low: { sleeve: [[20, 23, 24, 24]], hand: [25, 24, 25, 25] },
  },
  back: {
    down: { sleeve: [[10, 21, 11, 25]], hand: [10, 26, 11, 26] },
    swingA: { sleeve: [[10, 21, 11, 25]], hand: [10, 26, 11, 26] },
    swingB: { sleeve: [[10, 20, 11, 24]], hand: [10, 25, 11, 25] },
    up: { sleeve: [[10, 16, 11, 21]], hand: [10, 15, 11, 15] },
    out: { sleeve: [[8, 22, 11, 23]], hand: [7, 22, 7, 23] },
    forward: { sleeve: [[18, 23, 23, 24]], hand: [24, 23, 24, 24] },
    face: { sleeve: [[10, 18, 11, 22]], hand: [12, 16, 13, 16] },
    hips: { sleeve: [[10, 21, 11, 23]], hand: [11, 24, 12, 25] },
    punch: { sleeve: [[18, 23, 23, 24]], hand: [24, 23, 25, 24] },
    mouth: { sleeve: [[18, 20, 21, 21]], hand: [21, 18, 22, 19] },
    low: { sleeve: [[18, 24, 23, 25]], hand: [24, 25, 24, 26] },
  },
};

// Позы анимаций. legs, front/back (руки), bob (верх тела вниз), dx (вся фигура), eyes, mouth, rot (поворот
// на 90° × k по часовой — лёжа, сальто), canopy (купол парашюта).
const P = (o) => o;
const COMMON_ANIMS = [
  // обязательные
  ['idle', 2, [P({}), P({ bob: 1 })]],
  ['walk', 8, [P({ legs: 'stepA', front: 'swingA', back: 'swingA' }), P({ legs: 'pass', bob: -1 }), P({ legs: 'stepB', front: 'swingB', back: 'swingB' }), P({ legs: 'pass', bob: -1 })]],
  ['run', 12, [P({ legs: 'runA', front: 'forward', back: 'out', dx: 1 }), P({ legs: 'runC', bob: -1, dx: 1 }), P({ legs: 'runB', front: 'out', back: 'forward', dx: 1 }), P({ legs: 'runC', bob: -1, dx: 1 })]],
  ['jump', 8, [P({ legs: 'squat', bob: 2, front: 'out', back: 'out' }), P({ legs: 'tuck', bob: -1, front: 'up', back: 'up' })], false],
  ['fall', 8, [P({ legs: 'stepA', front: 'up', back: 'up', mouth: 'open' }), P({ legs: 'stepB', front: 'up', back: 'up', mouth: 'open' })]],
  ['land', 10, [P({ legs: 'squat', bob: 2, front: 'out', back: 'out' }), P({ bob: 1 })], false],
  ['shake', 16, [P({ dx: -1, front: 'out', back: 'out' }), P({ dx: 1 }), P({ dx: -1, front: 'out', back: 'out' }), P({ dx: 1 })], false],
  ['parachute', 3, [P({ canopy: true, legs: 'dangleA', front: 'up', back: 'up' }), P({ canopy: true, legs: 'dangleB', front: 'up', back: 'up' })]],
  ['think', 2, [P({ front: 'chin', eyes: 'up' }), P({ front: 'chin', eyes: 'up', bob: 1 })]],
  ['joy', 6, [P({ legs: 'tuck', bob: -2, front: 'up', back: 'up', mouth: 'smile', eyes: 'happy' }), P({ front: 'up', back: 'up', mouth: 'smile', eyes: 'happy' })]],
  ['panic', 12, [P({ legs: 'runA', front: 'up', back: 'up', mouth: 'open', eyes: 'wide', dx: 1 }), P({ legs: 'runC', bob: -1, front: 'up', back: 'up', mouth: 'open', eyes: 'wide', dx: 1 }), P({ legs: 'runB', front: 'up', back: 'up', mouth: 'open', eyes: 'wide', dx: 1 }), P({ legs: 'runC', bob: -1, front: 'up', back: 'up', mouth: 'open', eyes: 'wide', dx: 1 })]],
  ['angry', 6, [P({ front: 'hips', back: 'hips', eyes: 'angry', mouth: 'open' }), P({ legs: 'lift', front: 'hips', back: 'hips', eyes: 'angry' })]],
  ['drunk', 3, [P({ dx: -1, front: 'out', back: 'down', eyes: 'closed', blush: true }), P({ bob: 1, eyes: 'closed', blush: true }), P({ dx: 1, front: 'down', back: 'out', eyes: 'closed', blush: true }), P({ bob: 1, eyes: 'closed', blush: true })]],
  ['sleep', 1, [P({ rot: 1, eyes: 'closed' }), P({ rot: 1, eyes: 'closed', bob: 1 })]],
  ['rub_eyes', 6, [P({ front: 'face', back: 'face', eyes: 'closed' }), P({ front: 'face', back: 'face', eyes: 'closed', bob: 1 })]],
  ['knocked', 6, [P({ rot: 3, front: 'up', back: 'up', eyes: 'wide', mouth: 'open', legs: 'stepA' }), P({ rot: 3, front: 'out', back: 'out', eyes: 'wide', mouth: 'open', legs: 'stepB' })]],
  ['get_up', 4, [P({ rot: 1, eyes: 'closed' }), P({ legs: 'squat', bob: 3, front: 'out', back: 'out' }), P({})], false],
  ['pat_pockets', 6, [P({ front: 'hips', back: 'hips', eyes: 'wide', dx: -1 }), P({ front: 'hips', back: 'hips', eyes: 'wide', dx: 1, bob: 1 })]],
  ['drink', 3, [P({ front: 'mouth', eyes: 'closed' }), P({ front: 'mouth', eyes: 'closed', bob: 1 })]],
  ['fight', 8, [P({ legs: 'stepA', front: 'punch', eyes: 'angry' }), P({ legs: 'stepA', front: 'hips', back: 'punch', eyes: 'angry' }), P({ legs: 'stepB', front: 'punch', eyes: 'angry', dx: 1 }), P({ legs: 'stepB', back: 'out', front: 'hips', eyes: 'angry' })]],
  // общие действия (не обязательные: у своей графики может не быть — запасная idle)
  ['wave', 4, [P({ front: 'waveA', mouth: 'smile' }), P({ front: 'waveB', mouth: 'smile' })]],
  ['dance', 6, [P({ legs: 'stepA', front: 'up', back: 'out', mouth: 'smile' }), P({ legs: 'tuck', bob: -1, front: 'out', back: 'up', mouth: 'smile' }), P({ legs: 'stepB', front: 'up', back: 'out', mouth: 'smile', dx: 1 }), P({ legs: 'squat', bob: 2, front: 'out', back: 'out', mouth: 'smile' })]],
  ['sit', 1, [P({ legs: 'sit', bob: 3, front: 'low', eyes: 'closed' })]],
];
const REQUIRED = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'shake', 'parachute', 'think', 'joy', 'panic', 'angry', 'drunk', 'sleep', 'rub_eyes', 'knocked', 'get_up', 'pat_pockets', 'drink', 'fight'];

// Анимации классов — строки после общих, в листах своего класса.
const CLASS_ANIMS = {
  warrior: [
    ['shout', 6, [P({ front: 'out', back: 'out', mouth: 'open', eyes: 'angry' }), P({ front: 'forward', back: 'out', mouth: 'open', eyes: 'angry', bob: 1 })]],
    ['stomp', 6, [P({ legs: 'lift', front: 'up', eyes: 'angry' }), P({ legs: 'squat', bob: 2, front: 'up', eyes: 'angry' })]],
    ['sword_up', 4, [P({ front: 'up', mouth: 'open' }), P({ front: 'up', bob: 1, mouth: 'open' })]],
  ],
  mage: [
    ['cast', 6, [P({ front: 'up', back: 'out', mouth: 'open' }), P({ front: 'out', back: 'up', mouth: 'open' }), P({ front: 'up', back: 'up', mouth: 'open', bob: -1 }), P({ front: 'forward', back: 'out', mouth: 'open' })]],
    ['snap', 6, [P({ front: 'forward' }), P({ front: 'up', eyes: 'happy', mouth: 'smile' })]],
  ],
  ranger: [
    ['sneak', 8, [P({ legs: 'squat', bob: 2, front: 'forward', back: 'out' }), P({ legs: 'stepA', bob: 3, front: 'forward' }), P({ legs: 'squat', bob: 2, front: 'forward', back: 'out' }), P({ legs: 'stepB', bob: 3, front: 'forward' })]],
    ['search', 2, [P({ legs: 'squat', bob: 3, front: 'low', eyes: 'wide' }), P({ legs: 'squat', bob: 3, front: 'forward', eyes: 'wide' })]],
  ],
  rogue: [
    ['kneel', 2, [P({ legs: 'kneel', bob: 3, front: 'low', eyes: 'angry' }), P({ legs: 'kneel', bob: 4, front: 'low', eyes: 'angry' })]],
    ['steal', 6, [P({ legs: 'stepA', front: 'low', bob: 1 }), P({ legs: 'stepA', front: 'hips', bob: 1, mouth: 'smile' })]],
    ['flip', 12, [P({ legs: 'tuck', front: 'up', back: 'up' }), P({ legs: 'tuck', rot: 1, front: 'up', back: 'up' }), P({ legs: 'tuck', rot: 2, front: 'up', back: 'up' }), P({ legs: 'tuck', rot: 3, front: 'up', back: 'up' })]],
  ],
  shepherd: [
    ['flute', 4, [P({ front: 'mouth', back: 'mouth', eyes: 'closed' }), P({ front: 'mouth', back: 'mouth', eyes: 'closed', bob: 1 })]],
    ['read', 2, [P({ front: 'forward', back: 'forward', eyes: 'wide' }), P({ front: 'forward', back: 'forward', eyes: 'wide', bob: 1 })]],
  ],
  innkeeper: [
    ['hug', 4, [P({ front: 'out', back: 'out', mouth: 'smile' }), P({ front: 'forward', back: 'out', mouth: 'smile' })]],
    ['push', 8, [P({ legs: 'runA', front: 'forward', back: 'forward', bob: 1 }), P({ legs: 'runC', front: 'forward', back: 'forward', bob: 2 }), P({ legs: 'runB', front: 'forward', back: 'forward', bob: 1 }), P({ legs: 'runC', front: 'forward', back: 'forward', bob: 2 })]],
    ['slap', 8, [P({ front: 'up', eyes: 'angry' }), P({ front: 'punch', eyes: 'angry', mouth: 'open' })]],
  ],
};

// ---------- классы: голова, причёска, украшения ----------

// hair/decor — прямоугольники [x0, y0, x1, y1, цвет] в позе «стоит»; с позой сдвигаются на dx и bob.
// skirt — у женской версии куртка ниже и шире (другой силуэт).
const CLASSES = {
  warrior: {
    title: 'Ваяр', skin: '#f2c29b', pants: '#4a4f57',
    m: { hair: [[12, 13, 19, 14, '#6b4423'], [12, 15, 12, 16, '#6b4423'], [15, 20, 19, 20, '#8a6a4a']] },
    f: { hair: [[12, 12, 19, 14, '#8b4a1c'], [11, 13, 11, 18, '#8b4a1c'], [10, 15, 10, 20, '#8b4a1c']], skirt: true },
    decor: [[18, 20, 22, 21, '#aab2bb'], [19, 22, 21, 22, '#5b626b'], [12, 26, 19, 26, '#5a3a1a'], [15, 26, 16, 26, '#e0c040']],
  },
  mage: {
    title: 'Маг', skin: '#f2c29b', pants: '#3a2a5a',
    m: { hair: [[12, 13, 19, 14, '#d8d8e0'], [12, 15, 13, 17, '#d8d8e0']], beard: [[15, 19, 19, 20, '#eeeef2'], [15, 21, 18, 23, '#eeeef2'], [16, 24, 17, 24, '#eeeef2']] },
    f: { hair: [[12, 12, 19, 14, '#c0c8e8'], [11, 13, 12, 22, '#c0c8e8']], skirt: true },
    decor: [[12, 25, 19, 25, '#3a1a6a'], [16, 22, 16, 22, '#ffd83d'], [15, 23, 17, 23, '#ffd83d'], [16, 24, 16, 24, '#ffd83d']],
  },
  ranger: {
    title: 'Рэйнджэр', skin: '#e0ac69', pants: '#3f5a2a',
    m: { hair: [[12, 13, 19, 14, '#b5561c'], [12, 15, 12, 17, '#b5561c'], [16, 20, 19, 20, '#b5561c']] },
    f: { hair: [[12, 12, 19, 14, '#c8641e'], [11, 14, 11, 17, '#c8641e'], [10, 18, 11, 25, '#c8641e'], [10, 26, 11, 26, '#2f7030']], skirt: true },
    decor: [[8, 18, 10, 26, '#7a4a22'], [8, 16, 8, 17, '#e0e0e0'], [10, 16, 10, 17, '#d63a3a'], [13, 21, 19, 21, '#2f7030']],
  },
  rogue: {
    title: 'Злодзей', skin: '#d9a066', pants: '#2a2a33',
    m: { hair: [[12, 13, 19, 14, '#1f1f24'], [12, 15, 12, 18, '#1f1f24']] },
    f: { hair: [[12, 12, 19, 14, '#26262e'], [11, 13, 12, 20, '#26262e'], [19, 15, 19, 15, '#26262e']], skirt: true },
    decor: [[13, 16, 19, 16, '#2b1b3b'], [12, 26, 19, 26, '#2b1b1b'], [18, 25, 18, 28, '#c0c6cc'], [18, 24, 18, 24, '#5a3a1a']],
    eyeHoles: true,
  },
  shepherd: {
    title: 'Пастух', skin: '#e0ac69', pants: '#5a4630',
    m: { hair: [[12, 13, 19, 13, '#e8c860'], [12, 12, 12, 12, '#e8c860'], [14, 12, 14, 12, '#e8c860'], [16, 12, 16, 12, '#e8c860'], [18, 12, 18, 12, '#e8c860'], [12, 14, 13, 15, '#e8c860']] },
    f: { hair: [[12, 12, 19, 14, '#d63a3a'], [11, 14, 12, 18, '#d63a3a'], [10, 17, 11, 19, '#d63a3a'], [18, 15, 19, 15, '#e8c860']], skirt: true },
    decor: [[17, 22, 17, 22, '#b08a4a'], [16, 23, 16, 23, '#b08a4a'], [15, 24, 15, 24, '#b08a4a'], [18, 24, 21, 27, '#c8a060'], [19, 25, 20, 25, '#9a7a40']],
  },
  innkeeper: {
    title: 'Карчмар', skin: '#f1c27d', pants: '#4a3a2a',
    m: { hair: [[12, 16, 12, 17, '#5a3a1a'], [16, 19, 19, 19, '#5a3a1a'], [15, 19, 15, 20, '#5a3a1a']] },
    f: { hair: [[12, 13, 19, 14, '#6b3a1a'], [14, 10, 17, 12, '#6b3a1a'], [11, 14, 12, 17, '#6b3a1a']], skirt: true },
    decor: [[14, 23, 19, 28, '#f4f4f0'], [14, 22, 14, 22, '#f4f4f0'], [19, 22, 19, 22, '#f4f4f0'], [10, 20, 11, 23, '#d8d0c0'], [16, 25, 17, 25, '#c8c0b0']],
  },
};

// Одна поза → три слоя (тело, куртка, украшения) и точки привязки.
function drawPose(cls, sex, pose) {
  const c = CLASSES[cls];
  const s = c[sex];
  const dx = pose.dx ?? 0;
  const bob = pose.bob ?? 0;
  const body = new Frame(), jacket = new Frame(), decor = new Frame();

  // Купол парашюта — в слое тела (полосы с белым).
  if (pose.canopy) {
    [[10, 21], [7, 24], [5, 26], [4, 27], [3, 28], [3, 28]].forEach(([x0, x1], i) => {
      for (let x = x0; x <= x1; x++) body.set(x, i + 1, Math.floor((x - 3) / 4) % 2 ? '#ffffff' : '#d63a3a');
    });
  }
  drawLegs(body, c.pants, pose.legs ?? 'stand', dx);

  // Туловище (куртка): основа, слева тень, справа блик, внизу тень. У женской — длиннее и шире книзу.
  const J = (x0, y0, x1, y1, hex) => jacket.rect(x0, y0, x1, y1, hex, dx, bob);
  J(12, 21, 19, 27, J_BASE);
  J(12, 21, 12, 27, J_SHADOW);
  J(19, 21, 19, 25, J_LIGHT);
  if (s.skirt && !['kneel', 'sit'].includes(pose.legs)) {
    J(11, 27, 20, 28, J_BASE);
    J(11, 28, 20, 28, J_SHADOW);
  } else {
    J(12, 27, 19, 27, J_SHADOW);
  }
  // Руки: рукава — в куртке, кисти — в теле.
  const hands = {};
  for (const side of ['back', 'front']) {
    const a = ARMS[side][pose[side] ?? 'down'] ?? ARMS[side].down;
    for (const [x0, y0, x1, y1] of a.sleeve) J(x0, y0, x1, y1, side === 'back' ? J_SHADOW : J_BASE);
    const [hx0, hy0, hx1, hy1] = a.hand;
    body.rect(hx0, hy0, hx1, hy1, c.skin, dx, bob);
    hands[side] = [(hx0 + hx1) / 2 + dx, (hy0 + hy1) / 2 + bob];
  }
  // Голова, причёска, лицо.
  body.rect(12, 14, 19, 20, c.skin, dx, bob);
  body.rects(s.hair, dx, bob);
  const eyes = pose.eyes ?? 'open';
  const E = (x, y, hex = EYE) => body.set(x + dx, y + bob, hex);
  if (eyes === 'closed' || eyes === 'happy') { E(16, 17); E(17, 17); E(18, 17); if (eyes === 'happy') { E(16, 16); E(18, 16); } }
  else if (eyes === 'up') { E(16, 15); E(18, 15); }
  else if (eyes === 'wide') { E(16, 16); E(16, 17); E(18, 16); E(18, 17); }
  else if (eyes === 'angry') { E(16, 16); E(18, 16); E(15, 15); E(19, 15); }
  else { E(16, 16); E(18, 16); }
  if (pose.mouth === 'open') { E(17, 19, MOUTH); E(18, 19, MOUTH); E(17, 18, MOUTH); }
  if (pose.mouth === 'smile') { E(16, 18, MOUTH); E(17, 19, MOUTH); E(18, 19, MOUTH); E(19, 18, MOUTH); }
  if (pose.blush) { E(15, 18, '#e86a6a'); E(19, 18, '#e86a6a'); }
  // Украшения класса (и борода — поверх куртки).
  if (s.beard) decor.rects(s.beard, dx, bob);
  decor.rects(c.decor, dx, bob);
  if (c.eyeHoles) {
    // Маска злодзея: глаза видны сквозь неё.
    for (const [x, y] of [[16, 16], [18, 16], [16, 17], [18, 17], [16, 15], [18, 15]]) {
      if (body.opaque(x + dx, y + bob) && rgba('#1b1b1b').every((v, i) => body.get(x + dx, y + bob)[i] === v)) decor.set(x + dx, y + bob, EYE);
    }
  }

  // Обводка по всем трём слоям — в слой тела (под остальными).
  const union = body.copy().over(jacket).over(decor);
  body.outlineFrom(union);

  let anchors = {
    head: [16 + dx, 13 + bob],
    back: [12 + dx, 22 + bob],
    handR: hands.front,
    handL: hands.back,
  };
  let layers = { body, jacket, decor };

  // Поворот (лёжа, сальто): слои и точки поворачиваются вместе, потом фигура ставится на землю.
  const k = pose.rot ?? 0;
  if (k) {
    const rot = (p) => { let [x, y] = p; for (let i = 0; i < k; i++) [x, y] = [F - 1 - y, x]; return [x, y]; };
    layers = Object.fromEntries(Object.entries(layers).map(([n, fr]) => [n, fr.rotate(k)]));
    const u = layers.body.copy().over(layers.jacket).over(layers.decor);
    const shiftY = F - 1 - u.bottom();
    layers = Object.fromEntries(Object.entries(layers).map(([n, fr]) => [n, fr.shift(0, shiftY)]));
    anchors = Object.fromEntries(Object.entries(anchors).map(([n, p]) => { const [x, y] = rot(p); return [n, [x, y + shiftY]]; }));
    anchors.head.push(k * 90);
  }
  if (pose.canopy) {
    layers.body.line(4, 7, 10 + dx, 14 + bob, '#9a9a9a');
    layers.body.line(27, 7, 21 + dx, 14 + bob, '#9a9a9a');
  }
  return { layers, anchors };
}

// ---------- тело и классы: листы ----------

function animEntry(row, fps, poses, loop) {
  const e = { row, frames: poses.length, fps };
  if (loop === false) e.loop = false;
  return e;
}

function roundPt(p) {
  return p.map((v, i) => (i < 2 ? Math.round(v) : v));
}

// body.json — общая сетка и точки привязки (по кадрам) — считается по первому классу:
// позы у всех одинаковые, различаются только головы и украшения.
const bodyJson = {
  frameWidth: F,
  frameHeight: F,
  required: REQUIRED,
  // Нет анимации у класса — запасная, потом idle.
  fallbacks: { run: 'walk', panic: 'run', knocked: 'fall', get_up: 'land', pat_pockets: 'angry', drink: 'idle', fight: 'angry', dance: 'joy', wave: 'joy', sit: 'idle' },
  animations: {},
};
COMMON_ANIMS.forEach(([name, fps, poses, loop], row) => {
  const e = animEntry(row, fps, poses, loop);
  e.anchors = poses.map((pose) => {
    const { anchors } = drawPose('warrior', 'm', pose);
    return Object.fromEntries(Object.entries(anchors).map(([n, p]) => [n, roundPt(p)]));
  });
  bodyJson.animations[name] = e;
});
// Точки по умолчанию — «стоит», первый кадр: для анимаций без своих точек.
bodyJson.anchors = bodyJson.animations.idle.anchors[0];
writeJson('body.json', bodyJson);

for (const [cls, c] of Object.entries(CLASSES)) {
  const extra = CLASS_ANIMS[cls] ?? [];
  const info = { title: c.title, weight: 1, layers: {}, animations: {} };
  extra.forEach(([name, fps, poses, loop], i) => {
    const e = animEntry(COMMON_ANIMS.length + i, fps, poses, loop);
    e.anchors = poses.map((pose) => Object.fromEntries(Object.entries(drawPose(cls, 'm', pose).anchors).map(([n, p]) => [n, roundPt(p)])));
    info.animations[name] = e;
  });
  const all = [...COMMON_ANIMS, ...extra];
  for (const sex of ['m', 'f']) {
    const rows = { body: [], jacket: [], decor: [] };
    for (const [, , poses] of all) {
      const frames = poses.map((pose) => drawPose(cls, sex, pose).layers);
      for (const layer of Object.keys(rows)) rows[layer].push(frames.map((f) => f[layer]));
    }
    info.layers[sex] = {};
    for (const layer of Object.keys(rows)) {
      writeFile(`classes/${cls}/${sex}-${layer}.png`, sheetPng(rows[layer], F, F));
      info.layers[sex][layer] = `${sex}-${layer}.png`;
    }
  }
  writeJson(`classes/${cls}/info.json`, info);
}

// ---------- предметы: уборы, крылья, реквизит, существа ----------

// Один предмет: кадры (Frame[] по строкам), описание. anchor — точка предмета, которая совмещается
// с точкой привязки героя (убор — голова, крылья — спина, предмет в руке — кисть).
function item(category, id, info, rows) {
  const fw = rows[0][0].w, fh = rows[0][0].h;
  writeFile(`${category}/${id}/sheet.png`, sheetPng(rows, fw, fh));
  writeJson(`${category}/${id}/info.json`, { ...info, image: 'sheet.png', frameWidth: fw, frameHeight: fh });
}

function one(w, h, draw, outline = true) {
  const f = new Frame(w, h);
  draw(f);
  return outline ? f.outline('#1b1b1b') : f;
}

// Уборы: низ убора (anchor) садится на макушку.
const HATS = {
  straw: ['Саламяны капялюш', 1, (f) => { f.rect(1, 6, 16, 6, '#e8c860'); f.rect(4, 2, 13, 5, '#e8c860'); f.rect(4, 5, 13, 5, '#b5561c'); f.rect(0, 7, 17, 7, '#d0a840'); }, [18, 9, [9, 7]]],
  crown: ['Карона', 1, (f) => { f.rect(2, 4, 11, 7, '#ffd83d'); f.set(2, 2, '#ffd83d'); f.rect(2, 3, 2, 3, '#ffd83d'); f.rect(6, 1, 7, 3, '#ffd83d'); f.rect(11, 2, 11, 3, '#ffd83d'); f.set(4, 5, '#d63a3a'); f.set(9, 5, '#3a7ad6'); f.rect(2, 7, 11, 7, '#c8a020'); }, [14, 9, [7, 7]]],
  ushanka: ['Вушанка', 1, (f) => { f.rect(2, 1, 13, 5, '#7a5a3a'); f.rect(1, 5, 14, 6, '#c8b090'); f.rect(0, 6, 2, 11, '#c8b090'); f.rect(13, 6, 15, 11, '#c8b090'); }, [16, 12, [8, 6]]],
  wreath: ['Вянок', 1, (f) => { f.rect(1, 3, 12, 4, '#3f8f3a'); f.set(2, 2, '#ff6ab0'); f.set(5, 2, '#ffd83d'); f.set(8, 2, '#6ab0ff'); f.set(11, 2, '#ff6ab0'); f.set(3, 5, '#3f8f3a'); f.set(10, 5, '#3f8f3a'); }, [14, 7, [6, 4]]],
  tophat: ['Капялюш-цыліндр', 1, (f) => { f.rect(3, 0, 10, 8, '#222228'); f.rect(3, 6, 10, 6, '#b03030'); f.rect(0, 9, 13, 9, '#222228'); }, [14, 11, [7, 9]]],
  horns: ['Шлем з рагамі', 1, (f) => { f.rect(3, 4, 12, 8, '#9aa2ab'); f.rect(3, 8, 12, 8, '#6a727b'); f.rect(0, 2, 1, 5, '#f0e8d0'); f.rect(1, 5, 2, 6, '#f0e8d0'); f.rect(14, 2, 15, 5, '#f0e8d0'); f.rect(13, 5, 14, 6, '#f0e8d0'); f.set(7, 3, '#9aa2ab'); f.set(8, 3, '#9aa2ab'); }, [16, 10, [7, 8]]],
};
for (const [id, [title, weight, draw, [w, h, anchor]]] of Object.entries(HATS)) {
  item('hats', id, { title, weight, anchor }, [[one(w, h, draw)]]);
}

// Крылья: большие, раскрыты влево и вправо от спины (вид как спереди), размах — примерно два героя.
// Два кадра взмаха: поднятые и опущенные. anchor — середина между крыльями у спины.
const WINGS = {
  'wings-1': ['Пёркі', '#f4f4f4', '#c8c8d0', 14],
  'wings-2': ['Крылы', '#8ec8ff', '#4a8ad6', 17],
  'wings-3': ['Залатыя крылы', '#ffe070', '#d09a20', 20],
};
for (const [id, [title, light, dark, span]] of Object.entries(WINGS)) {
  const gap = 4; // между крыльями — место для тела
  const w = span * 2 + gap + 2, h = Math.round(span * 1.2) + 4;
  const cx = Math.floor(w / 2);
  const shoulder = h - 2 - Math.round(span * 0.15); // где крыло крепится к спине
  const frames = [0, 1].map((flap) =>
    one(w, h, (f) => {
      const lift = flap ? 0.7 : 1; // опущенные — положе
      for (let u = 0; u < span; u++) {
        const k = (u + 1) / span; // 0 у спины … 1 на конце
        // Крыло — полоса вверх и в сторону: верх поднимается к острому концу,
        // низ (маховые перья) — тоже, но круче; у спины крыло толще.
        const top = shoulder - Math.round(span * lift * (0.25 + 0.75 * Math.pow(k, 0.6)));
        const tip = k > 0.9 ? Math.round((k - 0.9) * 10 * 2) : 0; // конец сужается
        const scallop = u % 3 === 2 ? 2 : u % 3 === 1 ? 1 : 0; // зубцы перьев
        const bottom = shoulder + Math.round(span * 0.15) - Math.round(span * lift * 0.85 * Math.pow(k, 1.4)) - scallop - tip;
        for (const side of [-1, 1]) {
          const x = cx + side * (Math.floor(gap / 2) + u) + (side < 0 ? -1 : 0);
          const band = bottom - top;
          for (let y = Math.max(1, top); y <= bottom; y++) {
            // Верхние 40% — кроющие перья (светлые, верхний край — блик), ниже — маховые со стыками.
            const cover = y < top + Math.max(2, Math.round(band * 0.4));
            const seam = !cover && u % 3 === 0 && y > top + 1;
            f.set(x, y, seam ? dark : y === top ? '#ffffff' : light);
          }
        }
      }
    }),
  );
  // Точка спины у тела — за серединой, ближе к затылку: сдвиг, чтобы крылья стояли над плечами по центру.
  item('wings', id, { title, anchor: [cx - 3, shoulder + 4], animations: { idle: { row: 0, frames: 2, fps: 3 } } }, [frames]);
}

// Реквизит. anchor — где его держит рука (или низ-середина, если стоит на земле).
const PROPS = {
  sword: ['Меч', [5, 15, [2, 13]], (f) => { f.rect(2, 0, 2, 10, '#e0e6ee'); f.rect(1, 1, 1, 10, '#aab2bb'); f.rect(0, 11, 4, 11, '#c8a020'); f.rect(2, 12, 2, 14, '#6a4a2a'); }],
  shield: ['Шчыт', [10, 12, [5, 6]], (f) => { f.rect(1, 0, 8, 8, '#8a5a2a'); f.rect(2, 9, 7, 9, '#8a5a2a'); f.rect(3, 10, 6, 10, '#8a5a2a'); f.rect(4, 11, 5, 11, '#8a5a2a'); f.rect(4, 1, 5, 9, '#c8a020'); f.rect(1, 4, 8, 4, '#c8a020'); }],
  bottle: ['Бутэлька віна', [4, 9, [2, 6]], (f) => { f.rect(1, 0, 2, 2, '#3f8f3a'); f.rect(0, 3, 3, 8, '#2f6f2a'); f.rect(1, 5, 2, 6, '#e8e0c0'); }],
  keg: ['Бочачка віна', [9, 8, [4, 4]], (f) => { f.rect(0, 1, 8, 6, '#8a5a2a'); f.rect(0, 2, 8, 2, '#4a4a4a'); f.rect(0, 5, 8, 5, '#4a4a4a'); f.rect(8, 3, 8, 4, '#c8a020'); }],
  magnifier: ['Вялікая лупа', [14, 14, [2, 12]], (f) => { f.circle(9, 4, 4, '#6a4a2a'); f.circle(9, 4, 3, '#bfe8ff'); f.line(6, 7, 1, 13, '#6a4a2a'); f.line(5, 7, 1, 12, '#6a4a2a'); }],
  flute: ['Дудка', [10, 3, [2, 1]], (f) => { f.rect(0, 0, 9, 1, '#c89a5a'); f.set(4, 0, '#4a2a1a'); f.set(6, 0, '#4a2a1a'); f.set(8, 0, '#4a2a1a'); }],
  docs: ['Пакет дакументаў', [8, 6, [4, 3]], (f) => { f.rect(0, 0, 7, 5, '#e8d8a0'); f.line(0, 0, 3, 3, '#b0a070'); f.line(7, 0, 4, 3, '#b0a070'); f.set(3, 4, '#c03030'); f.set(4, 4, '#c03030'); }],
  purse: ['Кашалёк', [6, 6, [3, 3]], (f) => { f.rect(0, 2, 5, 5, '#8a5a2a'); f.rect(2, 0, 3, 1, '#c8a020'); f.set(2, 3, '#ffd83d'); }],
  mug: ['Кубак', [5, 6, [2, 3]], (f) => { f.rect(0, 1, 3, 5, '#c8a060'); f.rect(0, 0, 3, 0, '#fff8e0'); f.rect(4, 2, 4, 4, '#c8a060'); }],
  spear: ['Кап\'ё', [5, 22, [2, 16]], (f) => { f.rect(2, 3, 2, 21, '#6a4a2a'); f.rect(1, 1, 3, 3, '#aab2bb'); f.set(2, 0, '#aab2bb'); }],
};
for (const [id, [title, [w, h, anchor], draw]] of Object.entries(PROPS)) item('props', id, { title, anchor }, [[one(w, h, draw)]]);

// Огненный шар — два кадра мерцания.
item('props', 'fireball', { title: 'Агністы шар', anchor: [5, 5], animations: { idle: { row: 0, frames: 2, fps: 10 } } }, [[0, 1].map((k) => one(11, 11, (f) => { f.circle(5, 5, 5 - k, '#ff7a1a'); f.circle(5 + k, 5, 3, '#ffd83d'); f.circle(6, 5 - k, 1, '#ffffff'); }))]);

// Бочка катится: четыре кадра с поворотом обручей. Стоит на земле: anchor — низ-середина.
item('props', 'barrel', { title: 'Бочка', anchor: [7, 15], animations: { idle: { row: 0, frames: 1, fps: 1 }, roll: { row: 0, frames: 4, fps: 10 } } }, [[0, 1, 2, 3].map((k) => one(16, 16, (f) => {
  f.circle(7, 8, 7, '#8a5a2a');
  const a = (k * Math.PI) / 4;
  for (let t = -6; t <= 6; t++) f.set(7 + Math.round(Math.cos(a) * t), 8 + Math.round(Math.sin(a) * t), '#4a4a4a');
  const b = a + Math.PI / 2;
  for (let t = -6; t <= 6; t++) f.set(7 + Math.round(Math.cos(b) * t), 8 + Math.round(Math.sin(b) * t), '#5a3a1a');
}))]);

// Существа: стоят на земле (низ кадра), смотрят вправо. group — для выбора по весам (питомцы).
function creature(id, info, w, h, anims) {
  const rows = [];
  const animations = {};
  anims.forEach(([name, fps, poses, loop], row) => {
    animations[name] = animEntry(row, fps, poses, loop);
    rows.push(poses.map((draw) => one(w, h, draw)));
  });
  item('creatures', id, { ...info, animations }, rows);
}

function sheepFrame(f, { bob = 0, leg = 0, spy = false, look = 0 }) {
  const wool = spy ? '#1e1e24' : '#f4f4f0';
  const y = 4 + bob;
  f.rect(3, y + 2, 14, y + 8, wool);
  f.rect(4, y + 1, 13, y + 1, wool);
  if (spy) { f.rect(8, y + 3, 9, y + 7, '#ffffff'); f.set(8, y + 4, '#c03030'); }
  // голова
  f.rect(14, y, 18, y + 4, spy ? '#3a3a40' : '#3a3a40');
  f.set(16 + look, y + 1, '#ffffff');
  if (spy) f.rect(15, y + 1, 18, y + 1, '#000000');
  // ноги
  const ly = y + 9;
  f.rect(4 + leg, ly, 4 + leg, 15, '#3a3a40');
  f.rect(7 - leg, ly, 7 - leg, 15, '#3a3a40');
  f.rect(11 + leg, ly, 11 + leg, 15, '#3a3a40');
  f.rect(13 - leg, ly, 13 - leg, 15, '#3a3a40');
}
const sheepAnims = (spy) => [
  ['idle', 2, [(f) => sheepFrame(f, { spy }), (f) => sheepFrame(f, { spy, bob: 1 })]],
  ['walk', 8, [(f) => sheepFrame(f, { spy, leg: 1 }), (f) => sheepFrame(f, { spy }), (f) => sheepFrame(f, { spy, leg: -1 }), (f) => sheepFrame(f, { spy })]],
  ['jump', 6, [(f) => sheepFrame(f, { spy, bob: -3, leg: 1 }), (f) => sheepFrame(f, { spy, bob: 1 })]],
  ['look', 2, [(f) => sheepFrame(f, { spy, look: -1 }), (f) => sheepFrame(f, { spy, look: 1 })]],
];
creature('sheep', { title: 'Авечка' }, 20, 16, sheepAnims(false));
creature('spy-sheep', { title: 'Авечка-шпіён' }, 20, 16, sheepAnims(true));

// Человечек-существо (стражник, тень) — на позах тела героя.
function humanoid(id, title, colors, extra) {
  const drawH = (pose) => (f) => {
    // Своя окраска: тело, куртка и украшения сразу цветами существа.
    const { layers } = drawPose('warrior', 'm', pose);
    const tint = (fr, hex) => { for (let i = 0; i < fr.px.length; i += 4) if (fr.px[i + 3]) { const g = fr.px[i] / 178; const [r, gg, b] = rgba(hex); fr.px.set([Math.min(255, r * g), Math.min(255, gg * g), Math.min(255, b * g), 255], i); } };
    tint(layers.jacket, colors.jacket);
    if (colors.whole) for (const fr of Object.values(layers)) tint(fr, colors.whole);
    f.over(layers.body).over(layers.jacket);
    if (!colors.whole) f.over(layers.decor);
    extra?.(f, pose);
  };
  const anims = [
    ['idle', 2, [drawH({}), drawH({ bob: 1 })]],
    ['walk', 8, [drawH({ legs: 'stepA', front: 'swingA' }), drawH({ legs: 'pass', bob: -1 }), drawH({ legs: 'stepB', front: 'swingB' }), drawH({ legs: 'pass', bob: -1 })]],
    ['run', 12, [drawH({ legs: 'runA', front: 'forward', dx: 1 }), drawH({ legs: 'runC', bob: -1, dx: 1 }), drawH({ legs: 'runB', back: 'forward', dx: 1 }), drawH({ legs: 'runC', bob: -1, dx: 1 })]],
    ['attack', 8, [drawH({ legs: 'stepA', front: 'up' }), drawH({ legs: 'stepA', front: 'punch' })]],
    ['grab', 4, [drawH({ front: 'forward', back: 'forward' }), drawH({ front: 'forward', back: 'forward', bob: 1 })]],
    ['hit', 8, [drawH({ rot: 3, legs: 'stepA', front: 'up' }), drawH({ rot: 3, legs: 'stepB', front: 'out' })], false],
  ];
  const rows = anims.map(([, , poses]) => poses.map((d) => { const f = new Frame(); d(f); return f; }));
  const animations = {};
  anims.forEach(([name, fps, poses, loop], row) => (animations[name] = animEntry(row, fps, poses, loop)));
  item('creatures', id, { title, animations }, rows);
}
humanoid('guard', 'Стражнік', { jacket: '#c03030' }, (f, pose) => {
  // шлем
  const bob = pose.bob ?? 0, dx = pose.dx ?? 0;
  if (pose.rot) return;
  f.rect(11 + dx, 11 + bob, 20 + dx, 14 + bob, '#9aa2ab');
  f.rect(15 + dx, 9 + bob, 16 + dx, 10 + bob, '#c03030');
});
humanoid('shadow', 'Цень', { jacket: '#2a1a3a', whole: '#3a2a4a' }, (f, pose) => {
  if (pose.rot) return;
  const bob = pose.bob ?? 0, dx = pose.dx ?? 0;
  f.set(16 + dx, 16 + bob, '#ff3030');
  f.set(18 + dx, 16 + bob, '#ff3030');
});

// Питомцы рэйнджэра: 5 зверей, группа pet — выбираются по весам.
function beast(f, { body, dark, w, h, ears, tail, bob = 0, leg = 0 }) {
  const top = h - 7 + bob;
  f.rect(2, top + 1, w - 6, top + 4, body);
  f.rect(w - 6, top - 1, w - 2, top + 3, body);
  f.set(w - 3, top, '#1b1b1b');
  if (ears) f.rects(ears.map(([x0, y0, x1, y1]) => [x0, y0 + bob, x1, y1 + bob, dark]));
  if (tail) f.rects(tail.map(([x0, y0, x1, y1]) => [x0, y0 + bob, x1, y1 + bob, dark]));
  f.rect(3 + leg, top + 5, 3 + leg, h - 1, dark);
  f.rect(w - 7 - leg, top + 5, w - 7 - leg, h - 1, dark);
}
const PETS = {
  cat: ['Кот', { body: '#e89a3a', dark: '#b06a1a', w: 16, h: 12, ears: [[12, 3, 12, 4], [14, 3, 14, 4]], tail: [[0, 3, 1, 6]] }],
  dog: ['Сабака', { body: '#c8a070', dark: '#6a4a2a', w: 18, h: 13, ears: [[12, 4, 13, 7]], tail: [[0, 4, 1, 5]] }],
  fox: ['Ліс', { body: '#e8601a', dark: '#f4f4f0', w: 18, h: 12, ears: [[13, 3, 13, 4], [16, 3, 16, 4]], tail: [[0, 5, 3, 7]] }],
  hedgehog: ['Вожык', { body: '#7a6a5a', dark: '#3a2a1a', w: 13, h: 9, ears: [[2, 2, 7, 3], [1, 3, 1, 4]], tail: null }],
  owl: ['Сава', { body: '#a08060', dark: '#5a4030', w: 12, h: 14, ears: [[7, 3, 7, 4], [10, 3, 10, 4]], tail: [[1, 6, 2, 9]] }],
};
for (const [id, [title, look]] of Object.entries(PETS)) {
  creature(id, { title, group: 'pet', weight: 1 }, look.w, look.h, [
    ['idle', 2, [(f) => beast(f, look), (f) => beast(f, { ...look, bob: 1 })]],
    ['walk', 8, [(f) => beast(f, { ...look, leg: 1 }), (f) => beast(f, look), (f) => beast(f, { ...look, leg: -1 }), (f) => beast(f, look)]],
    ['happy', 6, [(f) => beast(f, { ...look, bob: -2 }), (f) => beast(f, look)]],
  ]);
}

console.log(`Намаляваны заглушкі ў heroes/: ${written.length} файлаў.`);
