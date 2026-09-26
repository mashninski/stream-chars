// Логика персонажа: где стоит, куда идёт, в каком состоянии. Ничего не рисует —
// рисование в render.js.
//
// Состояния: idle (стоит) → walk (идёт) → idle → … ; leave (уходит за край) → gone (можно удалять).
// x — середина персонажа по горизонтали, в пикселях экрана. facing: 1 — смотрит вправо, -1 — влево.

// Насколько далеко за край экрана уйти, чтобы персонаж точно скрылся.
const OFFSCREEN = 200;
// Шаг короче этого не делаем — выглядит как дёрганье на месте.
const MIN_STEP = 20;

function between([min, max], rand) {
  return min + (max - min) * rand();
}

export class Actor {
  constructor(viewer, world, x, rand = Math.random) {
    this.id = viewer.id;
    this.name = viewer.name;
    // Имя персонажа из каталога — какой спрайт рисовать. На поведение не влияет.
    this.character = viewer.character;
    this.world = world;
    this.rand = rand;
    this.x = x;
    this.facing = rand() < 0.5 ? -1 : 1;
    this.targetX = x;
    this.idle();
  }

  // Сколько секунд персонаж в текущем состоянии — пригодится для кадров анимации.
  #setState(state) {
    this.state = state;
    this.stateTime = 0;
  }

  idle() {
    this.#setState('idle');
    this.pause = between(this.world.idlePause, this.rand);
  }

  walk() {
    const { left, right } = this.world.strip;
    const dist = between(this.world.walkDistance, this.rand);
    let dir = this.rand() < 0.5 ? -1 : 1;
    // Не хватает места в выбранную сторону — идём в другую.
    if (this.x + dir * dist < left || this.x + dir * dist > right) dir = -dir;
    const target = Math.min(right, Math.max(left, this.x + dir * dist));
    if (Math.abs(target - this.x) < MIN_STEP) return this.idle();
    this.targetX = target;
    this.facing = Math.sign(target - this.x);
    this.#setState('walk');
  }

  // Уйти за ближайший край экрана.
  leave() {
    if (this.state === 'leave' || this.state === 'gone') return;
    const toLeft = this.x < this.world.width / 2;
    this.targetX = toLeft ? -OFFSCREEN : this.world.width + OFFSCREEN;
    this.facing = toLeft ? -1 : 1;
    this.#setState('leave');
  }

  // Зритель вернулся, пока персонаж уходил, — остаётся.
  stay() {
    if (this.state === 'leave') this.idle();
  }

  get gone() {
    return this.state === 'gone';
  }

  // dt — секунды с прошлого кадра.
  update(dt) {
    this.stateTime += dt;
    if (this.state === 'idle') {
      if (this.stateTime >= this.pause) this.walk();
    } else if (this.state === 'walk' || this.state === 'leave') {
      const step = this.world.walkSpeed * dt;
      const rest = this.targetX - this.x;
      if (Math.abs(rest) <= step) {
        this.x = this.targetX;
        if (this.state === 'walk') this.idle();
        else this.#setState('gone');
      } else {
        this.x += Math.sign(rest) * step;
      }
    }
  }
}
