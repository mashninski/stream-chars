// Логика персонажа: где стоит, куда идёт, в каком состоянии. Ничего не рисует —
// рисование в render.js. Модуль без зависимостей от браузера: прогоняется в Node.
//
// Поведение собрано в три таблицы — новое поведение добавляется записью, остальной код не меняется:
// - STATES — состояния (стоит, идёт, падает…): какая анимация и что делать каждый кадр;
// - ENTRANCES — способы появления; какой выбрать, решает программа (config.json → "entrances");
// - REACTIONS — реакции поверх состояния (прыжок на сообщение): персонаж продолжает своё дело.
//
// x — середина персонажа по горизонтали, в пикселях экрана. y — высота над землёй (0 — стоит).
// facing: 1 — смотрит вправо, -1 — влево.

// Насколько далеко за край экрана уйти, чтобы персонаж точно скрылся.
const OFFSCREEN = 200;
// Откуда выходит из-за края: чуть за границей экрана.
const EDGE_START = 60;
// Шаг короче этого не делаем — выглядит как дёрганье на месте.
const MIN_STEP = 20;
// Длина одноразовой анимации, если у персонажа её нет (или лист ещё не загружен), с.
const DEFAULT_ANIM_TIME = 0.4;

function between([min, max], rand) {
  return min + (max - min) * rand();
}

// Состояния. Поля записи:
// - anim — анимация листа; fallback — какую взять, если у персонажа такой нет (дальше — idle, в render.js);
// - ground — стоит на земле: можно реагировать на сообщения и сразу уходить;
// - once — состояние длится одно проигрывание своей анимации, потом следующее из очереди (или idle);
// - effect — эффект, который рисует render.js (EFFECTS там), visible(a) — виден ли сам персонаж;
// - animOf(a) — анимация, если она зависит от персонажа (сцена, отброс);
// - update(a, dt) — что делать каждый кадр.
export const STATES = {
  idle: {
    anim: 'idle',
    ground: true,
    update(a) {
      if (a.stateTime >= a.pause) a.walk();
    },
  },
  walk: {
    anim: 'walk',
    ground: true,
    update(a, dt) {
      if (a.moveToTarget(dt)) a.idle();
    },
  },
  leave: {
    anim: 'walk',
    update(a, dt) {
      if (a.moveToTarget(dt)) a.setState('gone');
    },
  },
  // «Пух»: облачко, в середине которого персонаж возникает.
  poof: {
    anim: 'idle',
    effect: 'poof',
    visible: (a) => a.stateTime >= a.world.poofTime * 0.4,
    update(a) {
      if (a.stateTime >= a.world.poofTime) a.next();
    },
  },
  // Падение с ускорением.
  fall: {
    anim: 'fall',
    update(a, dt) {
      a.vy += a.world.fallGravity * dt;
      if (a.descend(a.vy * dt)) a.next();
    },
  },
  // Парашют: ровно и медленно.
  parachute: {
    anim: 'parachute',
    fallback: 'fall',
    update(a, dt) {
      if (a.descend(a.world.parachuteSpeed * dt)) a.next();
    },
  },
  land: { anim: 'land', once: true },
  shake: { anim: 'shake', once: true },
  gone: { anim: 'idle', visible: () => false },
  // В сцене: двигает и одевает сцена (scene-engine.js), своя ходьба на паузе.
  scene: {
    animOf: (a) => a.sceneAnim?.name ?? 'idle',
    update(a, dt) {
      if (a.sceneAnim) a.sceneAnim.time += dt;
    },
  },
};

// ---------- реакции соседей ----------
// Что сцена делает с целью: паника, отброс, сон… Общие для всех героев, одна таблица.
// Цель на время реакции занята (в другую сцену не берётся, своя ходьба на паузе), потом — idle.
// Поля: anim, fallback — анимация; effect — эффект над героем (render.js); time — сколько длится, с
// (по умолчанию; настройка — world.reactions[имя]); start(a, params), update(a, dt) — поведение;
// animOf(a) — анимация, если меняется по ходу; endless — кончается сама, не по времени.
// Новая реакция — запись здесь (своя анимация — строка в листах или запасная в body.json).
const away = (a) => (a.x >= (a.affect.from ?? a.x - 1) ? 1 : -1);

