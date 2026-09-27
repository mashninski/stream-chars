// Оверлей: держит героев, двигает их (actor.js), играет сцены (scene-engine.js)
// и рисует слоями (render.js, картинки — assets.js).
import { Actor, REACTIONS } from './actor.js';
import { drawActor, drawBubbles, drawThing, drawSceneEffects } from './render.js';
import { Assets } from './assets.js';
import { SceneManager } from './scene-engine.js';
import { connect } from './connection.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const actors = new Map();
// Картинки и каталог героев. Приходят с 'state'.
let assets = new Assets();
// Настройки оверлея — один объект на всё время: персонажи и сцены видят новые значения сразу.
const world = {};
let ready = false;

// Длина анимации героя в секундах — логике нужна, чтобы знать, когда кончилось приземление.
const animLength = (traits, anim) => assets.heroAnimLength(traits, anim);

const scenes = new SceneManager({
  world,
  actors: () => actors,
  load: (id) => import(`/js/scenes/${id}.js`),
  animLength: (e, anim) => (e.traits ? animLength(e.traits, anim) : assets.itemAnimLength(e, anim)),
  log: { info: (t) => console.log(t), error: (t) => console.error(t) },
});

// entrance — способ появления, его выбирает программа; нет (восстановление списка) — стоит на месте.
function add(viewer, entrance) {
  const actor = actors.get(viewer.id);
  if (actor) {
    actor.traits = viewer.traits ?? actor.traits;
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
  if (msg.type === 'state' || msg.type === 'config') {
    Object.assign(world, msg.config);
    if (canvas.width !== world.width) canvas.width = world.width;
    if (canvas.height !== world.height) canvas.height = world.height;
    scenes.setList(world.sceneList);
    if (msg.type === 'config') return;
    assets = new Assets(msg.catalog);
    ready = true;
    sync(msg.viewers);
  } else if (!ready) {
    return;
  } else if (msg.type === 'join') {
    add(msg.viewer, msg.entrance);
  } else if (msg.type === 'leave') {
    actors.get(msg.id)?.leave();
  } else if (msg.type === 'traits') {
    const actor = actors.get(msg.id);
    if (actor) actor.traits = msg.traits;
  } else if (msg.type === 'act') {
    act(msg);
  }
});

// Действие от программы: { id, action, text?, seed? }. Кто прислал (чат, награда, панель) — оверлей не знает.
// Текст — облако (если сцена не показывает его сама); action — реакция (REACTIONS в actor.js) или сцена.
// Незнакомое действие — пропуск со строкой в консоли.
function act({ id, action, text, seed }) {
  const actor = actors.get(id);
  if (!actor) return;
  const scene = world.sceneList?.find((s) => s.id === action);
  if (text && !scene?.ownsText) actor.say(text);
  if (!action) return;
  if (REACTIONS[action]) actor.react(action);
  else if (scene) scenes.request(id, action, seed ?? 0, { text });
  else console.log(`[act] незнаёмае дзеянне «${action}» — прапушчана`);
}

let last = performance.now();
function frame(now) {
  // Не больше 0,1 с за кадр: после сворачивания вкладки персонажи не телепортируются.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (ready) {
    ctx.imageSmoothingEnabled = false;
    scenes.tick(dt);
    for (const actor of actors.values()) {
      actor.update(dt);
      if (actor.gone) actors.delete(actor.id);
      else drawActor(ctx, actor, world, assets);
    }
    for (const thing of scenes.things()) drawThing(ctx, thing, world, assets);
    drawSceneEffects(ctx, scenes.effects(), world, assets);
    drawBubbles(ctx, actors.values(), world);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
