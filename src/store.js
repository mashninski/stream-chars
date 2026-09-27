// Герои зрителей: data/viewers.json (формат 2).
// Ключ — id зрителя: user_id Twitch; у тестовых — «test:<нік>».
// Формат: { "version": 2, "viewers": { "<id>": {
//   "name": "<последний ник>",
//   "traits": { "<признак реестра>": значение, ... },
//   "flags": { "follower": false, "subMonths": 0, "subActive": false, "firstWord": false },
//   "firstSeen": <время>, "lastSeen": <время> } } }
//
// Старый формат (задачи 2–3: { "viewers": { id: { "character", "name" } } }) переносится при чтении:
// старым записям — новые случайные признаки (старые персонажи — не классы). Перед первой записью
// в новом формате — копия старого файла viewers.v1-<время>.json (новый файл, старый не удаляется).
import fs from 'node:fs';
import path from 'node:path';
import { log } from './log.js';
import { writeJsonAtomic } from './files.js';

export const DEFAULT_FLAGS = { follower: false, subMonths: 0, subActive: false, firstWord: false };

export class ViewerStore {
  #file;
  #heroes;
  #viewers = {};
  #now;
  #v1Text = null; // текст старого файла до первой записи в новом формате

  constructor(file, heroes, { now = Date.now } = {}) {
    this.#file = file;
    this.#heroes = heroes;
    this.#now = now;
    this.#load();
  }

  #load() {
    let text;
    try {
      text = fs.readFileSync(this.#file, 'utf8');
    } catch {
      return; // файла ещё нет — первый запуск
    }
    let data;
    try {
      data = JSON.parse(text.replace(/^﻿/, ''));
      if (!data?.viewers || typeof data.viewers !== 'object') throw new Error('няма раздзела viewers');
    } catch (err) {
      // Битый файл не перезаписываем: откладываем в сторону, чтобы его можно было починить руками.
      const aside = this.#file.replace(/\.json$/, `.broken-${this.#now()}.json`);
      fs.renameSync(this.#file, aside);
      log.error(`${path.basename(this.#file)} пашкоджаны (${err.message}). Адкладзены ў ${path.basename(aside)}, пачынаем з пустога спісу.`);
      return;
    }
    if (data.version === 2) {
      this.#viewers = data.viewers;
      let fixedCount = 0;
      for (const entry of Object.values(this.#viewers)) {
        entry.traits ??= {};
        entry.flags = { ...DEFAULT_FLAGS, ...entry.flags };
        if (this.#heroes.repair(entry.traits).length) fixedCount++;
      }
      if (fixedCount) log.info(`Героі: у ${fixedCount} гледачоў прыкметы, якіх больш няма ў каталогу, абраныя нанова`);
      log.info(`Героі гледачоў: ${Object.keys(this.#viewers).length} з ${path.basename(this.#file)}`);
      return;
    }
    // Старый формат — перенос.
    this.#v1Text = text;
    const now = this.#now();
    for (const [id, old] of Object.entries(data.viewers)) {
      this.#viewers[id] = {
        name: typeof old?.name === 'string' ? old.name : id,
        traits: this.#heroes.newHero([]),
        flags: { ...DEFAULT_FLAGS },
        firstSeen: now,
        lastSeen: now,
      };
    }
    log.info(`${path.basename(this.#file)} — стары фармат (${Object.keys(this.#viewers).length} гледачоў): кожнаму новы герой. Копія старога файла — пры першым запісе.`);
  }

  #save() {
    try {
      if (this.#v1Text !== null) {
        const stamp = new Date(this.#now()).toISOString().replace(/[:.]/g, '-');
        const copy = path.join(path.dirname(this.#file), `viewers.v1-${stamp}.json`);
        // 'wx' — не перезаписать, если такой файл уже есть.
        fs.writeFileSync(copy, this.#v1Text, { flag: 'wx' });
        log.info(`Копія старога ${path.basename(this.#file)} — ${path.basename(copy)}`);
        this.#v1Text = null;
      }
      writeJsonAtomic(this.#file, { version: 2, viewers: this.#viewers });
    } catch (err) {
      log.error(`Не атрымалася запісаць ${path.basename(this.#file)}: ${err.message}`);
    }
  }

  get(id) {
    return this.#viewers[id];
  }

  // Герой зрителя. Нет — новый по реестру (taken — цвета героев на экране, для «дальнего цвета»).
  // Заодно запоминает последний ник и время.
  heroFor({ id, name }, taken = []) {
    let entry = this.#viewers[id];
    if (!entry) {
      const now = this.#now();
      entry = this.#viewers[id] = { name, traits: this.#heroes.newHero(taken), flags: { ...DEFAULT_FLAGS }, firstSeen: now, lastSeen: now };
      log.info(`[герой] ${name}: ${this.#describe(entry.traits)}`);
    } else {
      const fixed = this.#heroes.repair(entry.traits, taken);
      if (fixed.length) log.info(`[герой] ${name}: нанова ${fixed.join(', ')} — старых значэнняў больш няма`);
      entry.name = name;
      entry.lastSeen = this.#now();
    }
    this.#save();
    return entry;
  }

  #describe(traits) {
    return this.#heroes.traits
      .filter((t) => t.appears === 'firstSeen')
      .map((t) => `${t.title.toLowerCase()} ${traits[t.id]}`)
      .join(', ');
  }

  // Поменять признак. Неверное значение — false, ничего не меняется.
  setTrait(id, traitId, value) {
    const entry = this.#viewers[id];
    if (!entry || !this.#heroes.valid(traitId, value)) return false;
    if (entry.traits[traitId] === value) return true;
    entry.traits[traitId] = value;
    this.#save();
    return true;
  }

  setFlags(id, patch) {
    const entry = this.#viewers[id];
    if (!entry) return false;
    entry.flags = { ...entry.flags, ...patch };
    this.#save();
    return true;
  }

  // Все зрители с героями: [{ id, name, traits, flags, lastSeen }].
  all() {
    return Object.entries(this.#viewers).map(([id, e]) => ({ id, ...e }));
  }
}
