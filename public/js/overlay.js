// Оверлей: держит персонажей, двигает их (actor.js) и рисует (render.js).
import { Actor, REACTIONS } from './actor.js';
import { drawActor, drawBubbles } from './render.js';
import { connect } from './connection.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const actors = new Map();
// Листы персонажей: имя → { info, image }. Приходят с каталогом в 'state'.
const sprites = new Map();
let world = null;

function loadSprites(characters) {
  sprites.clear();
  for (const [name, info] of Object.entries(characters)) {
    const image = new Image();
    image.src = `/characters/${encodeURIComponent(name)}/sheet.png`;
    sprites.set(name, { info, image });
  }
}

// Длина анимации персонажа в секундах — логике нужна, чтобы знать, когда кончилось приземление.
function animLength(character, anim) {
  const a = sprites.get(character)?.info.animations[anim];
  return a ? a.frames / a.fps : undefined;
}

// entrance — способ появления, его выбирает программа; нет (восстановление списка) — стоит на месте.
function add(viewer, entrance) {
  const actor = actors.get(viewer.id);
  if (actor) {
    actor.character = viewer.character;
    return actor.stay();
  }
  actors.set(viewer.id, new Actor(viewer, world, { entrance, animLength }));
}

// Полный список от программы: при первом подключении, перезагрузке и переподключении.
function sync(list) {
  const ids = new Set(list.map((v) => v.id));
  for (const actor of actors.values()) if (!ids.has(actor.id)) actor.leave();
  for (const viewer of list) add(viewer);
}

connect((msg) => {
  if (msg.type === 'state') {
    world = msg.config;
    canvas.width = world.width;
    canvas.height = world.height;
    loadSprites(msg.characters ?? {});
    sync(msg.viewers);
  } else if (!world) {
    return;
  } else if (msg.type === 'join') {
    add(msg.viewer, msg.entrance);
  } else if (msg.type === 'leave') {
    actors.get(msg.id)?.leave();
  } else if (msg.type === 'character') {
    const actor = actors.get(msg.id);
    if (actor) actor.character = msg.character;
  } else if (msg.type === 'act') {
    act(msg);
  }
});

// Действие от программы: { id, action, text?, seed? }. Кто прислал (чат, награда, панель) — оверлей не знает.
// Текст — облако; action — реакция (REACTIONS в actor.js). Незнакомое действие — пропуск со строкой в консоли.
function act({ id, action, text }) {
  const actor = actors.get(id);
  if (!actor) return;
  if (text) actor.say(text);
  if (!action) return;
  if (REACTIONS[action]) actor.react(action);
  else console.log(`[act] незнаёмае дзеянне «${action}» — прапушчана`);
}

let last = performance.now();
function frame(now) {
  // Не больше 0,1 с за кадр: после сворачивания вкладки персонажи не телепортируются.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (world) {
    ctx.imageSmoothingEnabled = false;
    for (const actor of actors.values()) {
      actor.update(dt);
      if (actor.gone) actors.delete(actor.id);
      else drawActor(ctx, actor, world, sprites.get(actor.character));
    }
    drawBubbles(ctx, actors.values(), world);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