// Бег туда-сюда в пределах полосы: разворот у края или по таймеру.
function roam(a, dt, speed, turnEvery) {
  const { left, right } = a.world.strip;
  a.affect.turn = (a.affect.turn ?? turnEvery) - dt;
  if (a.affect.turn <= 0 || (a.facing < 0 && a.x <= left) || (a.facing > 0 && a.x >= right)) {
    a.facing = a.x <= left ? 1 : a.x >= right ? -1 : -a.facing;
    a.affect.turn = turnEvery * (0.6 + 0.8 * a.rand());
  }
  a.x = Math.min(right, Math.max(left, a.x + a.facing * speed * dt));
}

export const AFFECTS = {
  // Паника: бежит прочь от источника, у края разворачивается.
  panic: {
    anim: 'panic', fallback: 'run', effect: 'exclaim', time: 3,
    start(a) { a.facing = away(a); },
    update(a, dt) { roam(a, dt, a.world.walkSpeed * 2.6, 99); },
  },
  // Отброс: летит от источника, падает, лежит, встаёт.
  knocked: {
    anim: 'knocked', fallback: 'fall', effect: 'stars', time: 1.5, endless: true,
    animOf: (a) => ({ air: 'knocked', down: 'sleep', up: 'get_up' })[a.affect.phase],
    start(a, p) {
      a.affect.phase = 'air';
      a.affect.phaseTime = 0;
      a.affect.vx = away(a) * (p.power ?? 260) * (0.8 + 0.4 * a.rand());
      a.vy = -(p.lift ?? 420);
      a.facing = -Math.sign(a.affect.vx) || a.facing;
    },
    update(a, dt) {
      const f = a.affect;
      f.phaseTime += dt;
      if (f.phase === 'air') {
        const { left, right } = a.world.strip;
        a.x = Math.min(right, Math.max(left, a.x + f.vx * dt));
        a.vy += a.world.fallGravity * dt;
        if (a.descend(a.vy * dt)) {
          f.phase = 'down';
          f.phaseTime = 0;
        }
      } else if (f.phase === 'down' && f.phaseTime >= f.duration) {
        f.phase = 'up';
        f.phaseTime = 0;
      } else if (f.phase === 'up' && f.phaseTime >= (a.animLength(a.traits, 'get_up') ?? 0.8)) {
        a.idle();
      }
    },
  },
  // Сон — лежит, «z-z-z».
  sleep: { anim: 'sleep', effect: 'zzz', time: 15 },
  // Пьяный сон — лежит, пузырьки и «хрррр».
  drunkSleep: { anim: 'sleep', effect: 'snore', time: 60 },
  // Пьяный — шатается на месте.
  drunk: {
    anim: 'drunk', effect: 'bubbles', time: 4,
    update(a, dt) { a.x += Math.sin(a.stateTime * 3) * 12 * dt; },
  },
  // Трёт глаза (песок).
  rubEyes: { anim: 'rub_eyes', effect: 'tears', time: 5 },
  // Хлопает по карманам — где кошелёк?
  patPockets: { anim: 'pat_pockets', effect: 'question', time: 1.5 },
  // Злость и поиск: ходит туда-сюда, сердится.
  angry: {
    anim: 'angry', fallback: 'walk', effect: 'anger', time: 6,
    animOf: (a) => (Math.floor(a.stateTime / 0.8) % 2 ? 'walk' : 'angry'),
    update(a, dt) { if (Math.floor(a.stateTime / 0.8) % 2) roam(a, dt, a.world.walkSpeed * 1.2, 1.6); },
  },
  // Злость с паникой: носится туда-сюда и кричит.
  rage: {
    anim: 'panic', fallback: 'run', effect: 'anger', time: 6,
    update(a, dt) { roam(a, dt, a.world.walkSpeed * 2.4, 1.2); },
  },
  // Пьёт.
  drink: { anim: 'drink', effect: 'bubbles', time: 3 },
  // Дерётся: толкается на месте.
  fight: {
    anim: 'fight', fallback: 'angry', effect: 'dust', time: 5,
    update(a, dt) { a.x += Math.sin(a.stateTime * 9 + (a.affect.phase0 ??= a.rand() * 6)) * 40 * dt; },
  },
};

