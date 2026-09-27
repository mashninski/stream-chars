// Движок сцен: спецдействия классов, общие действия, «первое слово». Модуль без браузера — прогоняется в Node.
//
// Сцена — файл public/js/scenes/<класс|common>/<имя>.js:
//   export const meta = { title: 'Фаербол', weight: 1, cases: { … } };
//   export function* run(s) { … }   — шаги по времени: yield ждёт (секунды, движение, условие)
// Программа отдаёт список сцен по содержимому папки — новый файл подхватывается сам.
//
// Правила (claude/heroes-spec.md, «Правила сцен»):
// - участник сцены занят: в другую сцену не берётся, своя ходьба на паузе;
// - запустивший занят — действие ждёт в его очереди; одновременно не больше world.scenes.maxConcurrent сцен;
// - зритель ушёл посреди сцены — она доигрывает, но не дольше world.scenes.leaveWaitSeconds, потом прерывается;
// - цели и случаи выбираются по зерну от программы — два оверлея показывают одно и то же.
import { seeded, pickWeighted } from './random.js';
import { AFFECTS } from './actor.js';

// Ожидание: done() — готово ли; update(dt) — если само что-то двигает; result — что вернуть в сцену.
function waitSeconds(t) {
  let left = t;
  return { update: (dt) => (left -= dt), done: () => left <= 0 };
}

function toWaitable(v) {
  if (v == null) return { done: () => true };
  if (typeof v === 'number') return waitSeconds(v);
  if (Array.isArray(v)) {
    const list = v.map(toWaitable);
    return { update: (dt) => list.forEach((w) => w.update?.(dt)), done: () => list.every((w) => w.done()) };
  }
  if (typeof v.done === 'function') return v;
  return { done: () => true, result: v };
}

let thingCounter = 0;

class Scene {
  constructor(manager, { id, module, actor, seed, params, info }) {
    this.manager = manager;
    this.id = id;
    this.actor = actor;
    this.seed = seed;
    this.params = params ?? {};
    this.info = info ?? {};
    this.rand = seeded(seed);
    this.participants = new Set([actor]);
    this.things = new Set();
    this.effects = new Set();
    this.moves = new Map(); // сущность → движение (одно на сущность)
    this.time = 0;
    this.finished = false;
    this.api = makeApi(this);
    this.take(actor);
    this.gen = module.run(this.api);
    this.wait = null;
  }

  take(actor) {
    if (actor.scene && actor.scene !== this) return false;
    actor.scene = this;
    actor.affect = null;
    actor.reaction = null;
    actor.queue = [];
    actor.sceneAnim = { name: 'idle', time: 0 };
    actor.setState('scene');
    this.participants.add(actor);
    return true;
  }

  release(actor) {
    if (actor.scene !== this) return;
    actor.scene = null;
    actor.sceneAnim = null;
    actor.held = {};
    actor.alpha = undefined;
    actor.y = Math.max(0, actor.y);
    this.participants.delete(actor);
    if (actor.state === 'scene') actor.idle();
  }

  step(dt) {
    if (this.finished) return;
    this.time += dt;
    for (const [entity, move] of this.moves) {
      move.update(dt);
      if (move.done()) this.moves.delete(entity);
    }
    for (const t of this.things) {
      t.time += dt;
    }
    for (const e of this.effects) {
      e.time += dt;
      if (e.duration !== undefined && e.time >= e.duration) this.effects.delete(e);
    }
    if (this.wait) {
      this.wait.update?.(dt);
      if (!this.wait.done()) return;
    }
    // Шаги без ожидания идут подряд в одном кадре; предел — от бесконечного цикла в сценарии.
    for (let guard = 0; guard < 200; guard++) {
      const resume = this.wait?.result;
      this.wait = null;
      const { value, done } = this.gen.next(resume);
      if (done) return this.finish();
      this.wait = toWaitable(value);
      if (!this.wait.done()) return;
    }
    throw new Error('сцэна не чакае ні кроку (бясконцы цыкл?)');
  }

  // Конец или обрыв: реквизит и эффекты убираются, участники свободны.
  finish() {
    if (this.finished) return;
    this.finished = true;
    try {
      this.gen.return?.();
    } catch {}
    for (const a of [...this.participants]) this.release(a);
    this.things.clear();
    this.effects.clear();
    this.moves.clear();
  }
}

