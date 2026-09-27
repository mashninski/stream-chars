// Сборка листов класса из импортированных поз (scripts/import-art.js) по рецепту.
//
//   node scripts/build-class.js heroes/classes/g1-proba
//
// Рецепт — <папка класса>/recipe.json:
//   {
//     "title": "…", "weight": 0,
//     "variants": {
//       "f": {
//         "poses": ["poses/f-list1", "poses/f-razvertka"],      // префиксы импорта (…-body.png, …-jacket.png, …-import.json)
//         "animations": {
//           "idle": { "fps": 2, "frames": [{ "pose": "idle" }, { "pose": "idle", "breathe": 1 }] },
//           "walk": { "fps": 8, "frames": [{ "pose": "walk_1" }, …] }
//         }
//       }
//     }
//   }
// Кадр: pose — имя позы; dx, dy — сдвиг (пиксели кадра, вниз — плюс); breathe — верх тела ниже на N
// пикселей (ноги на месте, «вдох» простоя); flip — отражение по горизонтали; head — голова из другой позы
// (у анимации — на все её кадры: повязка и лицо не мигают). loop: false у анимации — один раз.
// Пишет <вариант>-body.png, <вариант>-jacket.png (строка на анимацию) и info.json (с "bodyAnimations": false,
// точки привязки — по кадрам, считаются сами: макушка, спина, кисти от куртки). Только встроенные модули Node.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../src/png.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = path.resolve(process.argv[2] ?? '');
const recipe = JSON.parse(fs.readFileSync(path.join(dir, 'recipe.json'), 'utf8'));