for (const [name, r] of Object.entries(AFFECTS)) {
  STATES[name] = {
    anim: r.anim,
    fallback: r.fallback,
    effect: r.effect,
    animOf: r.animOf,
    affect: true,
    update(a, dt) {
      r.update?.(a, dt);
      if (a.state === name && !r.endless && a.stateTime >= a.affect.duration) a.idle();
    },
  };
}

// Способы появления: ставят персонажа на старт и запускают первое состояние.
// Новый способ — запись здесь и имя в "entrances" в config.json (там же — как часто выпадает).
export const ENTRANCES = {
  // Без анимации — уже был на экране (оверлей перезагрузили или переподключился).
  here(a) {
    a.x = a.randomX();
    a.idle();
  },
  // Выходит из-за левого или правого края и идёт до случайной точки полосы.
  edge(a) {
    const fromLeft = a.rand() < 0.5;
    a.x = fromLeft ? -EDGE_START : a.world.width + EDGE_START;
    a.walkTo(a.randomX());
  },
  // Облачко на месте.
  poof(a) {
    a.x = a.randomX();
    a.play(['poof']);
  },
  // Падает сверху, приземляется, отряхивается.
  fall(a) {
    a.x = a.randomX();
    a.y = a.skyHeight();
    a.vy = 0;
    a.play(['fall', 'land', 'shake']);
  },
  // Спускается на парашюте. Старт вразброс по высоте — толпа рейда приземляется не разом.
  parachute(a) {
    a.x = a.randomX();
    a.y = a.skyHeight() + a.rand() * a.world.parachuteSpread;
    a.play(['parachute', 'land']);
  },
};

// Реакции поверх состояния. time(world) — сколько длится, с; offsetY(t, world) — подъём над
// тем, где персонаж сейчас, t от 0 до 1. Анимация реакции заменяет анимацию состояния.
export const REACTIONS = {
  // Прыжок: подъём и спуск по дуге.
  jump: {
    anim: 'jump',
    time: (w) => w.jumpTime,
    offsetY: (t, w) => 4 * w.jumpHeight * t * (1 - t),
  },
};

// ---------- облако с сообщением ----------
// Значения — world.bubble (config.json → "bubble"). Рисует render.js, здесь — только что и сколько.

const BUBBLE_DEFAULTS = { maxChars: 100, maxWidth: 280, maxLines: 4, minSeconds: 2, secondsPerChar: 0.05, maxSeconds: 8 };

// Текст облака: пробелы схлопнуты, длиннее maxChars — обрезан по слову с «…» (вместе с «…» не длиннее maxChars).
// Команда (начинается с «!») и пустое сообщение — null: облака нет.
export function bubbleText(text, maxChars = BUBBLE_DEFAULTS.maxChars) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.startsWith('!')) return null;
  const chars = [...clean]; // по символам, а не по половинкам смайлов
  if (chars.length <= maxChars) return clean;
  let cut = chars.slice(0, maxChars - 1).join('');
  const space = cut.lastIndexOf(' ');
  // Слово очень длинное — режем посреди него, иначе от текста мало что останется.
  if (space > cut.length / 2) cut = cut.slice(0, space);
  return cut.trimEnd() + '…';
}

// Сколько висит облако, с.
export function bubbleSeconds(text, b = BUBBLE_DEFAULTS) {
  return Math.min(b.maxSeconds, b.minSeconds + b.secondsPerChar * [...text].length);
}

// Перенос по словам: строки не шире maxWidth (measure(строка) → ширина в px), не больше maxLines.
// Слово шире строки режется по буквам. Не влезло — последняя строка кончается «…».
export function wrapLines(text, measure, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  const push = (s) => lines.push(s);
  for (const word of text.split(' ')) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= maxWidth) {
      line = tryLine;
      continue;
    }
    if (line) push(line);
    line = '';
    // Слово не влезает даже одно — по буквам.
    let piece = '';
    for (const ch of word) {
      if (measure(piece + ch) > maxWidth && piece) {
        push(piece);
        piece = '';
      }
      piece += ch;
    }
    line = piece;
  }
  if (line) push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(last + '…') > maxWidth) last = [...last].slice(0, -1).join('');
  kept[maxLines - 1] = last.trimEnd() + '…';
  return kept;
}

