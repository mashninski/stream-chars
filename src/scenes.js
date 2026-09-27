// Список сцен по содержимому папки public/js/scenes/: <класс>/<имя>.js — спецдействия класса,
// common/<имя>.js — общие действия (meta.kind 'action') и служебные сцены ('system': «першае слова»…).
// Новый файл подхватывается при запуске сам. Файл с ошибкой пропускается с понятной строкой.
// id сцены — «<папка>/<имя без .js>», например 'mage/fireball'.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { log } from './log.js';
import { pickWeighted } from '../public/js/random.js';

export const COMMON = 'common';

export class Scenes {
  #list = [];
  #catalog;
  #heroes;

  constructor(catalog, heroes) {
    this.#catalog = catalog;
    this.#heroes = heroes;
  }

  // Читает папку сцен. Асинхронно: модули импортируются, чтобы взять meta.
  async load(dir) {
    const list = [];
    let folders = [];
    try {
      folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      log.error(`Няма папкі сцэн: ${dir}`);
    }
    for (const folder of folders) {
      const group = folder.name.normalize('NFC');
      if (group !== COMMON && !this.#catalog.item('classes', group)) {
        log.error(`Сцэны «${group}/»: класа «${group}» няма ў heroes/classes — сцэны не будуць выпадаць`);
      }
      const files = fs.readdirSync(path.join(dir, folder.name)).filter((f) => f.endsWith('.js')).sort();
      for (const file of files) {
        const id = `${group}/${file.slice(0, -3)}`;
        try {
          const mod = await import(pathToFileURL(path.join(dir, folder.name, file)).href);
          const meta = mod.meta;
          if (!meta || typeof meta.title !== 'string') throw new Error('няма export const meta = { title: … }');
          if (typeof mod.run !== 'function') throw new Error('няма export function* run(s)');
          const weight = meta.weight ?? 1;
          if (!(Number.isFinite(weight) && weight >= 0)) throw new Error('meta.weight — лік ад 0');
          list.push({
            id,
            group,
            title: meta.title,
            kind: group === COMMON ? meta.kind ?? 'action' : 'special',
            weight,
            order: Number.isFinite(meta.order) ? meta.order : 999,
            cases: meta.cases ?? {},
            ownsText: !!meta.ownsText,
          });
        } catch (err) {
          log.error(`Сцэна «${id}» прапушчана: ${err.message}`);
        }
      }
    }
    list.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.id.localeCompare(b.id));
    this.#list = list;
    const specials = list.filter((s) => s.kind === 'special').length;
    log.info(`Сцэны: спецдзеянняў ${specials}, агульных ${list.filter((s) => s.kind === 'action').length}, службовых ${list.filter((s) => s.kind === 'system').length}`);
    return this;
  }

  get(id) {
    return this.#list.find((s) => s.id === id);
  }

  // Спецдействия класса по порядку (кнопки «1», «2», «3» в админке).
  specials(classId) {
    return this.#list.filter((s) => s.kind === 'special' && s.group === classId);
  }

  // Общие действия (есть у всех): для наград и админки.
  actions() {
    return this.#list.filter((s) => s.kind === 'action');
  }

  // Веса спецдействий класса с поправками из окна «Рэдкасць» (ключ 'special:<класс>').
  specialWeights(classId) {
    const defaults = Object.fromEntries(this.specials(classId).map((s) => [s.id, s.weight]));
    return this.#heroes.weights(`special:${classId}`, defaults);
  }

  // Случайное спецдействие своего класса по весам; нет ни одного — null.
  pickSpecial(classId, rand = Math.random) {
    return pickWeighted(this.specialWeights(classId), rand);
  }

  // Случаи внутри сцены: значения и веса по умолчанию (meta.cases: values или from 'категория:группа').
  #caseDefaults(c) {
    if (c.values) return Object.fromEntries(Object.entries(c.values).map(([id, v]) => [id, v?.weight ?? 1]));
    if (typeof c.from === 'string') {
      const [category, group] = c.from.split(':');
      return Object.fromEntries(this.#catalog.items(category).filter((it) => !group || it.group === group).map((it) => [it.id, it.weight ?? 1]));
    }
    return {};
  }

  #caseTitles(c) {
    if (c.values) return Object.fromEntries(Object.entries(c.values).map(([id, v]) => [id, v?.title ?? id]));
    const [category] = String(c.from ?? '').split(':');
    return Object.fromEntries(this.#catalog.items(category).map((it) => [it.id, it.title]));
  }

  caseWeights(sceneId, caseName) {
    const sc = this.get(sceneId);
    const c = sc?.cases[caseName];
    return c ? this.#heroes.weights(`scene:${sceneId}:${caseName}`, this.#caseDefaults(c)) : {};
  }

  // Категории окна «Рэдкасць» от сцен: спецдействия каждого класса и случаи внутри сцен.
  weightCategories() {
    const out = [];
    for (const cls of this.#catalog.items('classes')) {
      const list = this.specials(cls.id);
      if (!list.length) continue;
      const w = this.specialWeights(cls.id);
      out.push({
        key: `special:${cls.id}`,
        title: `Спецдзеянні: ${cls.title}`,
        values: list.map((s) => ({ id: s.id, title: s.title, default: s.weight, weight: w[s.id] })),
      });
    }
    for (const sc of this.#list) {
      for (const [name, c] of Object.entries(sc.cases)) {
        const defaults = this.#caseDefaults(c);
        const w = this.caseWeights(sc.id, name);
        const titles = this.#caseTitles(c);
        out.push({
          key: `scene:${sc.id}:${name}`,
          title: c.title ?? `${sc.title}: ${name}`,
          values: Object.keys(defaults).map((id) => ({ id, title: titles[id] ?? id, default: defaults[id], weight: w[id] })),
        });
      }
    }
    return out;
  }

  // Для оверлея и админки: список сцен с весами случаев (по ним оверлей выбирает по зерну).
  toClient() {
    return this.#list.map((s) => ({
      id: s.id,
      group: s.group,
      title: s.title,
      kind: s.kind,
      ownsText: s.ownsText,
      cases: Object.fromEntries(Object.keys(s.cases).map((name) => [name, this.caseWeights(s.id, name)])),
    }));
  }
}
