// Импорт сгенерированной графики (лист эмоций / поз — сетка клеток на однотонном фоне) в листы героя.
//
//   node scripts/import-art.js --in лист.png --cols 4 --rows 2 \
//     --height 90 --names think,joy,panic,angry,drunk,sleep,rub_eyes,knocked --out heroes/classes/warrior/poses --prefix m-list3
//
// Шаги: PNG → фон и зеленоватая кайма в прозрачность → пятна персонажей по клеткам сетки (по середине пятна:
// посох, заехавший к соседу, остаётся своим) → одно уменьшение на все клетки (одинаковый масштаб) «большинством»
// → ноги на нижнюю строку, середина куртки (туловище) по середине кадра → сведение к палитре (N цветов)
// → серые пиксели куртки — в отдельную маску.
// Пишет в папку --out: <prefix>-body.png, <prefix>-jacket.png (строка на клетку, по кадру в строке)
// и <prefix>-import.json (какая строка какая поза) — дальше их сводит в листы класса scripts/build-class.js.
//
// Параметры (по умолчанию):
//   --key #00ff00          цвет фона, станет прозрачным;   --key-tolerance 90  насколько близко к нему (0–441)
//   --key-spill 12         кайма: пиксель, где канал ключа сильнее двух других больше чем на столько, — фон
//   --frame 96x96          размер кадра (по умолчанию — из heroes/body.json)
//   --height 90            рост героя в кадре по обычной позе (медиана клеток); без него — крупнейшая поза во весь кадр
//   --resample majority    уменьшение: majority — частый цвет квадрата (чище), nearest — середина квадрата
//   --palette 32           сколько цветов оставить у тела (0 — не сводить)
//   --jacket #808080       цвет куртки на картинке (нейтрально-серый); --jacket-tolerance 70 по яркости,
//   --jacket-chroma 28     насколько серым должен быть пиксель (разница каналов), --no-jacket — без маски
//   --names                имена анимаций по клеткам, слева направо и сверху вниз; «-» — клетку пропустить
//   --selftest             нарисовать проверочную сетку, импортировать и проверить результат
//
// Только встроенные модули Node.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../src/png.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASK_BASE = 178; // серый, который программа красит ровно в цвет героя (public/js/color.js)

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function hex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h));
  if (!m) throw new Error(`колер «${h}» — трэба #rrggbb`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Сведение к палитре: k-средних по непрозрачным пикселям всех кадров (одна палитра на лист).
function paletteOf(pixels, n) {
  const pts = [];
  for (const px of pixels) for (let i = 0; i < px.length; i += 4) if (px[i + 3]) pts.push([px[i], px[i + 1], px[i + 2]]);
  if (!pts.length || n <= 0) return null;
  const uniq = [...new Map(pts.map((p) => [p.join(','), p])).values()];
  if (uniq.length <= n) return uniq;
  // Старт — самые разные цвета (дальний от уже выбранных), потом уточнение.
  const centers = [uniq[0]];
  while (centers.length < n) {
    let best = null;
    let bestD = -1;
    for (const p of uniq) {
      const d = Math.min(...centers.map((c) => dist(c, p)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    centers.push(best);
  }
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, i) => {
        const d = dist(c, p);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const s = sums[bi];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    sums.forEach((s, i) => {
      if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]].map(Math.round);
    });
  }
  return centers;
}

function nearest(palette, p) {
  let best = palette[0];
  let bd = Infinity;
  for (const c of palette) {
    const d = dist(c, p);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export function importArt(opts) {
  const input = decodePng(fs.readFileSync(opts.in));
  const cols = Number(opts.cols ?? 4);
  const rows = Number(opts.rows ?? 2);
  if (!(cols > 0 && rows > 0)) throw new Error('--cols і --rows — лікі больш за 0');
  const names = String(opts.names ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length !== cols * rows) throw new Error(`--names: трэба ${cols * rows} імёнаў праз коску (клетак ${cols}×${rows}), ёсць ${names.length}`);
  let fw;
  let fh;
  if (opts.frame) {
    [fw, fh] = String(opts.frame).split('x').map(Number);
  } else {
    const body = JSON.parse(fs.readFileSync(path.join(root, 'heroes', 'body.json'), 'utf8'));
    fw = body.frameWidth;
    fh = body.frameHeight;
  }
  if (!(fw > 0 && fh > 0)) throw new Error('--frame — ШЫРЫНЯxВЫШЫНЯ, напрыклад 32x32');
  const key = hex(opts.key ?? '#00ff00');
  const keyTol = Number(opts['key-tolerance'] ?? 90);
  const useJacket = !opts['no-jacket'];
  const jacketKey = hex(opts.jacket ?? '#808080');
  const jacketTol = Number(opts['jacket-tolerance'] ?? 70);
  const jacketChroma = Number(opts['jacket-chroma'] ?? 28);
  const paletteSize = Number(opts.palette ?? 32);

  const cw = Math.floor(input.width / cols);
  const ch = Math.floor(input.height / rows);
  const at = (x, y) => {
    const o = (y * input.width + x) * 4;
    return [input.pixels[o], input.pixels[o + 1], input.pixels[o + 2], input.pixels[o + 3]];
  };
  // Кайма: у ключа один главный канал (#00ff00 — зелёный); пиксель, где он заметно сильнее двух других, —
  // смесь с фоном (сжатие, сглаживание края). У персонажа такого цвета нет по правилам стиля.
  const keyCh = key.indexOf(Math.max(...key));
  const spill = Number(opts['key-spill'] ?? 12);
  const isBg = (p) => p[3] < 128 || dist(p, key) <= keyTol || p[keyCh] - Math.max(...p.slice(0, 3).filter((_, i) => i !== keyCh)) > spill;

  // 1. Клетки. Персонаж = связные пятна не-фона, середина которых лежит в клетке: посох, заехавший
  //    в соседнюю клетку, остаётся со своим героем, а кусок чужого посоха не попадает. Линии сетки
  //    (пятно тоньше 4 пикселей или длиннее полутора клеток) — выбрасываются.
  const W = input.width, H = input.height;
  const label = new Int32Array(W * H).fill(-1);
  const blobs = [];
  for (let i = 0; i < W * H; i++) {
    if (label[i] >= 0 || isBg(at(i % W, (i / W) | 0))) continue;
    const b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0, sx: 0, sy: 0 };
    const id = blobs.length;
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const x = j % W, y = (j / W) | 0;
      b.n++; b.sx += x; b.sy += y;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      for (const k of [j - 1, j + 1, j - W, j + W]) {
        if (k < 0 || k >= W * H || label[k] >= 0) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
        if (isBg(at(k % W, (k / W) | 0))) continue;
        label[k] = id;
        stack.push(k);
      }
    }
    blobs.push(b);
  }
  const cellOf = blobs.map((b) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    if (bw < 4 || bh < 4 || bw > cw * 1.5 || bh > ch * 1.5) return -1;
    const c = Math.min(cols - 1, Math.floor(b.sx / b.n / cw));
    const r = Math.min(rows - 1, Math.floor(b.sy / b.n / ch));
    return r * cols + c;
  });
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const name = names[r * cols + c];
      if (name === '-') continue;
      const idx = r * cols + c;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      blobs.forEach((b, i) => {
        if (cellOf[i] !== idx) return;
        x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
      });
      if (x1 < 0) throw new Error(`клетка ${r + 1}×${c + 1} («${name}») пустая — няма нічога, акрамя фону`);
      cells.push({ name, idx, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
  // Пиксель принадлежит персонажу клетки, только если он из её пятен.
  const mine = (cell, x, y) => cellOf[label[y * W + x]] === cell.idx;

  // 2. Один масштаб на все клетки: персонаж одного размера в каждой позе. --height — рост героя в кадре
  //    по «обычной» клетке (медиана высот клеток: большинство поз — стоя); без него — самая крупная поза во весь кадр.
  const sortedH = cells.map((c) => c.h).sort((a, b) => a - b);
  const refH = sortedH[Math.floor(sortedH.length / 2)];
  // --grid N — картинка нарисована «пикселями» по N точек: уменьшение ровно в N раз, пиксель в пиксель
  // (без муара: узор пояса и повязки не «мигает» между кадрами). Иначе — --height или весь кадр.
  const scale = opts.grid
    ? 1 / Number(opts.grid)
    : opts.height
      ? Number(opts.height) / refH
      : Math.min(...cells.map((c) => Math.min(fw / c.w, fh / c.h)));
  if (!(scale > 0)) throw new Error('--grid / --height — лік больш за 0');
  const nearestMode = opts.resample === 'nearest';

  // 3. Уменьшение. «Большинство» (по умолчанию): пиксель кадра — самый частый цвет своего квадрата на картинке,
  //    пустой, если фона в квадрате больше половины; «nearest» — середина квадрата.
  const bodyFrames = [];
  const jacketFrames = [];
  const placed = [];
  const lumKey = lum(...jacketKey);
  const isJacket = (p) => useJacket && Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) <= jacketChroma && Math.abs(lum(p[0], p[1], p[2]) - lumKey) <= jacketTol;
  const sample = (cell, tx, ty) => {
    if (nearestMode) {
      const sx = Math.min(cell.x0 + cell.w - 1, cell.x0 + Math.floor((tx + 0.5) / scale));
      const sy = Math.min(cell.y0 + cell.h - 1, cell.y0 + Math.floor((ty + 0.5) / scale));
      const p = at(sx, sy);
      return isBg(p) || !mine(cell, sx, sy) ? null : p;
    }
    const bx0 = cell.x0 + Math.floor(tx / scale), bx1 = Math.max(bx0, Math.min(cell.x0 + cell.w, cell.x0 + Math.floor((tx + 1) / scale)) - 1);
    const by0 = cell.y0 + Math.floor(ty / scale), by1 = Math.max(by0, Math.min(cell.y0 + cell.h, cell.y0 + Math.floor((ty + 1) / scale)) - 1);
    const count = new Map();
    let n = 0, fgN = 0;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        n++;
        const p = at(x, y);
        if (isBg(p) || !mine(cell, x, y)) continue;
        fgN++;
        const q = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
        const e = count.get(q) ?? { k: 0, r: 0, g: 0, b: 0 };
        e.k++; e.r += p[0]; e.g += p[1]; e.b += p[2];
        count.set(q, e);
      }
    }
    if (fgN * 2 < n) return null;
    let best = null;
    for (const e of count.values()) if (!best || e.k > best.k) best = e;
    return [Math.round(best.r / best.k), Math.round(best.g / best.k), Math.round(best.b / best.k), 255];
  };
  for (const cell of cells) {
    const tw = Math.max(1, Math.round(cell.w * scale));
    const th = Math.max(1, Math.round(cell.h * scale));
    const small = [];
    let jx = 0, jn = 0;
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const p = sample(cell, tx, ty);
        small.push(p);
        if (p && isJacket(p)) { jx += tx; jn++; }
      }
    }
    // По горизонтали — середина куртки (туловище) на середину кадра: предмет в руке (посох) не сдвигает
    // героя между позами. Без куртки — середина рамки.
    const offX = jn ? Math.round(fw / 2 - (jx / jn + 0.5)) : Math.floor((fw - tw) / 2);
    const offY = fh - th; // ноги — на нижнюю строку
    if (tw > fw || th > fh || offX < 0 || offX + tw > fw) {
      console.warn(`увага: «${cell.name}» (${tw}×${th}) не ўлазіць у кадр ${fw}×${fh} — край абрэзаны`);
    }
    const body = new Uint8Array(fw * fh * 4);
    const jacket = new Uint8Array(fw * fh * 4);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const p = small[ty * tw + tx];
        const fx = offX + tx, fy = offY + ty;
        if (!p || fx < 0 || fy < 0 || fx >= fw || fy >= fh) continue;
        const o = (fy * fw + fx) * 4;
        if (isJacket(p)) {
          // Серый куртки → маска: яркость ключа куртки становится MASK_BASE, тени и блики — вокруг.
          const g = Math.max(0, Math.min(255, Math.round(MASK_BASE + (lum(p[0], p[1], p[2]) - lumKey))));
          jacket.set([g, g, g, 255], o);
        } else {
          body.set([p[0], p[1], p[2], 255], o);
        }
      }
    }
    bodyFrames.push(body);
    jacketFrames.push(jacket);
    placed.push({ name: cell.name, w: tw, h: th, x: offX, y: offY });
  }
  // 4. Палитра тела.
  const palette = paletteOf(bodyFrames, paletteSize);
  if (palette) {
    for (const px of bodyFrames) {
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const c = nearest(palette, [px[i], px[i + 1], px[i + 2]]);
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
      }
    }
  }
  // 5. Листы: строка на клетку.
  const sheet = (frames) => {
    const px = new Uint8Array(fw * fh * frames.length * 4);
    frames.forEach((f, i) => px.set(f, i * fw * fh * 4));
    return encodePng(fw, fh * frames.length, px);
  };
  const outDir = opts.out;
  if (!outDir) throw new Error('--out — у якую папку пісаць');
  const prefix = opts.prefix ?? 'import';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${prefix}-body.png`), sheet(bodyFrames));
  if (useJacket) fs.writeFileSync(path.join(outDir, `${prefix}-jacket.png`), sheet(jacketFrames));
  const animations = Object.fromEntries(cells.map((c, row) => [c.name, { row, frames: 1, fps: 1 }]));
  fs.writeFileSync(path.join(outDir, `${prefix}-import.json`), JSON.stringify({ frameWidth: fw, frameHeight: fh, scale, palette, placed, animations }, null, 2) + '\n');
  return { fw, fh, scale, palette, cells, placed, bodyFrames, jacketFrames };
}

// ---------- самопроверка ----------

function selftest(outDir) {
  const cols = 4, rows = 2, cell = 160;
  const W = cols * cell, H = rows * cell;
  const px = new Uint8Array(W * H * 4);
  const put = (x, y, [r, g, b]) => px.set([r, g, b, 255], (y * W + x) * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [0, 255, 0]);
  // Линии сетки — как бывают у генератора.
  for (let x = 0; x < W; x += cell) for (let y = 0; y < H; y++) put(x, y, [40, 40, 40]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const figures = [];
  for (let i = 0; i < cols * rows; i++) {
    const cx = (i % cols) * cell + 50 + Math.floor(rnd() * 50);
    const top = Math.floor(i / cols) * cell + 20 + Math.floor(rnd() * 20);
    const height = 110 + (i % 3) * 5;
    figures.push({ cx, top, height });
    const rect = (x0, y0, x1, y1, c, jitter = 0) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c.map((v) => Math.max(0, Math.min(255, v + Math.round((rnd() - 0.5) * jitter)))));
    };
    const u = height / 32;
    const Y = (k) => top + Math.round(k * u);
    const X = (k) => cx + Math.round(k * u);
    rect(X(-4), Y(0), X(4), Y(8), [241, 194, 155], 6); // голова
    rect(X(-4), Y(0), X(4), Y(1), [107, 68, 35]); // волосы
    rect(X(-5), Y(8), X(5), Y(20), [128, 128, 128], 10); // куртка (серая)
    rect(X(-5), Y(16), X(5), Y(17), [96, 96, 96], 4); // тень на куртке
    rect(X(-4), Y(20), X(-1), Y(31), [74, 79, 87], 6); // ноги
    rect(X(1), Y(20), X(4), Y(31), [74, 79, 87], 6);
    // Мягкий край (смесь с фоном) у головы — должен уйти в прозрачность.
    for (let y = Y(0); y <= Y(8); y++) put(X(-4) - 1, y, [120, 225, 78]);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const src = path.join(outDir, 'selftest-grid.png');
  fs.writeFileSync(src, encodePng(W, H, px));
  const names = 'think,joy,panic,angry,drunk,sleep,rub_eyes,knocked';
  const res = importArt({ in: src, cols, rows, names, frame: '32x32', palette: 6, out: outDir, prefix: 'selftest' });
  const problems = [];
  const expect = (ok, text) => ok || problems.push(text);
  expect(res.cells.length === 8, 'не 8 клетак');
  res.bodyFrames.forEach((body, i) => {
    const jacket = res.jacketFrames[i];
    const opaque = (f, x, y) => f[(y * 32 + x) * 4 + 3] > 0;
    let bottom = -1, jac = 0, bodyGrey = 0, colors = new Set(), corner = false;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (opaque(body, x, y) || opaque(jacket, x, y)) bottom = Math.max(bottom, y);
        if (opaque(jacket, x, y)) jac++;
        if (opaque(body, x, y)) {
          const o = (y * 32 + x) * 4;
          colors.add(`${body[o]},${body[o + 1]},${body[o + 2]}`);
          if (Math.max(body[o], body[o + 1], body[o + 2]) - Math.min(body[o], body[o + 1], body[o + 2]) < 20 && body[o] > 90 && body[o] < 170) bodyGrey++;
        }
      }
    }
    corner = opaque(body, 0, 0) || opaque(body, 31, 0);
    expect(bottom === 31, `кадр ${i}: ногі не на ніжнім радку (${bottom})`);
    expect(jac > 20, `кадр ${i}: маска курткі пустая (${jac})`);
    expect(bodyGrey === 0, `кадр ${i}: шэрыя пікселі курткі засталіся ў целе (${bodyGrey})`);
    expect(colors.size <= 6, `кадр ${i}: колераў ${colors.size} > 6`);
    expect(!corner, `кадр ${i}: фон не празрысты`);
  });
  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'selftest-import.json'), 'utf8'));
  expect(json.animations.knocked?.row === 7, 'import.json: «knocked» не ў радку 7');
  if (problems.length) {
    console.error('Самаправерка НЕ прайшла:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log(`Самаправерка прайшла: 8 клетак, маштаб ${res.scale.toFixed(3)}, колераў цела ${res.palette.length}. Файлы — ${outDir}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  try {
    if (opts.selftest) selftest(typeof opts.out === 'string' ? opts.out : fs.mkdtempSync(path.join(os.tmpdir(), 'import-art-')));
    else {
      if (!opts.in) throw new Error('--in — які PNG імпартаваць (дапамога — у пачатку scripts/import-art.js)');
      const res = importArt(opts);
      console.log(`Імпартавана ${res.cells.length} кадраў ${res.fw}×${res.fh}, маштаб ${res.scale.toFixed(3)} → ${opts.out}`);
    }
  } catch (err) {
    console.error(`Памылка: ${err.message}`);
    process.exitCode = 1;
  }
}
