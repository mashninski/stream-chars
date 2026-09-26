// Каталог персонажей: папки characters/<імя>/ с character.json и sheet.png.
// Читается один раз при запуске. Битый персонаж — сообщение в терминале и пропуск.
import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_ANIMATIONS = ['idle', 'walk', 'jump', 'fall', 'land', 'shake', 'parachute'];

// Ключ поиска: без учёта регистра и способа записи букв (Unicode NFC) —
// зритель напишет `!перс Кухар`, а папка называется `кухар`.
export function characterKey(name) {
  return String(name).trim().normalize('NFC').toLowerCase();
}

// Размер PNG — из заголовка файла, картинку целиком разбирать не нужно.
function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  const signature = '89504e470d0a1a0a';
  if (head.subarray(0, 8).toString('hex') !== signature || head.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('sheet.png — не PNG-файл');
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const positiveInt = (v) => Number.isInteger(v) && v > 0;

function loadOne(dir, name) {
  if (/\s/.test(name)) throw new Error('у назве папкі ёсць прабел — у камандзе !перс так не напісаць');
  const sheetFile = path.join(dir, 'sheet.png');
  const jsonFile = path.join(dir, 'character.json');
  if (!fs.existsSync(jsonFile)) throw new Error('няма файла character.json');
  if (!fs.existsSync(sheetFile)) throw new Error('няма файла sheet.png');

  let info;
  try {
    info = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  } catch (err) {
    throw new Error(`character.json не чытаецца: ${err.message}`);
  }
  const { frameWidth, frameHeight, animations } = info ?? {};
  if (!positiveInt(frameWidth) || !positiveInt(frameHeight)) {
    throw new Error('frameWidth і frameHeight павінны быць цэлымі лікамі больш за 0');
  }
  if (!animations || typeof animations !== 'object') throw new Error('няма раздзела animations');

  const sheet = pngSize(sheetFile);
  const rows = Math.floor(sheet.height / frameHeight);
  const cols = Math.floor(sheet.width / frameWidth);
  for (const anim of REQUIRED_ANIMATIONS) {
    const a = animations[anim];
    if (!a) throw new Error(`няма анімацыі «${anim}»`);
    if (!Number.isInteger(a.row) || a.row < 0) throw new Error(`«${anim}»: row павінен быць цэлым лікам ад 0`);
    if (!positiveInt(a.frames)) throw new Error(`«${anim}»: frames павінен быць цэлым лікам больш за 0`);
    if (!(typeof a.fps === 'number' && a.fps > 0)) throw new Error(`«${anim}»: fps павінен быць лікам больш за 0`);
    if (a.loop !== undefined && typeof a.loop !== 'boolean') throw new Error(`«${anim}»: loop павінен быць true або false`);
    if (a.row >= rows) {
      throw new Error(`«${anim}»: радок ${a.row} па-за sheet.png (вышыня ${sheet.height} px — радкоў ${rows}, лік ад 0)`);
    }
    if (a.frames > cols) {
      throw new Error(`«${anim}»: ${a.frames} кадраў не змяшчаюцца ў шырыню sheet.png (${sheet.width} px — кадраў ${cols})`);
    }
  }
  // Оверлею — только то, что нужно для рисования. Необязательные анимации (для нового поведения)
  // с ошибкой не валят персонажа — пропускаются, вместо них рисуется запасная.
  // loop: по кругу (по умолчанию) или один раз с остановкой на последнем кадре (false).
  const clean = {};
  for (const [anim, a] of Object.entries(animations)) {
    if (Number.isInteger(a?.row) && positiveInt(a?.frames) && a.fps > 0 && a.row < rows && a.frames <= cols) {
      clean[anim] = { row: a.row, frames: a.frames, fps: a.fps, loop: a.loop !== false };
    } else {
      console.error(`Персанаж «${name}»: анімацыя «${anim}» з памылкай у character.json — прапушчана`);
    }
  }
  return { name, frameWidth, frameHeight, animations: clean, sheetFile };
}

export class Catalog {
  #byKey = new Map();

  constructor(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      console.error(`Няма папкі персанажаў: ${dir}`);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.normalize('NFC');
      const key = characterKey(name);
      try {
        if (this.#byKey.has(key)) throw new Error(`паўтор назвы «${this.#byKey.get(key).name}»`);
        this.#byKey.set(key, loadOne(path.join(dir, entry.name), name));
      } catch (err) {
        console.error(`Персанаж «${name}» прапушчаны: ${err.message}`);
      }
    }
    if (this.#byKey.size) console.log(`Персанажы (${this.#byKey.size}): ${this.names().join(', ')}`);
    else console.error('Ніводнага персанажа не загружана — гледачы будуць без фігурак. Праверце папку characters/.');
  }

  // Персонаж по имени, как его написал человек; нет такого — undefined.
  get(name) {
    return this.#byKey.get(characterKey(name));
  }

  names() {
    return [...this.#byKey.values()].map((c) => c.name);
  }

  // Для оверлея и тестовой панели: имя → размеры кадра и анимации.
  toClient() {
    const out = {};
    for (const { name, frameWidth, frameHeight, animations } of this.#byKey.values()) {
      out[name] = { frameWidth, frameHeight, animations };
    }
    return out;
  }
}