// Позы варианта: имя → { body, jacket } (RGBA кадра fw×fh).
function loadPoses(prefixes) {
  const poses = {};
  let fw, fh;
  for (const pre of prefixes) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${pre}-import.json`), 'utf8'));
    if (fw && (meta.frameWidth !== fw || meta.frameHeight !== fh)) throw new Error(`${pre}: кадр ${meta.frameWidth}×${meta.frameHeight}, а ў іншых — ${fw}×${fh}`);
    fw = meta.frameWidth;
    fh = meta.frameHeight;
    const body = decodePng(fs.readFileSync(path.join(dir, `${pre}-body.png`)));
    const jacketFile = path.join(dir, `${pre}-jacket.png`);
    const jacket = fs.existsSync(jacketFile) ? decodePng(fs.readFileSync(jacketFile)) : null;
    for (const [name, a] of Object.entries(meta.animations)) {
      const cut = (img) => (img ? img.pixels.slice(a.row * fh * fw * 4, (a.row + 1) * fh * fw * 4) : new Uint8Array(fw * fh * 4));
      poses[name] = { body: cut(body), jacket: cut(jacket) };
    }
  }
  return { poses, fw, fh };
}

// Кадр по описанию: сдвиг, «вдох», отражение — одинаково для тела и куртки.
function makeFrame(src, op, fw, fh) {
  const out = new Uint8Array(fw * fh * 4);
  const dx = op.dx ?? 0, dy = op.dy ?? 0, breathe = op.breathe ?? 0;
  // Шов «вдоха» — чуть выше середины куртки (пояс): выше него всё опускается на breathe пикселей.
  const seam = op.seam ?? Math.round(fh * 0.62);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let sx = op.flip ? fw - 1 - (x - dx) : x - dx;
      let sy = y - dy;
      if (breathe && sy <= seam) sy -= breathe;
      if (sx < 0 || sy < 0 || sx >= fw || sy >= fh) continue;
      out.set(src.subarray((sy * fw + sx) * 4, (sy * fw + sx) * 4 + 4), (y * fw + x) * 4);
    }
  }
  return out;
}

// Ворот — верхняя строка куртки, где она уже заметно широкая (четверть ширины самой широкой строки):
// одиночные серые пиксели выше (тень на повязке, волосы) воротом не считаются.
function collarRow(jacket, fw, fh) {
  const widths = [];
  for (let y = 0; y < fh; y++) { let w = 0; for (let x = 0; x < fw; x++) if (jacket[(y * fw + x) * 4 + 3]) w++; widths.push(w); }
  const max = Math.max(...widths);
  return max ? widths.findIndex((w) => w >= max / 4) : fh;
}

// Ровный красный: мелкий узор красной детали (тканый пояс) в каждой позе нарисован заново и в ходьбе мигает.
// Все красные пиксели ниже ворота (лицо с румянцем не трогается) — в один цвет варианта ("flatRed": "#rrggbb").
function flattenRed(pose, hex, fw, fh) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const jy0 = collarRow(pose.jacket, fw, fh);
  const body = pose.body.slice();
  for (let i = jy0 * fw * 4; i < body.length; i += 4) {
    const [r, g, b, a] = body.subarray(i, i + 4);
    if (a && r > 50 && r > 1.8 * g && r > 1.8 * b) body.set(rgb, i);
  }
  return { body, jacket: pose.jacket };
}

// Голова из другой позы: Gemini рисует мелочь головы (повязка, глаза) в каждой клетке чуть по-разному,
// и в ходьбе она мигает. Голова — от макушки до ворота (верх куртки), по ширине — около середины куртки
// (посох сбоку не задевается); ставится по макушке и середине куртки своей позы.
function headBox(pose, fw, fh) {
  const op = (img, x, y) => img[(y * fw + x) * 4 + 3] > 0;
  let sx = 0, n = 0;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (op(pose.jacket, x, y)) { sx += x; n++; }
  if (!n) return null;
  const jy0 = collarRow(pose.jacket, fw, fh);
  const cx = Math.round(sx / n);
  let top = -1;
  for (let y = 0; y < jy0 && top < 0; y++) for (let x = cx - 8; x <= cx + 8; x++) if (x >= 0 && x < fw && op(pose.body, x, y)) { top = y; break; }
  if (top < 0) return null;
  const r = Math.round((jy0 - top) * 0.6);
  return { cx, top, bottom: jy0, r };
}
function withHead(target, ref, fw, fh) {
  const bt = headBox(target, fw, fh), br = headBox(ref, fw, fh);
  if (!bt || !br) return target;
  const body = target.body.slice();
  for (let y = bt.top; y < bt.bottom; y++) {
    for (let x = Math.max(0, bt.cx - bt.r); x <= Math.min(fw - 1, bt.cx + bt.r); x++) body.fill(0, (y * fw + x) * 4, (y * fw + x) * 4 + 4);
  }
  const dx = bt.cx - br.cx, dy = bt.top - br.top;
  for (let y = br.top; y < br.bottom; y++) {
    for (let x = Math.max(0, br.cx - br.r); x <= Math.min(fw - 1, br.cx + br.r); x++) {
      const s = (y * fw + x) * 4, X = x + dx, Y = y + dy;
      if (!ref.body[s + 3] || X < 0 || Y < 0 || X >= fw || Y >= fh || Y >= bt.bottom) continue;
      body.set(ref.body.subarray(s, s + 4), (Y * fw + X) * 4);
    }
  }
  return { body, jacket: target.jacket };
}

// Точки привязки кадра по маске куртки (туловище) и телу: макушка — верх непрозрачного над серединой
// куртки, спина — задний край куртки на уровне груди, кисти — впереди и позади куртки на уровне пояса.
function anchorsOf(body, jacket, fw, fh) {
  const op = (img, x, y) => img[(y * fw + x) * 4 + 3] > 0;
  let jx0 = fw, jx1 = -1, jy0 = fh, jy1 = -1, sx = 0, n = 0;
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (op(jacket, x, y)) {
    jx0 = Math.min(jx0, x); jx1 = Math.max(jx1, x); jy0 = Math.min(jy0, y); jy1 = Math.max(jy1, y); sx += x; n++;
  }
  if (!n) return null;
  const cx = Math.round(sx / n);
  let top = jy0;
  for (let y = 0; y < jy0; y++) {
    let hit = false;
    for (let x = cx - 8; x <= cx + 8 && !hit; x++) if (x >= 0 && x < fw && (op(body, x, y) || op(jacket, x, y))) hit = true;
    if (hit) { top = y; break; }
  }
  const chest = jy0 + Math.round((jy1 - jy0) * 0.25);
  const waist = jy0 + Math.round((jy1 - jy0) * 0.55);
  return { head: [cx, top], back: [jx0 + 2, chest], handR: [jx1 + 2, waist], handL: [jx0, waist] };
}

function sheet(frameRows, fw, fh, cols) {
  const w = cols * fw, h = frameRows.length * fh;
  const px = new Uint8Array(w * h * 4);
  frameRows.forEach((frames, row) => frames.forEach((fr, col) => {
    for (let y = 0; y < fh; y++) px.set(fr.subarray(y * fw * 4, (y + 1) * fw * 4), ((row * fh + y) * w + col * fw) * 4);
  }));
  return encodePng(w, h, px);
}

const body = JSON.parse(fs.readFileSync(path.join(root, 'heroes', 'body.json'), 'utf8'));

const info = { title: recipe.title, weight: recipe.weight ?? 0, bodyAnimations: false, layers: {}, animations: {} };
let names = null;
for (const [variant, v] of Object.entries(recipe.variants)) {
  const { poses, fw, fh } = loadPoses(v.poses);
  if (fw !== body.frameWidth || fh !== body.frameHeight) throw new Error(`кадр поз ${fw}×${fh}, а ў body.json — ${body.frameWidth}×${body.frameHeight}`);
  const animNames = Object.keys(v.animations);
  if (names && names.join() !== animNames.join()) throw new Error(`варыянт «${variant}»: іншы спіс анімацый, чым у першага (${names.join(', ')})`);
  names = animNames;
  const bodyRows = [], jacketRows = [];
  let cols = 1;
  animNames.forEach((name, row) => {
    const a = v.animations[name];
    const frames = a.frames.map((op) => {
      let p = poses[op.pose];
      if (!p) throw new Error(`варыянт «${variant}», «${name}»: няма позы «${op.pose}»`);
      const headFrom = op.head ?? a.head;
      if (headFrom) {
        if (!poses[headFrom]) throw new Error(`варыянт «${variant}», «${name}»: няма позы «${headFrom}» (head)`);
        p = withHead(p, poses[headFrom], fw, fh);
      }
      if (v.flatRed) p = flattenRed(p, v.flatRed, fw, fh);
      return { body: makeFrame(p.body, op, fw, fh), jacket: makeFrame(p.jacket, op, fw, fh) };
    });
    cols = Math.max(cols, frames.length);
    bodyRows.push(frames.map((f) => f.body));
    jacketRows.push(frames.map((f) => f.jacket));
    // Описание анимации — по первому варианту: у второго строки и число кадров обязаны совпадать.
    if (info.animations[name] && info.animations[name].frames !== frames.length) {
      throw new Error(`варыянт «${variant}», «${name}»: ${frames.length} кадраў, а ў першага варыянта — ${info.animations[name].frames}`);
    }
    if (!info.animations[name]) {
      const e = { row, frames: frames.length, fps: a.fps };
      if (a.loop === false || body.animations[name]?.loop === false) e.loop = false;
      e.anchors = frames.map((f) => anchorsOf(f.body, f.jacket, fw, fh)).filter(Boolean);
      if (!e.anchors.length) delete e.anchors;
      info.animations[name] = e;
    }
  });
  fs.writeFileSync(path.join(dir, `${variant}-body.png`), sheet(bodyRows, fw, fh, cols));
  fs.writeFileSync(path.join(dir, `${variant}-jacket.png`), sheet(jacketRows, fw, fh, cols));
  info.layers[variant] = { body: `${variant}-body.png`, jacket: `${variant}-jacket.png` };
  console.log(`${variant}: ${animNames.length} анімацый, ${bodyRows.reduce((s, r) => s + r.length, 0)} кадраў`);
}
fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 2) + '\n');
const missing = body.required.filter((n) => !info.animations[n]);
if (missing.length) console.log(`Няма (будуць запасныя): ${missing.join(', ')}`);
