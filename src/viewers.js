// Кто сейчас на экране, кто ждёт в очереди, рейд. Сервер решает — оверлей только рисует.
// Источник событий любой: тестовая панель сейчас, Twitch в задачах 4–5.
// Сервер подписывается на события и пересылает их оверлею:
// - 'join' (viewer, entrance) — персонаж выходит на экран, entrance — способ появления;
// - 'leave' (viewer) — уходит с экрана;
// - 'queue' (список) — очередь изменилась;
// - 'traits' (viewer) — у героя на экране поменялись признаки;
// - 'act' (viewer, action, params) — действие у персонажа (реакция, сцена, облако с текстом).
import { EventEmitter } from 'node:events';
import { pickWeighted } from '../public/js/random.js';

export class Viewers extends EventEmitter {
  #onScreen = new Map();
  // Map хранит порядок добавления — первый добавленный выходит первым.
  #queue = new Map();
  #raiders = new Map();
  #raidTimer = null;
  #raidCount = 0;
  #lastRaidAt = -Infinity;
  #store;
  #heroes;
  #opts;

  // store — герои зрителей (store.js), heroes — признаки (heroes.js).
  // options: config() — текущие настройки ({ maxOnScreen, entrances, raid }; читаются в момент использования,
  // поэтому правка из админки действует сразу); now, rand, setTimeout, clearTimeout — подменяются в проверке.
  constructor(store, heroes, options = {}) {
    super();
    this.#store = store;
    this.#heroes = heroes;
    this.#opts = {
      config: () => ({}),
      now: Date.now,
      rand: Math.random,
      setTimeout,
      clearTimeout,
      ...options,
    };
  }

  // Настройки со значениями по умолчанию.
  #cfg() {
    const c = this.#opts.config();
    return {
      maxOnScreen: c.maxOnScreen ?? 30,
      entrances: c.entrances ?? { edge: 1, poof: 1, fall: 1 },
      raid: { maxCount: 15, staySeconds: 300, parachuteWindowSeconds: 300, ...c.raid },
    };
  }

  // Способ появления: в окне после рейда — парашют, иначе случайный по весам из config.json.
  #entrance() {
    const { now, rand } = this.#opts;
    const { raid, entrances } = this.#cfg();
    if (now() - this.#lastRaidAt < raid.parachuteWindowSeconds * 1000) return 'parachute';
    return pickWeighted(entrances, rand) ?? 'poof';
  }

  #show(viewer) {
    this.#onScreen.set(viewer.id, viewer);
    this.emit('join', viewer, this.#entrance());
  }

  // Освободилось место — выходят первые из очереди.
  #promote() {
    let moved = false;
    while (this.#onScreen.size < this.#cfg().maxOnScreen && this.#queue.size) {
      const [id, viewer] = this.#queue.entries().next().value;
      this.#queue.delete(id);
      this.#show(viewer);
      moved = true;
    }
    if (moved) this.emit('queue', this.queue());
  }

  // Цвета героев на экране (зрители и рейдеры) — для «дальнего цвета».
  takenColors() {
    return this.list().map((v) => v.traits?.color).filter(Boolean);
  }

  // viewer = { id, name }. id — user_id Twitch (тестовые — «test:<нік>»), name — ник как есть.
  // Героя назначает хранилище при первом появлении. Место на экране есть — выходит; нет — в очередь.
  // Уже на экране или в очереди — false.
  join({ id, name }) {
    if (this.#onScreen.has(id) || this.#queue.has(id)) return false;
    const entry = this.#store.heroFor({ id, name }, this.takenColors());
    const viewer = { id, name, traits: { ...entry.traits } };
    if (this.#onScreen.size < this.#cfg().maxOnScreen) {
      this.#show(viewer);
    } else {
      this.#queue.set(id, viewer);
      this.emit('queue', this.queue());
    }
    return true;
  }

  // Зритель на экране или в очереди — объект viewer, иначе undefined.
  find(id) {
    return this.#onScreen.get(id) ?? this.#queue.get(id);
  }

  onScreen(id) {
    return this.#onScreen.has(id);
  }

  // Поменять признак героя (админка, баллы, Twitch). Работает и для зрителя не на экране —
  // запоминается до его появления. Неверное значение — false.
  setTrait(id, traitId, value) {
    if (!this.#store.setTrait(id, traitId, value)) return false;
    const viewer = this.find(id);
    if (viewer && viewer.traits[traitId] !== value) {
      viewer.traits[traitId] = value;
      if (this.#queue.has(id)) this.emit('queue', this.queue());
      else this.emit('traits', viewer);
    }
    return true;
  }

  // Ушёл из очереди — просто убираем; ушёл с экрана — на его место первый из очереди.
  leave(id) {
    if (this.#queue.delete(id)) {
      this.emit('queue', this.queue());
      return true;
    }
    const viewer = this.#onScreen.get(id);
    if (!viewer) return false;
    this.#onScreen.delete(id);
    this.emit('leave', viewer);
    this.#promote();
    return true;
  }

  // Действие у персонажа — общий путь для всех источников (чат, награда, панель).
  // action — имя реакции или сцены, params — { text?, seed? }. Какое действие у какого источника —
  // в настройках ("triggers"), источник не знает, какие действия есть. Пока только у тех, кто на экране.
  act(id, action, params = {}) {
    const viewer = this.#onScreen.get(id);
    if (!viewer) return false;
    this.emit('act', viewer, action, params);
    return true;
  }

  // Рейд: канал-рейдер и число зрителей. Спускаются min(count, raid.maxCount) безымянных героев
  // (случайный класс, пол и цвет, без убора и крыльев), над каждым — ник канала.
  // В лимит зрителей не входят, в store не пишутся.
  // Новый рейд, пока гуляют прошлые рейдеры, — прошлые уходят: на экране не больше raid.maxCount рейдеров.
  // Возвращает, сколько спустилось.
  raid(channel, count) {
    const { now } = this.#opts;
    const { raid } = this.#cfg();
    const n = Math.min(Math.floor(count), raid.maxCount);
    if (!channel || !(n > 0)) return 0;
    this.#endRaid();
    this.#lastRaidAt = now();
    const raidId = ++this.#raidCount;
    for (let i = 0; i < n; i++) {
      const traits = this.#heroes.newHero(this.takenColors());
      traits.nameShown = true;
      const raider = { id: `raid-${raidId}-${i}`, name: channel, traits, raider: true };
      this.#raiders.set(raider.id, raider);
      this.emit('join', raider, 'parachute');
    }
    this.#raidTimer = this.#opts.setTimeout(() => this.#endRaid(), raid.staySeconds * 1000);
    return n;
  }

  #endRaid() {
    if (this.#raidTimer) this.#opts.clearTimeout(this.#raidTimer);
    this.#raidTimer = null;
    for (const raider of this.#raiders.values()) this.emit('leave', raider);
    this.#raiders.clear();
  }

  get raidStaySeconds() {
    return this.#cfg().raid.staySeconds;
  }

  // Настройки поменялись: лимит мог вырасти — выпустить ждущих из очереди.
  refresh() {
    this.#promote();
  }

  // Все, кто на экране: зрители и рейдеры (у рейдера raider: true).
  list() {
    return [...this.#onScreen.values(), ...this.#raiders.values()];
  }

  queue() {
    return [...this.#queue.values()];
  }
}
