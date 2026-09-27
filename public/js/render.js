// Рисование героев слоями (снизу вверх): крылья → тело → куртка → украшения класса → убор → предмет в руке.
// Слои совмещаются по точкам привязки текущего кадра (голова, спина, руки). Логика (actor.js) сюда
// не входит: какую анимацию играть, на какой высоте и с каким эффектом — говорит сам персонаж.
// Кадры смотрят вправо; влево — зеркало всех слоёв сразу. Низ кадра стоит на линии земли.
import { wrapLines } from './actor.js';

// Эффекты — рисуются программно, без файлов графики. Новый эффект — запись здесь.
// Аргументы: cx, cy — центр (px экрана), size — размер героя (px), s — пиксель арта, time — с от начала,
// world — настройки, p — доля от 0 до 1 (если у эффекта есть длительность), data — что передала сцена.
export const EFFECTS = {
  // «Пух»: облачко из пиксельных кругов раздувается и тает.
  poof(ctx, { cx, cy, size, s, time, world }) {
    const p = Math.min(time / world.poofTime, 1);
    const puffs = [[0, 0, 1], [-0.35, 0.15, 0.7], [0.35, 0.15, 0.7], [-0.2, -0.3, 0.6], [0.25, -0.28, 0.6], [0, 0.35, 0.55]];
    ctx.save();
    ctx.globalAlpha = p < 0.5 ? 1 : 1 - (p - 0.5) * 2;
    ctx.fillStyle = '#f2f2f2';
    for (const [dx, dy, k] of puffs) {
      const r = size * k * (0.25 + 0.35 * p);
      pixelCircle(ctx, cx + dx * size * (0.6 + p), cy + dy * size * (0.6 + p), r, s);
    }
    ctx.restore();
  },
};

// Круг из квадратов размером с пиксель арта — в том же стиле, что спрайты.
export function pixelCircle(ctx, cx, cy, r, s) {
  for (let dy = -r; dy <= r; dy += s) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) / s) * s;
    if (half > 0) ctx.fillRect(Math.round((cx - half) / s) * s, Math.round((cy + dy) / s) * s, half * 2, s);
  }
}

// Номер кадра: зацикленная анимация — по кругу, одноразовая (`"loop": false`) — держит последний кадр.
export function frameOf(anim, time) {
  const n = Math.floor(Math.max(0, time) * anim.fps);
  return anim.loop === false ? Math.min(n, anim.frames - 1) : n % anim.frames;
}

// Точки привязки кадра: свои у анимации (по кадрам) → общие по умолчанию (body.json).
function anchorsOf(anim, frame, body) {
  const list = anim?.anchors;
  const own = list ? list[frame % list.length] ?? list[0] : null;
  return { ...body?.anchors, ...own };
}

// Кадр предмета со своим листом (убор, крылья, реквизит, существо): картинка и прямоугольник кадра.
function itemFrame(assets, item, animName, time) {
  const img = assets.image(item.image);
  if (!img) return null;
  const anim = assets.resolveAnim(item.animations, animName ?? 'idle');
  const f = frameOf(anim, time);
  return { img, sx: f * item.frameWidth, sy: anim.row * item.frameHeight };
}

// Нарисовать предмет так, чтобы его точка anchor совпала с точкой (ax, ay) кадра героя (в пикселях арта,
// в системе координат, где начало — середина низа кадра героя). rot — поворот вокруг точки, градусы.
function drawItemAt(ctx, assets, item, ax, ay, rot, s, time, animName) {
  const fr = itemFrame(assets, item, animName, time);
  if (!fr) return;
  const [iax, iay] = item.anchor;
  ctx.save();
  ctx.translate(ax * s, ay * s);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(fr.img, fr.sx, fr.sy, item.frameWidth, item.frameHeight, -iax * s, -iay * s, item.frameWidth * s, item.frameHeight * s);
  ctx.restore();
}

