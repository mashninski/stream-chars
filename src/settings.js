// Настройки: значения по умолчанию — config.json (в git, программа его не меняет),
// поверх — data/settings.json (пишет админка; только изменённое). Применяются без перезапуска,
// кроме порта: модули читают settings.get() в момент использования или слушают 'change'.
//
// Проверка — по образцу значений по умолчанию: ключ должен быть в config.json, тип — тот же.
// Числа — конечные и не меньше 0, если в LIMITS не сказано иначе. Новая настройка в config.json
// проверяется сама, код не трогается. Неверное значение — отказ по-белорусски, файл не пишется.
import { EventEmitter } from 'node:events';
import { readJson, writeJsonAtomic } from './files.js';

// Границы чисел: путь → [от, до]. Остальные числа — от 0.
const LIMITS = {
  port: [1024, 65535],
  maxOnScreen: [1, 500],
  'bubble.maxChars': [10, 500],
  'bubble.maxWidth': [60, 1000],
  'bubble.maxLines': [1, 20],
  'bubble.fontSize': [8, 64],
  'bubble.maxSeconds': [0.5, 120],
  'raid.maxCount': [0, 200],
  'overlay.scale': [1, 10],
  'overlay.width': [100, 8000],
  'overlay.height': [100, 8000],
  'scenes.maxConcurrent': [1, 50],
  'twitch.pollSeconds': [15, 3600],
  'twitch.leaveAfterPolls': [1, 100],
};

// Разделы, где ключи заводит сам пользователь (у config.json там пусто или примеры): путь → тип значений.
// weights — веса редкости по категориям ({ категория: { значение: вес } }), числа от 0;
// rewardLinks — ручная связь «название награды → действие», строки.
const OPEN_MAPS = {
  weights: 'weights',
  rewardLinks: 'string',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? structuredClone(base) : structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : structuredClone(v);
  return out;
}

function typeName(v) {
  if (Array.isArray(v)) return 'спіс';
  if (v === null) return 'null';
  return { number: 'лік', string: 'радок', boolean: 'так/не', object: 'раздзел' }[typeof v] ?? typeof v;
}