// API сцены: маленький и общий. Сущность — герой (Actor) или вещь сцены (spawn).
function makeApi(scene) {
  const m = scene.manager;
  const world = m.world;
  const isActor = (e) => e && typeof e.applyAffect === 'function';
  const speedOf = (o, def) => o?.speed ?? def;
  const setAnim = (e, name) => {
    if (!name) return;
    if (isActor(e)) {
      if (e.sceneAnim?.name !== name) e.sceneAnim = { name, time: 0 };
    } else if (e.anim !== name) {
      e.anim = name;
      e.time = 0;
    }
  };

  const s = {
    world,
    params: scene.params,
    get me() {
      return scene.actor;
    },
    get time() {
      return scene.time;
    },
    // ----- случайность по зерну -----
    rand: () => scene.rand(),
    between: (a, b) => a + (b - a) * scene.rand(),
    chance: (p) => scene.rand() < p,
    pick: (list) => (list.length ? list[Math.floor(scene.rand() * list.length)] : undefined),
    // Случай по весам: meta.cases[имя] (веса — от программы, с поправками из окна «Рэдкасць»).
    weighted(caseName) {
      return pickWeighted(scene.info.cases?.[caseName] ?? {}, scene.rand);
    },
    // ----- экран -----
    // x в пределах полосы, по которой ходят.
    clampX: (x) => Math.min(world.strip.right, Math.max(world.strip.left, x)),
    // Ближайший к x край: { side: -1 левый / 1 правый, off — x за краем (герой скрыт), in — x у края внутри }.
    edgeNear(x = scene.actor.x, off = 80) {
      const side = x < world.width / 2 ? -1 : 1;
      return { side, off: side < 0 ? -off : world.width + off, in: side < 0 ? world.strip.left : world.strip.right };
    },
    edgeFar(x = scene.actor.x, off = 80) {
      return s.edgeNear(world.width - x, off);
    },
    // ----- цели -----
    // Свободные герои на экране (кроме запустившего), в порядке id — одинаково в разных оверлеях.
    others() {
      return m.freeActors().filter((a) => a !== scene.actor);
    },
    nearest(n = 1, { from = scene.actor.x, max = Infinity } = {}) {
      return s.others()
        .map((a) => [a, Math.abs(a.x - from)])
        .filter(([, d]) => d <= max)
        .sort((x, y) => x[1] - y[1] || (x[0].id < y[0].id ? -1 : 1))
        .slice(0, n)
        .map(([a]) => a);
    },
    randomOne() {
      return s.pick(s.others());
    },
    inRadius(x, r) {
      return s.others().filter((a) => Math.abs(a.x - x) <= r);
    },
    // Взять героя в сцену (стоит и слушается сцену). false — занят.
    take(actor) {
      return !!actor && (actor.free || actor.scene === scene) && scene.take(actor);
    },
    release(actor) {
      scene.release(actor);
    },
    // ----- движение -----
    // Идти к x (анимация walk или своя); ожидание — до прихода.
    walk(e, x, o = {}) {
      const speed = speedOf(o, world.walkSpeed);
      setAnim(e, o.anim ?? 'walk');
      if (x !== e.x) e.facing = Math.sign(x - e.x);
      const move = {
        update(dt) {
          const rest = x - e.x;
          const step = speed * dt;
          e.x = Math.abs(rest) <= step ? x : e.x + Math.sign(rest) * step;
          if (o.backwards) e.facing = -Math.sign(rest) || e.facing;
        },
        done: () => e.x === x,
      };
      scene.moves.set(e, move);
      return { done: () => e.x === x || scene.moves.get(e) !== move };
    },
    run(e, x, o = {}) {
      return s.walk(e, x, { anim: 'run', speed: world.walkSpeed * 3, ...o });
    },
    // Полёт по дуге за time с: к x, на высоту y (над землёй), arc — подъём в середине.
    fly(e, { x = e.x, y = 0, time = 1, arc = 0, anim } = {}) {
      setAnim(e, anim);
      const x0 = e.x, y0 = e.y ?? 0;
      let t = 0;
      const move = {
        update(dt) {
          t = Math.min(time, t + dt);
          const k = t / time;
          e.x = x0 + (x - x0) * k;
          e.y = y0 + (y - y0) * k + 4 * arc * k * (1 - k);
        },
        done: () => t >= time,
      };
      scene.moves.set(e, move);
      return { done: () => move.done() || scene.moves.get(e) !== move };
    },
    // Падение с ускорением до земли.
    fall(e, { anim = 'fall' } = {}) {
      setAnim(e, anim);
      let vy = 0;
      const move = {
        update(dt) {
          vy += world.fallGravity * dt;
          e.y = Math.max(0, (e.y ?? 0) - vy * dt);
        },
        done: () => (e.y ?? 0) <= 0,
      };
      scene.moves.set(e, move);
      return { done: () => move.done() };
    },
    stop(e) {
      scene.moves.delete(e);
    },
    place(e, x, y = e.y ?? 0) {
      scene.moves.delete(e);
      e.x = x;
      e.y = y;
    },
    face(e, target) {
      const x = typeof target === 'number' ? target : target.x;
      if (x !== e.x) e.facing = Math.sign(x - e.x);
    },
    // ----- анимация и вид -----
    anim: setAnim,
    // Проиграть анимацию seconds с (не указано — одно проигрывание, для зацикленной — 1 с).
    play(e, name, seconds) {
      setAnim(e, name);
      if (isActor(e)) e.sceneAnim.time = 0;
      else e.time = 0;
      return waitSeconds(seconds ?? m.animLength(e, name) ?? 1);
    },
    alpha(e, a) {
      e.alpha = a;
    },
    hold(actor, ref, anchor = 'handR') {
      actor.held = { ...actor.held, [anchor]: ref };
    },
    drop(actor, anchor) {
      if (anchor) {
        const held = { ...actor.held };
        delete held[anchor];
        actor.held = held;
      } else actor.held = {};
    },
    // Облако с текстом; seconds — держать дольше обычного (сцена «первое слово»).
    say(actor, text, seconds) {
      const ok = actor.say(text);
      if (ok && seconds) actor.bubble.duration = Math.max(actor.bubble.duration, seconds);
      return ok;
    },
    // Свет за героем и крупный ник на seconds (герой обращает на себя внимание).
    highlight(actor, seconds = 3) {
      actor.highlight = { time: 0, duration: seconds };
    },
    // Ник выплывает из облака и встаёт над головой (сцена «первое слово»).
    showName(actor, seconds = 1.5) {
      actor.nameFloat = { time: 0, duration: seconds };
      actor.traits = { ...actor.traits, nameShown: true };
      return {
        update: (dt) => {
          if (actor.nameFloat) actor.nameFloat.time += dt;
        },
        done: () => !actor.nameFloat || actor.nameFloat.time >= seconds,
      };
    },
    // ----- вещи сцены (реквизит, существа) -----
    // ref — 'creatures/sheep', 'props/barrel'. Вещь исчезает с концом сцены.
    spawn(ref, { x = scene.actor.x, y = 0, facing = 1, anim = 'idle', alpha } = {}) {
      const [category, id] = String(ref).split('/');
      const t = { key: `t${++thingCounter}`, category, id, x, y, facing, anim, time: 0, alpha, rot: 0 };
      scene.things.add(t);
      return t;
    },
    remove(t) {
      scene.things.delete(t);
      scene.moves.delete(t);
    },
    // ----- эффекты (render.js → EFFECTS) -----
    // at — сущность (эффект следует за ней; точка — её середина, dy — выше неё, px),
    // или x, y — точка на экране (y — высота над землёй, px). time — сколько длится (нет — до конца сцены).
    effect(name, { at, x, y = 0, dy = 0, time, data } = {}) {
      const e = { name, at, x, y, dy, time: 0, duration: time, data };
      scene.effects.add(e);
      return e;
    },
    stopEffect(e) {
      scene.effects.delete(e);
    },
    // ----- реакции целей (AFFECTS в actor.js) -----
    // Цель отпускается из сцены и реагирует; ожидание — до конца реакции.
    affect(actor, name, params = {}) {
      if (!actor || !AFFECTS[name]) return { done: () => true };
      // Чужой участник или занятый — не трогаем.
      if (actor.scene !== scene && !actor.free) return { done: () => true };
      scene.participants.delete(actor);
      actor.held = {};
      actor.alpha = undefined;
      actor.scene = null;
      actor.applyAffect(name, params);
      return { done: () => actor.state !== name || actor.gone };
    },
    // Ждать условия, не дольше timeout с. Результат — что вернула функция (или null по времени).
    until(fn, timeout = Infinity) {
      let t = 0;
      const w = {
        result: null,
        update(dt) {
          t += dt;
        },
        done() {
          const r = fn();
          if (r) {
            w.result = r;
            return true;
          }
          return t >= timeout;
        },
      };
      return w;
    },
    all: (...list) => list.flat(),
  };
  return s;
}