// Слой класса (лист на общей сетке тела).
function drawClassLayer(ctx, img, anim, frame, fw, fh, s) {
  ctx.drawImage(img, frame * fw, anim.row * fh, fw, fh, (-fw / 2) * s, -fh * s, fw * s, fh * s);
}

// Z-порядок слоёв класса; слои признаков — по "layer.z" в реестре, предмет в руке — HELD_Z.
const CLASS_Z = { body: 10, jacket: 20, decor: 30 };
const HELD_Z = 60;

// Герой. assets — Assets (картинки и каталог). Запоминает у персонажа actor.drawTop — верх надписи
// над ним (для облака, drawBubbles).
export function drawActor(ctx, actor, world, assets) {
  const s = world.scale;
  const ground = world.strip.groundY - actor.drawY;
  const body = assets.body;
  const traits = actor.traits ?? {};
  const cls = assets.item('classes', traits.class);
  const fw = body?.frameWidth ?? 32;
  const fh = body?.frameHeight ?? 32;
  let headTop = fh - 20; // верх головы в пикселях кадра (пока нет графики — примерно)
  const size = Math.max(fw, fh) * s;

  if (cls && actor.visible) {
    const want = actor.animation;
    const anim = assets.resolveAnim(cls.animations, want.name, want.fallback);
    const frame = frameOf(anim, want.time);
    const anchors = anchorsOf(anim, frame, body);
    const variant = cls.layers[traits.sex] ?? Object.values(cls.layers)[0];
    // Координаты в пикселях арта от середины низа кадра.
    const pt = (name) => {
      const p = anchors[name];
      return p ? [p[0] - fw / 2, p[1] - fh, p[2] ?? 0] : null;
    };
    const layers = [];
    for (const [layer, url] of Object.entries(variant)) {
      const img = layer === 'jacket' ? assets.tinted(url, traits.color) : assets.image(url);
      if (img) layers.push([CLASS_Z[layer] ?? 30, () => drawClassLayer(ctx, img, anim, frame, fw, fh, s)]);
    }
    // Признаки со слоем (убор, крылья…): предмет категории признака по точке привязки.
    for (const t of assets.traits) {
      if (!t.layer || t.type !== 'item') continue;
      const item = assets.item(t.category, traits[t.id]);
      const p = item && pt(t.layer.anchor);
      if (!p) continue;
      layers.push([t.layer.z, () => drawItemAt(ctx, assets, item, p[0], p[1], p[2], s, want.time)]);
      if (t.layer.anchor === 'head') headTop = Math.min(headTop, anchors.head[1] - item.anchor[1]);
    }
    // Предметы в руках (сцены): actor.held = { handR: 'props/sword', … }.
    for (const [anchor, ref] of Object.entries(actor.held ?? {})) {
      const [category, id] = String(ref).split('/');
      const item = assets.item(category, id);
      const p = item && pt(anchor);
      if (p) layers.push([HELD_Z, () => drawItemAt(ctx, assets, item, p[0], p[1], 0, s, want.time)]);
    }
    if (anchors.head && anchors.head[2] === undefined) headTop = Math.min(headTop, anchors.head[1] - 1);
    layers.sort((a, b) => a[0] - b[0]);
    ctx.save();
    ctx.translate(Math.round(actor.x), Math.round(ground));
    if (actor.facing < 0) ctx.scale(-1, 1);
    if (actor.alpha !== undefined) ctx.globalAlpha = actor.alpha;
    for (const [, draw] of layers) draw();
    ctx.restore();
  }

  const top = ground - (fh - headTop) * s;
  const effect = actor.effect;
  if (effect) EFFECTS[effect.name]?.(ctx, { cx: actor.x, cy: ground - size / 2, size, s, time: effect.time, world });
  actor.drawTop = Math.round(top) - 6 - (traits.nameShown ? 22 : 0);
  if (!actor.visible || !traits.nameShown) return;
  drawName(ctx, actor.name, actor.x, top - 6, traits.nameColor);
}

