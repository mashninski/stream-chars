// Админка: состояние для док-панели и окон, команды из них.
// Команды приходят по тому же WebSocket, отдельным типом: { type: 'admin', id, cmd, ...args };
// ответ — { type: 'admin-reply', id, ok, error?, data? }. Другие модули (Twitch, награды) добавляют
// свои команды (command) и строки состояния (status) — этот файл про них не знает.
import { percentages } from '../public/js/random.js';

export class Admin {
  #commands = new Map();
  #status = new Map();
  #deps;

  // deps: settings, store, viewers, heroes, scenes, actions, log, clients() — сколько оверлеев и админок.
  constructor(deps) {
    this.#deps = deps;
    const { settings, heroes, actions, store } = deps;

    this.command('settings.set', ({ patch }) => settings.set(patch ?? {}));
    this.command('settings.reset', ({ path }) => settings.reset(String(path ?? '')));
    this.command('trait.set', ({ id, trait, value }) => {
      const t = heroes.trait(trait);
      if (!t?.admin) return { ok: false, error: `прыкмету «${trait}» з адмінкі не мяняюць` };
      let v = value === '' ? null : value;
      if (t.type === 'bool') v = v === true || v === 'true';
      if (!store.get(id)) return { ok: false, error: 'такога гледача няма' };
      return actions.setTrait(id, trait, v) ? { ok: true } : { ok: false, error: `няма значэння «${value}»` };
    });
    this.command('act', ({ id, action }) => {
      const r = actions.perform(id, String(action ?? ''), {}, { wait: true });
      deps.log.info(`[адмінка] ${store.get(id)?.name ?? id}: ${r.text}`);
      return r.ok ? { ok: true, data: r.text } : { ok: false, error: r.text };
    });
    // Веса одной или нескольких категорий: { weights: { ключ: { значение: вес } } }.
    this.command('weights.set', ({ weights }) => settings.set({ weights: weights ?? {} }));
    this.command('weights.reset', ({ key }) => settings.reset(`weights.${key}`));
    this.command('weights.get', () => ({ ok: true, data: this.weightCategories() }));
    this.command('viewers.list', () => ({ ok: true, data: this.viewers() }));
    this.command('log.get', () => ({ ok: true, data: deps.log.lines() }));
  }

  command(name, fn) {
    this.#commands.set(name, fn);
  }

  // Строка состояния в разделе «Стан»: fn() → { title, text, ok }.
  status(name, fn) {
    this.#status.set(name, fn);
  }

  async handle(msg) {
    const fn = this.#commands.get(msg.cmd);
    if (!fn) return { ok: false, error: `невядомая каманда «${msg.cmd}»` };
    try {
      const r = await fn(msg);
      return r ?? { ok: true };
    } catch (err) {
      this.#deps.log.error(`[адмінка] ${msg.cmd}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // Окно «Рэдкасць»: категории с весами и процентами.
  weightCategories() {
    const { heroes, scenes } = this.#deps;
    return [...heroes.weightCategories(), ...scenes.weightCategories()].map((c) => {
      const pct = percentages(Object.fromEntries(c.values.map((v) => [v.id, v.weight])));
      return { ...c, values: c.values.map((v) => ({ ...v, percent: pct[v.id] })) };
    });
  }

  // Строка окна «Персанажы».
  row(id) {
    const { store, viewers } = this.#deps;
    const e = store.get(id);
    if (!e) return null;
    return {
      id,
      name: e.name,
      online: viewers.onScreen(id),
      queued: !viewers.onScreen(id) && !!viewers.find(id),
      traits: e.traits,
      flags: e.flags,
      lastSeen: e.lastSeen,
      pending: viewers.pending(id),
    };
  }

  viewers() {
    return this.#deps.store.all().map((e) => this.row(e.id));
  }

  statusLines() {
    return [...this.#status].map(([name, fn]) => {
      try {
        return { name, ...fn() };
      } catch (err) {
        return { name, title: name, text: err.message, ok: false };
      }
    });
  }

  // Всё для док-панели при подключении.
  state() {
    const { settings, heroes, scenes, actions } = this.#deps;
    const classes = heroes.values('class') ?? [];
    return {
      settings: settings.get(),
      defaults: settings.defaults,
      status: this.statusLines(),
      actions: actions.list(),
      specials: Object.fromEntries(classes.map((c) => [c.id, scenes.specials(c.id).map((s) => ({ id: s.id, title: s.title }))])),
      commonActions: scenes.actions().map((s) => ({ id: s.id, title: s.title })),
      log: this.#deps.log.lines(),
    };
  }
}