export class SceneManager {
  // world — настройки оверлея (scenes.maxConcurrent, leaveWaitSeconds…);
  // actors() — герои на экране (Map или массив); load(id) → Promise модуля сцены;
  // animLength(entity, anim) — длина анимации, с; log — куда писать ошибки.
  constructor({ world, actors, load, animLength = () => undefined, log = console }) {
    this.world = world;
    this.actors = actors;
    this.load = load;
    this.animLength = animLength;
    this.log = log;
    this.running = [];
    this.queue = []; // { actorId, id, seed, params }
    this.modules = new Map(); // id → модуль | 'loading' | 'error'
    this.info = new Map(); // id → { title, cases } — список сцен от программы
  }

  // Список сцен от программы: [{ id, title, kind, cls, cases: { имя: { значение: вес } } }].
  setList(list) {
    this.info = new Map((list ?? []).map((sc) => [sc.id, sc]));
  }

  has(id) {
    return this.info.has(id);
  }

  #actorList() {
    const a = this.actors();
    return [...(a.values ? a.values() : a)];
  }

  freeActors() {
    return this.#actorList()
      .filter((a) => a.free && a.visible && !a.gone)
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  // Запросить сцену у героя. Ждёт в очереди, пока герой занят или сцен уже много.
  request(actorId, id, seed, params = {}) {
    this.queue.push({ actorId, id, seed: seed >>> 0, params });
    this.#ensureLoaded(id);
  }

  #ensureLoaded(id) {
    if (this.modules.has(id)) return;
    this.modules.set(id, 'loading');
    Promise.resolve()
      .then(() => this.load(id))
      .then((mod) => {
        if (typeof mod?.run !== 'function') throw new Error('няма функцыі run');
        this.modules.set(id, mod);
      })
      .catch((err) => {
        this.modules.set(id, 'error');
        this.log.error?.(`[сцэна] «${id}» не загрузілася: ${err.message}`);
      });
  }

  // Готовый модуль сцены (для проверок — положить заранее).
  preload(id, mod) {
    this.modules.set(id, mod);
  }

  #start(req, actor, mod) {
    const scene = new Scene(this, { id: req.id, module: mod, actor, seed: req.seed, params: req.params, info: this.info.get(req.id) });
    this.running.push(scene);
    return scene;
  }

  tick(dt) {
    const byId = new Map(this.#actorList().map((a) => [a.id, a]));
    // Идущие сцены: шаг; ушёл участник и ждёт дольше предела — обрыв.
    const limit = this.world.scenes?.leaveWaitSeconds ?? 20;
    for (const scene of this.running) {
      try {
        if ([...scene.participants].some((a) => a.gone || (a.pendingLeave && a.leaveWait >= limit))) scene.finish();
        else scene.step(dt);
      } catch (err) {
        this.log.error?.(`[сцэна] «${scene.id}»: ${err.message}`);
        scene.finish();
      }
    }
    this.running = this.running.filter((s) => !s.finished);
    // Очередь: по порядку, у каждого героя — только первое его действие.
    const max = this.world.scenes?.maxConcurrent ?? 3;
    const seen = new Set();
    for (let i = 0; i < this.queue.length; i++) {
      const req = this.queue[i];
      const actor = byId.get(req.actorId);
      const mod = this.modules.get(req.id);
      // Героя нет на экране (ушёл) или сцена не загрузилась — действие снимается
      // (ждать появления зрителя — забота программы, src/viewers.js).
      if (!actor || actor.gone || mod === 'error') {
        this.log.info?.(`[сцэна] «${req.id}» не будзе: ${mod === 'error' ? 'не загрузілася' : 'героя няма на экране'}`);
        this.queue.splice(i--, 1);
        continue;
      }
      if (seen.has(req.actorId)) continue;
      seen.add(req.actorId);
      if (this.running.length >= max || typeof mod !== 'object' || !actor.free || !actor.visible) continue;
      this.queue.splice(i--, 1);
      try {
        this.#start(req, actor, mod);
      } catch (err) {
        this.log.error?.(`[сцэна] «${req.id}» не запусцілася: ${err.message}`);
      }
    }
  }

  // Что рисовать: вещи и эффекты всех идущих сцен.
  things() {
    return this.running.flatMap((s) => [...s.things]);
  }

  effects() {
    return this.running.flatMap((s) => [...s.effects]);
  }

  // Сколько ждёт в очереди (для админки и проверок).
  get waiting() {
    return this.queue.length;
  }
}
