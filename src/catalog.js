// Каталог героев: папка heroes/.
//   heroes/body.json                 — общая сетка кадров тела: размер кадра, анимации (строки), точки привязки
//   heroes/traits.json               — реестр признаков (src/heroes.js)
//   heroes/<категория>/<id>/info.json + картинки — классы, уборы, крылья, реквизит, существа…
// Категория — любая папка: новая категория (плащи, питомцы) — новая папка, код не трогается.
// Предмет с "layers" — рисуется на общей сетке тела (класс: слои тела, куртки, украшений по полам);
// предмет с "image" — свой лист кадров (убор, крылья, реквизит, существо).
// Читается при запуске. Битое пропускается с понятной строкой в журнале.
import fs from 'node:fs';
import path from 'node:path';
import { log } from './log.js';
import { pngSize } from './png.js';

const positiveInt = (v) => Number.isInteger(v) && v > 0;
const ID = /^[\p{L}\p{N}_-]+$/u;

function readInfo(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`няма файла ${path.basename(file)}`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`${path.basename(file)} не чытаецца: ${err.message}`);
  }
}

// Точка [x, y] или [x, y, поворот°].
function checkPoint(p, where) {
  if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error(`${where}: кропка — [x, y] або [x, y, паварот]`);
  }
}

// Анимации: { имя: { row, frames, fps, loop?, anchors? } }. Возвращает чистую копию;
// rows/cols — сколько строк и кадров вмещает лист (undefined — не проверять).
// Анимация с ошибкой пропускается (строка в журнале), остальные остаются.
function cleanAnimations(animations, where, rows, cols) {
  const out = {};
  for (const [name, a] of Object.entries(animations ?? {})) {
    const problem =
      !Number.isInteger(a?.row) || a.row < 0 ? 'row — цэлы лік ад 0'
      : !positiveInt(a.frames) ? 'frames — цэлы лік больш за 0'
      : !(typeof a.fps === 'number' && a.fps > 0) ? 'fps — лік больш за 0'
      : a.loop !== undefined && typeof a.loop !== 'boolean' ? 'loop — true або false'
      : rows !== undefined && a.row >= rows ? `радок ${a.row} па-за лістом (радкоў ${rows}, лік ад 0)`
      : cols !== undefined && a.frames > cols ? `${a.frames} кадраў не змяшчаюцца (у шырыню ${cols})`
      : null;
    if (problem) {
      log.error(`${where}: анімацыя «${name}» — ${problem}; прапушчана`);
      continue;
    }
    const e = { row: a.row, frames: a.frames, fps: a.fps, loop: a.loop !== false };
    if (a.anchors !== undefined) {
      try {
        const list = Array.isArray(a.anchors) ? a.anchors : [a.anchors];
        for (const [i, pts] of list.entries()) {
          for (const [n, p] of Object.entries(pts ?? {})) checkPoint(p, `анімацыя «${name}», кадр ${i}, «${n}»`);
        }
        e.anchors = list;
      } catch (err) {
        log.error(`${where}: ${err.message}; кропкі прывязкі прапушчаны`);
      }
    }
    out[name] = e;
  }
  return out;
}

function sheetFile(dir, name, where) {
  if (typeof name !== 'string' || !name.endsWith('.png') || name.includes('/') || name.includes('\\')) {
    throw new Error(`${where}: імя файла — «*.png» у папцы прадмета`);
  }
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) throw new Error(`няма файла ${name}`);
  return { file, size: pngSize(file) };
}

export class Catalog {
  body = null;
  #categories = new Map();
  #files = new Map(); // адрес → путь к файлу (отдаются только эти)

  constructor(dir) {
    this.dir = dir;
    try {
      this.#loadBody(path.join(dir, 'body.json'));
    } catch (err) {
      log.error(`heroes/body.json: ${err.message}. Героі будуць без графікі.`);
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      log.error(`Няма папкі каталога: ${dir}`);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) this.#loadCategory(entry.name.normalize('NFC'), path.join(dir, entry.name));
    }
    const summary = [...this.#categories].map(([c, items]) => `${c}: ${items.size}`).join(', ');
    log.info(`Каталог герояў — ${summary || 'пусты'}`);
    if (!this.ids('classes').length) log.error('Ніводнага класа не загружана — героі будуць без фігурак. Праверце heroes/classes/.');
  }