export class Actor {
  // entrance — имя из ENTRANCES; неизвестное — «пух».
  // animLength(traits, anim) — длина анимации героя в секундах или undefined (оверлей знает листы).
  constructor(viewer, world, { entrance = 'here', rand = Math.random, animLength = () => undefined } = {}) {
    this.id = viewer.id;
    this.name = viewer.name;
    // Признаки героя (класс, пол, цвет, убор…) — что рисовать. На поведение не влияет.
    this.traits = viewer.traits ?? {};
    this.world = world;
    this.rand = rand;
    this.animLength = animLength;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.facing = rand() < 0.5 ? -1 : 1;
    this.targetX = 0;
    // Очередь состояний после текущего (появление: fall → land → shake).
    this.queue = [];
    // Текущая реакция: { name, time } или null.
    this.reaction = null;
    // Уйти, как только встанет на землю (пришёл leave во время падения или облачка).
    this.pendingLeave = false;
    // Облако с сообщением: { text, time, duration } или null. Не зависит от состояния.
    this.bubble = null;
    // Сцена, в которой участвует (scene-engine.js), её анимация, предметы в руках и прозрачность.
    this.scene = null;
    this.sceneAnim = null;
    this.held = {};
    this.alpha = undefined;
    // Реакция соседа (AFFECTS): { name, duration, from, … } или null.
    this.affect = null;
    // Сколько секунд ждёт ухода (пришёл leave, а персонаж занят).
    this.leaveWait = 0;
    this.raider = !!viewer.raider;
    const start = ENTRANCES[entrance] ?? ENTRANCES.poof;
    this.entrance = ENTRANCES[entrance] ? entrance : 'poof';
    start(this);
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  // Проиграть состояния по очереди; после последнего — idle.
  play(states) {
    this.queue = states.slice(1);
    this.setState(states[0]);
  }

  // Следующее состояние из очереди; очередь пуста — idle.
  next() {
    if (this.queue.length) this.setState(this.queue.shift());
    else this.idle();
  }

  randomX() {
    const { left, right } = this.world.strip;
    return between([left, right], this.rand);
  }

  // Высота, с которой персонаж начинает спуск: чуть выше верхнего края экрана.
  skyHeight() {
    return this.world.strip.groundY + 100;
  }

  // Опуститься на dy; true — коснулся земли.
  descend(dy) {
    this.y -= dy;
    if (this.y > 0) return false;
    this.y = 0;
    this.vy = 0;
    return true;
  }

  // Шаг к targetX; true — дошёл.
  moveToTarget(dt) {
    const step = this.world.walkSpeed * dt;
    const rest = this.targetX - this.x;
    if (Math.abs(rest) <= step) {
      this.x = this.targetX;
      return true;
    }
    this.x += Math.sign(rest) * step;
    return false;
  }

  idle() {
    this.queue = [];
    this.affect = null;
    this.setState('idle');
    this.pause = between(this.world.idlePause, this.rand);
    // Встал на землю, а уход уже пришёл — уходит.
    if (this.pendingLeave) this.leave();
  }

  walkTo(target) {
    this.targetX = target;
    this.facing = Math.sign(target - this.x) || this.facing;
    this.setState('walk');
  }

  walk() {
    const { left, right } = this.world.strip;
    const dist = between(this.world.walkDistance, this.rand);
    let dir = this.rand() < 0.5 ? -1 : 1;
    // Не хватает места в выбранную сторону — идём в другую.
    if (this.x + dir * dist < left || this.x + dir * dist > right) dir = -dir;
    const target = Math.min(right, Math.max(left, this.x + dir * dist));
    if (Math.abs(target - this.x) < MIN_STEP) return this.idle();
    this.walkTo(target);
  }

  // Уйти за ближайший край экрана. В воздухе или в облачке — сначала встать на землю.
  leave() {
    if (this.state === 'leave' || this.state === 'gone') return;
    if (!STATES[this.state].ground) {
      this.pendingLeave = true;
      return;
    }
    this.pendingLeave = false;
    this.reaction = null;
    this.queue = [];
    const toLeft = this.x < this.world.width / 2;
    this.targetX = toLeft ? -OFFSCREEN : this.world.width + OFFSCREEN;
    this.facing = toLeft ? -1 : 1;
    this.setState('leave');
  }

  // Зритель вернулся, пока персонаж уходил, — остаётся.
  stay() {
    this.pendingLeave = false;
    this.leaveWait = 0;
    if (this.state === 'leave') this.idle();
  }

  // Реакция (REACTIONS). Только на земле и не во время другой реакции; уходящий не реагирует.
  react(name) {
    if (!REACTIONS[name] || this.reaction || this.pendingLeave || !STATES[this.state].ground) return false;
    this.reaction = { name, time: 0 };
    return true;
  }

  // Облако с текстом сообщения. Новое заменяет старое. Показывается в любом состоянии
  // (даже когда прыжок невозможен). Команда «!…» или пустой текст — облака нет, false.
  say(text) {
    const b = { ...BUBBLE_DEFAULTS, ...this.world.bubble };
    const shown = bubbleText(text, b.maxChars);
    if (!shown) return false;
    this.bubble = { text: shown, time: 0, duration: bubbleSeconds(shown, b) };
    return true;
  }

  get gone() {
    return this.state === 'gone';
  }

  // Свободен для сцены: стоит или ходит сам, не в сцене, не в реакции, не уходит.
  get free() {
    return !this.scene && !!STATES[this.state].ground && !this.pendingLeave && !this.reaction;
  }

  // Реакция соседа (AFFECTS): из сцены или сама. params: { from — x источника, … }.
  // Длительность — world.reactions[имя] или по умолчанию. Уходящий не реагирует. true — началась.
  applyAffect(name, params = {}) {
    const r = AFFECTS[name];
    if (!r || this.state === 'leave' || this.state === 'gone') return false;
    this.scene = null;
    this.sceneAnim = null;
    this.reaction = null;
    this.queue = [];
    this.affect = { name, duration: this.world.reactions?.[name] ?? r.time, ...params };
    this.setState(name);
    r.start?.(this, params);
    return true;
  }

  // Что рисовать: анимация, запасная анимация и время в ней.
  get animation() {
    if (this.reaction) return { name: REACTIONS[this.reaction.name].anim, fallback: 'idle', time: this.reaction.time };
    const s = STATES[this.state];
    if (this.state === 'scene') return { name: s.animOf(this), fallback: 'idle', time: this.sceneAnim?.time ?? this.stateTime };
    if (this.affect?.phase) return { name: s.animOf(this), fallback: s.fallback ?? 'idle', time: this.affect.phaseTime };
    return { name: s.animOf?.(this) ?? s.anim, fallback: s.fallback ?? 'idle', time: this.stateTime };
  }

  // Высота, на которой рисовать: своя плюс подъём от реакции.
  get drawY() {
    if (!this.reaction) return this.y;
    const r = REACTIONS[this.reaction.name];
    const t = Math.min(this.reaction.time / r.time(this.world), 1);
    return this.y + r.offsetY(t, this.world);
  }

  get visible() {
    return STATES[this.state].visible?.(this) ?? true;
  }

  // Эффект вокруг персонажа (render.js → EFFECTS): { name, time } или null.
  get effect() {
    const name = STATES[this.state].effect;
    return name ? { name, time: this.stateTime } : null;
  }

  // dt — секунды с прошлого кадра.
  update(dt) {
    this.stateTime += dt;
    if (this.bubble && (this.bubble.time += dt) >= this.bubble.duration) this.bubble = null;
    // Уход ждёт конца реакции, но не дольше предела (сцену прерывает scene-engine.js).
    if (this.pendingLeave) {
      this.leaveWait += dt;
      if (STATES[this.state].affect && this.leaveWait >= (this.world.scenes?.leaveWaitSeconds ?? 20)) this.idle();
    }
    if (this.reaction) {
      this.reaction.time += dt;
      if (this.reaction.time >= REACTIONS[this.reaction.name].time(this.world)) this.reaction = null;
    }
    const s = STATES[this.state];
    if (s.once) {
      const length = this.animLength(this.traits, s.anim) ?? DEFAULT_ANIM_TIME;
      if (this.stateTime >= length) this.next();
    } else {
      s.update?.(this, dt);
    }
  }
}