// Проверка одного значения по образцу. Ошибка — текст по-белорусски, иначе null.
function checkValue(pathStr, value, sample) {
  if (OPEN_MAPS[pathStr]) return checkOpenMap(pathStr, value, OPEN_MAPS[pathStr]);
  if (isObject(sample)) {
    if (!isObject(value)) return `«${pathStr}»: чакаецца раздзел`;
    for (const [k, v] of Object.entries(value)) {
      const sub = pathStr ? `${pathStr}.${k}` : k;
      if (!(k in sample) && !OPEN_MAPS[sub]) return `невядомая налада «${sub}»`;
      const err = checkValue(sub, v, sample[k]);
      if (err) return err;
    }
    return null;
  }
  if (Array.isArray(sample)) {
    if (!Array.isArray(value)) return `«${pathStr}»: чакаецца спіс`;
    // Пара чисел [от, до] — той же длины, от ≤ до.
    if (sample.length && sample.every((x) => typeof x === 'number')) {
      if (value.length !== sample.length || !value.every((x) => Number.isFinite(x) && x >= 0)) {
        return `«${pathStr}»: чакаецца ${sample.length} лікі ад 0`;
      }
      if (sample.length === 2 && value[0] > value[1]) return `«${pathStr}»: першы лік большы за другі`;
      return null;
    }
    // Список строк (например, боты без героев).
    if (sample.every((x) => typeof x === 'string')) {
      return value.every((x) => typeof x === 'string') ? null : `«${pathStr}»: чакаюцца радкі`;
    }
    // Список разделов (например, ступени крыльев): каждый — по образцу первого.
    for (const [i, item] of value.entries()) {
      const err = checkValue(`${pathStr}.${i}`, item, sample[0]);
      if (err) return err;
    }
    return null;
  }
  if (typeof value !== typeof sample) return `«${pathStr}»: чакаецца ${typeName(sample)}, а не ${typeName(value)}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `«${pathStr}»: не лік`;
    const [min, max] = LIMITS[pathStr] ?? [0, Infinity];
    if (value < min || value > max) return `«${pathStr}»: трэба ад ${min}${max < Infinity ? ` да ${max}` : ''}`;
  }
  if (typeof value === 'string' && value.length > 2000) return `«${pathStr}»: занадта доўгі радок`;
  return null;
}

function checkOpenMap(pathStr, value, kind) {
  if (!isObject(value)) return `«${pathStr}»: чакаецца раздзел`;
  for (const [k, v] of Object.entries(value)) {
    if (kind === 'string') {
      if (typeof v !== 'string' || v.length > 200) return `«${pathStr}.${k}»: чакаецца радок`;
    } else if (kind === 'weights') {
      if (!isObject(v)) return `«${pathStr}.${k}»: чакаецца раздзел вагаў`;
      for (const [name, w] of Object.entries(v)) {
        if (!(Number.isFinite(w) && w >= 0 && w <= 1e6)) return `«${pathStr}.${k}.${name}»: вага — лік ад 0`;
      }
    }
  }
  return null;
}

export class Settings extends EventEmitter {
  #defaults;
  #overrides = {};
  #merged;
  #file;
  #log;

  // defaults — содержимое config.json; file — путь к data/settings.json (нет — только значения по умолчанию).
  constructor(defaults, file, log) {
    super();
    this.#defaults = defaults;
    this.#file = file;
    this.#log = log;
    this.#load();
    this.#merged = deepMerge(this.#defaults, this.#overrides);
  }

  #load() {
    if (!this.#file) return;
    let data;
    try {
      data = readJson(this.#file);
    } catch (err) {
      this.#log?.error(`settings.json не чытаецца (${err.message}) — налады па змаўчанні. Файл не кранаем.`);
      return;
    }
    if (data === undefined) return;
    if (!isObject(data)) {
      this.#log?.error('settings.json: чакаецца раздзел — налады па змаўчанні.');
      return;
    }
    // Неверные ключи пропускаются по одному, остальное применяется.
    for (const [k, v] of Object.entries(data)) {
      const err = checkValue('', { [k]: v }, this.#defaults);
      if (err) this.#log?.error(`settings.json: ${err} — прапушчана`);
      else this.#overrides[k] = v;
    }
  }

  get() {
    return this.#merged;
  }

  get defaults() {
    return this.#defaults;
  }

  // Только то, что поменяно поверх config.json.
  get overrides() {
    return this.#overrides;
  }

  // patch — часть настроек ({ bubble: { maxChars: 80 } }). Разделы сливаются, списки и значения заменяются.
  // Ответ: { ok: true } или { ok: false, error }. При ошибке ничего не меняется и файл не пишется.
  set(patch) {
    const err = checkValue('', patch, this.#defaults);
    if (err) return { ok: false, error: err };
    const overrides = deepMerge(this.#overrides, patch);
    const merged = deepMerge(this.#defaults, overrides);
    // Пара «от–до» могла стать неверной после слияния частей — проверяем итог целиком.
    const errMerged = checkValue('', merged, this.#defaults);
    if (errMerged) return { ok: false, error: errMerged };
    if (this.#file) {
      try {
        writeJsonAtomic(this.#file, overrides);
      } catch (e) {
        return { ok: false, error: `не атрымалася запісаць settings.json: ${e.message}` };
      }
    }
    this.#overrides = overrides;
    this.#merged = merged;
    this.emit('change', merged, patch);
    return { ok: true };
  }

  // Вернуть значение по умолчанию: путь 'bubble.maxChars' или раздел 'weights.classes'.
  reset(pathStr) {
    const keys = pathStr.split('.');
    const overrides = structuredClone(this.#overrides);
    let node = overrides;
    for (const k of keys.slice(0, -1)) {
      if (!isObject(node[k])) return { ok: true };
      node = node[k];
    }
    delete node[keys.at(-1)];
    if (this.#file) {
      try {
        writeJsonAtomic(this.#file, overrides);
      } catch (e) {
        return { ok: false, error: `не атрымалася запісаць settings.json: ${e.message}` };
      }
    }
    this.#overrides = overrides;
    this.#merged = deepMerge(this.#defaults, overrides);
    this.emit('change', this.#merged, {});
    return { ok: true };
  }
}
