// Кто сейчас на экране, кто ждёт в очереди, рейд. Сервер решает — оверлей только рисует.
// Источник событий любой: тестовая панель сейчас, Twitch в задачах 4–5.
// Сервер подписывается на события и пересылает их оверлею:
// - 'join' (viewer, entrance) — персонаж выходит на экран, entrance — способ появления;
// - 'leave' (viewer) — уходит с экрана;
// - 'queue' (список) — очередь изменилась;
// - 'character', 'unknownCharacter' — см. методы;
// - 'act' (viewer, action, params) — действие у персонажа (реакция, сцена, облако с текстом).
import { EventEmitter } from 'node:events';

// Случайное имя по весам: { edge: 1, poof: 2 } → 'poof' в два раза чаще.
function weighted(weights, rand) {
  const entries = Object.entries(weights ?? {}).filter(([, w]) => typeof w === 'number' && w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [name, w] of entries) {
    if ((r -= w) < 0) return name;
  }
  return entries.at(-1)?.[0] ?? 'poof';
}

export class Viewers extends EventEmitter {
  #onScreen = new Map();
  // Map хранит порядок добавления — первый добавленный выходит первым.
  #queue = new Map();
  #raiders = new Map();
  #raidTimer = null;
  #raidCount = 0;
  #lastRaidAt = -Infinity;
  #store;
  #opts;

  // store — закрепление зритель → персонаж (store.js).
  // options: config() — текущие настройки ({ maxOnScreen, entrances, raid }; читаются в момент использования,
  // поэтому правка из админки действует сразу); characters() — имена персонажей каталога (для рейдеров);
  // now, rand, setTimeout, clearTimeout — подменяются в проверке.
  constructor(store, options = {}) {
    super();
    this.#store = store;
    this.#opts = {
      config: () => ({}),
      characters: () => [],
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
    return weighted(entrances, rand);
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

  // viewer = { id, name }. id — ключ (в задаче 4 станет user_id Twitch), name — ник как есть.
  // Место на экране есть — выходит; нет — в очередь. Уже на экране или в очереди — false.
  // character = null, если каталог пуст.
  join({ id, name }) {
    if (this.#onScreen.has(id) || this.#queue.has(id)) return false;
    const viewer = { id, name, character: this.#store.characterFor({ id, name }) };
    if (this.#onScreen.size < this.#cfg().maxOnScreen) {
      this.#show(viewer);
    } else {
      this.#queue.set(id, viewer);
      this.emit('queue', this.queue());
    }
    return true;
  }

  // Смена персонажа: тестовая панель сейчас, команда `!перс` в задаче 5.
  // Работает и для зрителя не на экране — выбор запоминается до его появления.
  // Имя не из каталога — ничего не меняется, событие 'unknownCharacter'.
  choose({ id, name }, characterName) {
    const character = this.#store.setCharacter({ id, name }, characterName);
    if (!character) {
      this.emit('unknownCharacter', { id, name }, characterName);
      return false;
    }
    const queued = this.#queue.get(id);
    if (queued) {
      queued.character = character;
      this.emit('queue', this.queue());
    }
    const viewer = this.#onScreen.get(id);
    if (viewer && viewer.character !== character) {
      viewer.character = character;
      this.emit('character', viewer);
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

  // Рейд: канал-рейдер и число зрителей. Спускаются min(count, raid.maxCount) безымянных персонажей
  // со случайными дизайнами, над каждым — ник канала. В лимит зрителей не входят, в store не пишутся.
  // Новый рейд, пока гуляют прошлые рейдеры, — прошлые уходят: на экране не больше raid.maxCount рейдеров.
  // Возвращает, сколько спустилось.
  raid(channel, count) {
    const { characters, rand, now } = this.#opts;
    const { raid } = this.#cfg();
    const n = Math.min(Math.floor(count), raid.maxCount);
    if (!channel || !(n > 0)) return 0;
    this.#endRaid();
    this.#lastRaidAt = now();
    const raidId = ++this.#raidCount;
    const names = characters();
    for (let i = 0; i < n; i++) {
      const character = names.length ? names[Math.floor(rand() * names.length)] : null;
      const raider = { id: `raid-${raidId}-${i}`, name: channel, character, raider: true };
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