// Ник над головой, его цветом, с тёмной обводкой — читается на любом фоне.
export function drawName(ctx, text, x, bottom, color) {
  ctx.save();
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = color || '#fff';
  ctx.strokeText(text, Math.round(x), Math.round(bottom));
  ctx.fillText(text, Math.round(x), Math.round(bottom));
  ctx.restore();
}

// Существо или реквизит сцены: { category, id, x, y (высота над землёй), facing, anim, time, alpha }.
export function drawThing(ctx, thing, world, assets) {
  const item = assets.item(thing.category, thing.id);
  if (!item) return;
  const fr = itemFrame(assets, item, thing.anim, thing.time);
  if (!fr) return;
  const s = world.scale;
  ctx.save();
  ctx.translate(Math.round(thing.x), Math.round(world.strip.groundY - (thing.y ?? 0)));
  if ((thing.facing ?? 1) < 0) ctx.scale(-1, 1);
  if (thing.rot) ctx.rotate((thing.rot * Math.PI) / 180);
  if (thing.alpha !== undefined) ctx.globalAlpha = thing.alpha;
  const w = item.frameWidth * s;
  const h = item.frameHeight * s;
  ctx.drawImage(fr.img, fr.sx, fr.sy, item.frameWidth, item.frameHeight, -w / 2, -h, w, h);
  ctx.restore();
}

// ---------- облака с сообщениями ----------
// Отдельным проходом после всех персонажей — облака поверх всех. Только canvas (fillText):
// чужой текст не может стать разметкой.

const BUBBLE_PAD = 8;
const BUBBLE_TAIL = 8;

// Строки облака считаются один раз на текст (measureText недешёвый).
const wrapCache = new WeakMap();

export function drawBubbles(ctx, actors, world) {
  const b = world.bubble ?? {};
  const fontSize = b.fontSize ?? 16;
  const lineH = Math.round(fontSize * 1.25);
  ctx.save();
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const actor of actors) {
    const bubble = actor.bubble;
    if (!bubble || actor.drawTop === undefined) continue;
    let lines = wrapCache.get(bubble);
    if (!lines) {
      lines = wrapLines(bubble.text, (t) => ctx.measureText(t).width, b.maxWidth ?? 280, b.maxLines ?? 4);
      wrapCache.set(bubble, lines);
    }
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const w = Math.ceil(textW) + BUBBLE_PAD * 2;
    const h = lines.length * lineH + BUBBLE_PAD * 2;
    // Над ником; у края экрана облако сдвигается внутрь, хвостик остаётся над персонажем.
    const tipX = Math.round(actor.x);
    const bottom = Math.max(h + BUBBLE_TAIL, actor.drawTop - 2);
    const left = Math.round(Math.min(Math.max(tipX - w / 2, 4), world.width - w - 4));
    const top = bottom - BUBBLE_TAIL - h;
    // Где облако — сцене «первое слово» (ник выплывает из него).
    bubble.box = { left, top, w, h };
    // Последние 0,3 с — тает.
    ctx.globalAlpha = Math.min(1, (bubble.duration - bubble.time) / 0.3);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, 8);
    ctx.fill();
    ctx.stroke();
    // Хвостик к голове.
    const tx = Math.min(Math.max(tipX, left + 12), left + w - 12);
    ctx.beginPath();
    ctx.moveTo(tx - 6, top + h - 1);
    ctx.lineTo(tx, bottom);
    ctx.lineTo(tx + 6, top + h - 1);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tx - 6, top + h);
    ctx.lineTo(tx, bottom);
    ctx.lineTo(tx + 6, top + h);
    ctx.stroke();
    ctx.fillStyle = '#1b1b1b';
    lines.forEach((line, i) => ctx.fillText(line, left + BUBBLE_PAD, top + BUBBLE_PAD + i * lineH));
  }
  ctx.restore();
}
