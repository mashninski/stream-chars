// Герой: признаки из реестра (heroes/traits.json) и как они выбираются.
// Хранилище, админка и оверлей берут список признаков отсюда — не из кода.
//
// Запись реестра: id, title, type, appears, pick, admin, points, optional, layer.
//   type:    item   — значение из категории каталога ("category": папка heroes/<категория>/)
//            choice — значение из "values" ({ id: { title, weight } })
//            color  — цвет '#rrggbb'
//            bool   — да/нет
//   appears: когда появляется — firstSeen (первое появление), follow (стал фолловером),
//            subscription (месяцы подписки), firstMessage (первое сообщение), twitch (из данных Twitch)
//   pick:    как выбирается — weights (по весам редкости), farColor («дальний цвет»),
//            tiers (по ступеням: настройки "tiers.<id>" — [{ months, value }]), none
//   admin:   меняется из админки; points — меняется за баллы канала (награда «змяніць <признак>»)
//   optional — может не быть (null); layer — { z, anchor }: рисуется слоем поверх тела по точке привязки.
import { readJson } from './files.js';
import { pickWeighted } from '../public/js/random.js';
import { farColor, hexToRgb } from '../public/js/color.js';

const TYPES = ['item', 'choice', 'color', 'bool'];
const PICKS = ['weights', 'farColor', 'tiers', 'none'];

export function loadTraits(file, log) {
  let data;
  try {
    data = readJson(file);
  } catch (err) {
    log.error(`traits.json не чытаецца: ${err.message}`);
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const t of data?.traits ?? []) {
    const problem =
      typeof t?.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(t.id) ? 'id — лацінскія літары і лічбы'
      : seen.has(t.id) ? `паўтор id «${t.id}»`
      : !TYPES.includes(t.type) ? `type — адно з ${TYPES.join(', ')}`
      : t.type === 'item' && typeof t.category !== 'string' ? 'для type "item" патрэбна "category"'
      : t.type === 'choice' && (!t.values || typeof t.values !== 'object' || !Object.keys(t.values).length) ? 'для type "choice" патрэбны "values"'
      : t.pick !== undefined && !PICKS.includes(t.pick) ? `pick — адно з ${PICKS.join(', ')}`
      : t.layer !== undefined && !(Number.isFinite(t.layer?.z) && typeof t.layer?.anchor === 'string') ? 'layer — { z: лік, anchor: кропка прывязкі }'
      : null;
    if (problem) {
      log.error(`traits.json: прыкмета ${t?.id ?? '?'} прапушчана — ${problem}`);
      continue;
    }
    seen.add(t.id);
    out.push({ title: t.id, appears: 'firstSeen', pick: 'none', admin: false, points: false, optional: false, ...t });
  }
  return out;
}

export class Heroes {
  #settings;
  #catalog;
  #rand;

  // settings — src/settings.js; rand подменяется в проверке.
  constructor({ traits, catalog, settings, rand = Math.random }) {
    this.traits = traits;
    this.#catalog = catalog;
    this.#settings = settings;
    this.#rand = rand;
  }

  trait(id) {
    return this.traits.find((t) => t.id === id);
  }

  // Значения для выпадающего списка: [{ id, title }]. Цвет и да/нет — null (свободный ввод).
  values(traitId) {
    const t = this.trait(traitId);
    if (!t) return null;
    if (t.type === 'item') return this.#catalog.items(t.category).map((it) => ({ id: it.id, title: it.title }));
    if (t.type === 'choice') return Object.entries(t.values).map(([id, v]) => ({ id, title: v?.title ?? id }));
    return null;
  }

  // Значение по умолчанию до того, как признак появился.
  empty(t) {
    return t.type === 'bool' ? false : null;
  }

  valid(traitId, value) {
    const t = this.trait(traitId);
    if (!t) return false;
    // Пусто можно у признака, который появляется не сразу или может не быть; у да/нет пусто не бывает.
    if (value === null) return t.type !== 'bool' && (t.optional || t.appears !== 'firstSeen');
    if (t.type === 'item') return typeof value === 'string' && !!this.#catalog.item(t.category, value);
    if (t.type === 'choice') return typeof value === 'string' && Object.hasOwn(t.values, value);
    if (t.type === 'color') return typeof value === 'string' && !!hexToRgb(value) && value.length === 7;
    if (t.type === 'bool') return typeof value === 'boolean';
    return false;
  }

