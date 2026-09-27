// Действия программы — общий путь для всех источников: чат, награды за баллы, админка, тестовая панель.
// Источник называет действие строкой; что она значит — здесь:
//   'jump' (и другие REACTIONS из actor.js) — реакция поверх того, что герой делает;
//   '<папка>/<сцена>' — сцена (public/js/scenes/…), например 'common/wave', 'mage/fireball';
//   'special'         — случайное спецдействие своего класса по весам;
//   'reroll:<признак>' — случайное другое значение признака (класс, пол, цвет, убор) + сцена triggers.change.
// Какое действие у какого источника — в настройках (triggers, rewards), не в коде источника.
import { REACTIONS } from '../public/js/actor.js';
import { log } from './log.js';

export class Actions {
  #viewers;
  #store;
  #heroes;
  #scenes;
  #settings;
  #rand;

  constructor({ viewers, store, heroes, scenes, settings, rand = Math.random }) {
    this.#viewers = viewers;
    this.#store = store;
    this.#heroes = heroes;
    this.#scenes = scenes;
    this.#settings = settings;
    this.#rand = rand;
  }

  // Все действия, которые можно назначить источнику: [{ id, title }] — для админки и проверки настроек.
  list() {
    const out = [
      ...Object.keys(REACTIONS).map((id) => ({ id, title: id === 'jump' ? 'Скок' : id })),
      { id: 'special', title: 'Спецдзеянне свайго класа (выпадковае па вагах)' },
      ...this.#heroes.traits.filter((t) => t.points).map((t) => ({ id: `reroll:${t.id}`, title: `Змяніць: ${t.title.toLowerCase()}` })),
      ...this.#scenes.actions().map((s) => ({ id: s.id, title: s.title })),
    ];
    for (const cls of this.#heroes.values('class') ?? []) {
      for (const s of this.#scenes.specials(cls.id)) out.push({ id: s.id, title: `${cls.title}: ${s.title}` });
    }
    return out;
  }

  known(action) {
    if (!action) return false;
    if (REACTIONS[action] || action === 'special' || this.#scenes.get(action)) return true;
    const [kind, trait] = action.split(':');
    return kind === 'reroll' && !!this.#heroes.trait(trait);
  }

  // Выполнить действие у зрителя id. wait — зритель не на экране: сцена ждёт его появления.
  // Ответ: { ok, text } — text для журнала и админки.
  perform(id, action, params = {}, { wait = false } = {}) {
    const entry = this.#store.get(id);
    const viewer = this.#viewers.find(id) ?? (entry && { id, name: entry.name, traits: entry.traits });
    if (!viewer) return { ok: false, text: 'такога гледача няма' };
    if (!this.known(action)) return { ok: false, text: `невядомае дзеянне «${action}»` };

    if (action === 'special') {
      const scene = this.#scenes.pickSpecial(viewer.traits?.class, this.#rand);
      if (!scene) return { ok: false, text: `у класа «${viewer.traits?.class}» няма спецдзеянняў` };
      return this.perform(id, scene, params, { wait });
    }
    if (action.startsWith('reroll:')) {
      const trait = action.slice('reroll:'.length);
      const value = this.#heroes.pick(trait, { current: viewer.traits?.[trait], taken: this.#viewers.takenColors() });
      if (value == null || !this.#viewers.setTrait(id, trait, value)) return { ok: false, text: `няма з чаго выбраць «${trait}»` };
      this.#playChange(id, wait);
      return { ok: true, text: `${trait} → ${value}` };
    }
    const res = this.#viewers.act(id, action, params, { wait });
    if (!res) return { ok: false, text: `${viewer.name} няма на экране` };
    return { ok: true, text: res === 'waiting' ? `${action} — чакае, пакуль ${viewer.name} з'явіцца` : action };
  }

  // Поменять признак вручную (админка, тестовая панель) + сцена смены выгляда.
  setTrait(id, traitId, value) {
    if (!this.#viewers.setTrait(id, traitId, value)) return false;
    const t = this.#heroes.trait(traitId);
    if (t?.layer || t?.appears === 'firstSeen') this.#playChange(id, false);
    return true;
  }

  #playChange(id, wait) {
    const scene = this.#settings.get().triggers?.change;
    if (scene && this.#scenes.get(scene)) this.#viewers.act(id, scene, {}, { wait });
  }

  // Сообщение в чате. Первое за всё время (зритель на экране) — сцена «первое слово» (triggers.firstMessage)
  // и ник виден с этого момента; дальше — triggers.message и облако с текстом. Команды (!…) — без облака
  // и не «первое слово». Не на экране — ничего не играет. true — зритель на экране.
  message(id, text) {
    const entry = this.#store.get(id);
    if (!this.#viewers.onScreen(id) || !entry) return false;
    const triggers = this.#settings.get().triggers ?? {};
    const isCommand = String(text).trim().startsWith('!');
    if (!entry.flags.firstWord && !isCommand && triggers.firstMessage && this.#scenes.get(triggers.firstMessage)) {
      this.#store.setFlags(id, { firstWord: true });
      // Ник показывает сама сцена (выплывает из облака) — оверлею признак отдельно не шлём.
      this.#store.setTrait(id, 'nameShown', true);
      const viewer = this.#viewers.find(id);
      if (viewer) viewer.traits.nameShown = true;
      log.info(`[першае слова] ${entry.name}`);
      this.#viewers.act(id, triggers.firstMessage, { text });
      return true;
    }
    this.#viewers.act(id, triggers.message, { text });
    return true;
  }
}