  #loadBody(file) {
    const info = readInfo(file);
    if (!positiveInt(info.frameWidth) || !positiveInt(info.frameHeight)) throw new Error('frameWidth і frameHeight — цэлыя лікі больш за 0');
    const animations = cleanAnimations(info.animations, 'body.json');
    if (!animations.idle) throw new Error('няма анімацыі «idle»');
    const required = Array.isArray(info.required) ? info.required.filter((a) => typeof a === 'string') : ['idle'];
    for (const a of required) if (!animations[a]) log.error(`body.json: няма абавязковай анімацыі «${a}» — будзе запасная`);
    const fallbacks = {};
    for (const [a, b] of Object.entries(info.fallbacks ?? {})) if (typeof b === 'string') fallbacks[a] = b;
    // Точки привязки по умолчанию (для анимаций без своих): { head, back, handR, handL }.
    const anchors = {};
    for (const [n, p] of Object.entries(info.anchors ?? {})) {
      checkPoint(p, `anchors.${n}`);
      anchors[n] = p;
    }
    this.body = { frameWidth: info.frameWidth, frameHeight: info.frameHeight, required, fallbacks, animations, anchors };
  }

  #loadCategory(category, dir) {
    const items = new Map();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const id = entry.name.normalize('NFC');
      const where = `${category}/${id}`;
      try {
        if (!ID.test(id)) throw new Error('у назве папкі толькі літары, лічбы, «-» і «_»');
        items.set(id, this.#loadItem(category, id, path.join(dir, entry.name), where));
      } catch (err) {
        log.error(`«${where}» прапушчаны: ${err.message}`);
      }
    }
    this.#categories.set(category, items);
  }

  #loadItem(category, id, dir, where) {
    const info = readInfo(path.join(dir, 'info.json'));
    const item = {
      id,
      category,
      title: typeof info.title === 'string' && info.title.trim() ? info.title.trim() : id,
      weight: info.weight === undefined ? 1 : info.weight,
    };
    if (!(Number.isFinite(item.weight) && item.weight >= 0)) throw new Error('weight — лік ад 0');
    if (typeof info.group === 'string') item.group = info.group;
    if (info.layers !== undefined) return this.#loadLayered(item, info, dir, where);
    if (info.image !== undefined) return this.#loadSprite(item, info, dir, where);
    throw new Error('у info.json няма ні "layers" (слаі на агульнай сетцы цела), ні "image" (свой ліст)');
  }

  #url(category, id, name, file) {
    const url = `/heroes/${encodeURIComponent(category)}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
    this.#files.set(url, file);
    return url;
  }

  // Класс: слои по вариантам (полам) на общей сетке тела. Анимации — общие из body.json + свои (строки ниже).
  #loadLayered(item, info, dir, where) {
    if (!this.body) throw new Error('няма агульнай сеткі цела (body.json)');
    const { frameWidth: fw, frameHeight: fh } = this.body;
    if (!info.layers || typeof info.layers !== 'object') throw new Error('"layers" — раздзел { варыянт: { слой: файл } }');
    const own = cleanAnimations(info.animations, where);
    const merged = { ...this.body.animations, ...own };
    item.layers = {};
    let rows = Infinity;
    let cols = Infinity;
    for (const [variant, layers] of Object.entries(info.layers)) {
      if (!layers || typeof layers !== 'object') throw new Error(`варыянт «${variant}»: чакаецца { слой: файл }`);
      item.layers[variant] = {};
      for (const [layer, name] of Object.entries(layers)) {
        const { file, size } = sheetFile(dir, name, `${variant}.${layer}`);
        if (size.width % fw || size.height % fh) {
          throw new Error(`${name}: памер ${size.width}×${size.height} не дзеліцца на кадр ${fw}×${fh}`);
        }
        rows = Math.min(rows, size.height / fh);
        cols = Math.min(cols, size.width / fw);
        item.layers[variant][layer] = this.#url(item.category, item.id, name, file);
      }
    }
    if (!Object.keys(item.layers).length) throw new Error('няма ніводнага варыянта ў "layers"');
    // Анимации, которых нет в листах (лист короче), — пропускаются: вместо них запасная.
    item.animations = {};
    for (const [name, a] of Object.entries(merged)) {
      if (a.row < rows && a.frames <= cols) item.animations[name] = a;
      else if (own[name] || this.body.required.includes(name)) log.info(`${where}: анімацыі «${name}» няма ў лістах — будзе запасная`);
    }
    if (!item.animations.idle) throw new Error('няма анімацыі «idle» (радок 0 ліста)');
    return item;
  }

  // Предмет со своим листом: убор, крылья, реквизит, существо.
  #loadSprite(item, info, dir, where) {
    const { file, size } = sheetFile(dir, info.image, 'image');
    const fw = info.frameWidth ?? size.width;
    const fh = info.frameHeight ?? size.height;
    if (!positiveInt(fw) || !positiveInt(fh)) throw new Error('frameWidth і frameHeight — цэлыя лікі больш за 0');
    const rows = Math.floor(size.height / fh);
    const cols = Math.floor(size.width / fw);
    const animations = cleanAnimations(info.animations ?? { idle: { row: 0, frames: 1, fps: 1 } }, where, rows, cols);
    if (!animations.idle) animations.idle = { row: 0, frames: 1, fps: 1, loop: true };
    const anchor = info.anchor ?? [Math.floor(fw / 2), fh - 1];
    checkPoint(anchor, 'anchor');
    return { ...item, image: this.#url(item.category, item.id, info.image, file), frameWidth: fw, frameHeight: fh, anchor, animations };
  }

  item(category, id) {
    return this.#categories.get(category)?.get(id);
  }

  ids(category) {
    return [...(this.#categories.get(category)?.keys() ?? [])];
  }

  items(category) {
    return [...(this.#categories.get(category)?.values() ?? [])];
  }

  categories() {
    return [...this.#categories.keys()];
  }

  // Путь к файлу по адресу /heroes/…; не из каталога — undefined.
  file(url) {
    return this.#files.get(url);
  }

  // Для оверлея, админки и тестовой панели — без путей к файлам на диске.
  toClient() {
    const categories = {};
    for (const [c, items] of this.#categories) {
      categories[c] = Object.fromEntries([...items].map(([id, it]) => [id, it]));
    }
    return { body: this.body, categories };
  }
}