  // Веса по умолчанию: из описаний предметов (weight) или значений choice (weight), иначе 1.
  defaultWeights(traitId) {
    const t = this.trait(traitId);
    if (!t) return {};
    if (t.type === 'item') return Object.fromEntries(this.#catalog.items(t.category).map((it) => [it.id, it.weight ?? 1]));
    if (t.type === 'choice') return Object.fromEntries(Object.entries(t.values).map(([id, v]) => [id, v?.weight ?? 1]));
    return {};
  }

  // Веса с поправками из настроек (окно «Рэдкасць»): settings.weights[key][значение].
  // Значение, которого нет в каталоге, из настроек не попадает.
  weights(key, defaults) {
    const over = this.#settings.get().weights?.[key] ?? {};
    const out = {};
    for (const [id, w] of Object.entries(defaults)) out[id] = typeof over[id] === 'number' ? over[id] : w;
    return out;
  }

  traitWeights(traitId) {
    return this.weights(traitId, this.defaultWeights(traitId));
  }

  // Категории окна «Рэдкасць» от признаков: [{ key, title, values: [{ id, title, default, weight }] }].
  weightCategories() {
    return this.traits
      .filter((t) => t.pick === 'weights')
      .map((t) => {
        const defaults = this.defaultWeights(t.id);
        const weights = this.weights(t.id, defaults);
        const titles = Object.fromEntries((this.values(t.id) ?? []).map((v) => [v.id, v.title]));
        return {
          key: t.id,
          title: t.title,
          values: Object.keys(defaults).map((id) => ({ id, title: titles[id] ?? id, default: defaults[id], weight: weights[id] })),
        };
      });
  }

  // Ступень по месяцам подписки: последняя, чей порог ≤ месяцев. Нет — null.
  tierValue(traitId, months) {
    const tiers = (this.#settings.get().tiers?.[traitId] ?? []).filter((s) => this.valid(traitId, s.value));
    let value = null;
    for (const s of [...tiers].sort((a, b) => a.months - b.months)) if (months >= s.months) value = s.value;
    return value;
  }

  // Новое значение признака. current — нынешнее (при смене за баллы — другое, если есть из чего);
  // taken — цвета героев на экране (для «дальнего цвета»); months — для ступеней.
  pick(traitId, { current, taken = [], months = 0 } = {}) {
    const t = this.trait(traitId);
    if (!t) return null;
    if (t.pick === 'weights') {
      const w = this.traitWeights(traitId);
      if (current != null && Object.entries(w).some(([id, x]) => id !== current && x > 0)) delete w[current];
      return pickWeighted(w, this.#rand);
    }
    if (t.pick === 'farColor') return farColor(taken.filter((c) => c && c !== current), this.#rand, this.#settings.get().colors);
    if (t.pick === 'tiers') return this.tierValue(traitId, months);
    return this.empty(t);
  }

  // Признаки нового героя: появляющиеся при первом появлении — выбираются, остальные — пусто.
  newHero(taken = []) {
    const traits = {};
    for (const t of this.traits) traits[t.id] = t.appears === 'firstSeen' ? this.pick(t.id, { taken }) : this.empty(t);
    return traits;
  }

  // Починить признаки: нет признака или значение пропало из каталога — выбрать заново
  // (появляющиеся при первом появлении) или обнулить. Возвращает список исправленных.
  repair(traits, taken = []) {
    const fixed = [];
    for (const t of this.traits) {
      const v = traits[t.id];
      if (v !== undefined && this.valid(t.id, v)) continue;
      traits[t.id] = t.appears === 'firstSeen' ? this.pick(t.id, { taken }) : this.empty(t);
      fixed.push(t.id);
    }
    return fixed;
  }

  // Для оверлея и админки.
  toClient() {
    return this.traits;
  }
}
