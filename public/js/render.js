// Рисование героев слоями (снизу вверх): крылья → тело → куртка → украшения класса → убор → предмет в руке.
// Слои совмещаются по точкам привязки текущего кадра (голова, спина, руки). Логика (actor.js) сюда
// не входит: какую анимацию играть, на какой высоте и с каким эффектом — говорит сам персонаж.
// Кадры смотрят вправо; влево — зеркало всех слоёв сразу. Низ кадра стоит на линии земли.
import { wrapLines } from './actor.js';

// Эффекты — рисуются программно, без файлов графики. Новый эффект — запись здесь.
// Аргументы: cx, cy — середина героя или точка сцены (px экрана), size — размер героя (px), s — пиксель
// арта, time — с от начала, p — доля от 0 до 1 (если у эффекта есть длительность, иначе null),
// data — что передала сцена, world — настройки. Над головой — примерно cy - size * 0.75.
const px = (ctx, x, y, s, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x / s) * s, Math.round(y / s) * s, s, s);
};

function label(ctx, text, x, y, color, sizePx = 22) {
  ctx.font = `bold ${sizePx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1b1b1b';
  ctx.fillStyle = color;
  ctx.strokeText(text, Math.round(x), Math.round(y));
  ctx.fillText(text, Math.round(x), Math.round(y));
}

// Псевдослучайное по номеру частицы — одинаково каждый кадр (частицы не дёргаются).
const hash = (i) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function puffs(ctx, { cx, cy, size, s }, p, color, spread = 1) {
  const list = [[0, 0, 1], [-0.35, 0.15, 0.7], [0.35, 0.15, 0.7], [-0.2, -0.3, 0.6], [0.25, -0.28, 0.6], [0, 0.35, 0.55]];
  ctx.globalAlpha *= p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) * 2);
  ctx.fillStyle = color;
  for (const [dx, dy, k] of list) {
    const r = size * k * (0.25 + 0.35 * p);
    pixelCircle(ctx, cx + dx * size * (0.6 + p) * spread, cy + dy * size * (0.6 + p) * spread, r, s);
  }
}

export const EFFECTS = {
  // «Пух»: облачко из пиксельных кругов раздувается и тает.
  poof(ctx, a) {
    puffs(ctx, a, a.p ?? Math.min(a.time / a.world.poofTime, 1), '#f2f2f2');
  },
  smoke(ctx, a) {
    const p = a.p ?? (a.time % 1.2) / 1.2;
    puffs(ctx, { ...a, cy: a.cy - p * a.size * 0.6 }, p, '#8a8a8a', 0.8);
  },
  dust(ctx, a) {
    const p = a.p ?? (a.time % 0.8) / 0.8;
    puffs(ctx, { ...a, cy: a.cy + a.size * 0.35, size: a.size * 0.6 }, p, '#c8b89a', 1.4);
  },
  exclaim(ctx, { cx, cy, size, time }) {
    label(ctx, '!', cx + 4, cy - size * 0.8 - Math.abs(Math.sin(time * 8)) * 6, '#ff4040', 30);
  },
  question(ctx, { cx, cy, size, time }) {
    label(ctx, '?', cx + 4, cy - size * 0.8 - Math.abs(Math.sin(time * 5)) * 4, '#ffd83d', 28);
  },
  // Знак злости — красный «крест» у головы, пульсирует.
  anger(ctx, { cx, cy, size, s, time }) {
    const k = 1 + 0.25 * Math.sin(time * 12);
    const x = cx + size * 0.28;
    const y = cy - size * 0.62;
    for (const [dx, dy] of [[-1, -2], [-1, -1], [-2, -1], [1, -2], [1, -1], [2, -1], [-1, 2], [-1, 1], [-2, 1], [1, 2], [1, 1], [2, 1]]) {
      px(ctx, x + dx * s * k, y + dy * s * k, s, '#ff3030');
    }
    label(ctx, '#!', cx, cy - size * 0.95, '#ff5050', 16);
  },
  zzz(ctx, { cx, cy, size, time }) {
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.6 + i / 3) % 1;
      ctx.globalAlpha = 1 - t;
      label(ctx, 'z', cx + size * 0.25 + t * 30, cy - size * 0.4 - t * 50, '#e8f0ff', 14 + t * 12);
    }
    ctx.globalAlpha = 1;
  },
  // Пьяный сон: «хрррр» и пузырьки.
  snore(ctx, a) {
    const { cx, cy, size, time } = a;
    const t = (time * 0.4) % 1;
    ctx.globalAlpha = 1 - t * 0.8;
    label(ctx, 'хрррр', cx + size * 0.3 + t * 20, cy - size * 0.35 - t * 40, '#ffe0f0', 16);
    ctx.globalAlpha = 1;
    EFFECTS.bubbles(ctx, a);
  },
  bubbles(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 6; i++) {
      const t = (time * 0.7 + hash(i)) % 1;
      const x = cx + (hash(i + 10) - 0.5) * size * 0.8;
      const y = cy - size * 0.4 - t * size;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#ffb0d0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, s * (1 + hash(i + 20) * 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  // Звёздочки кружат над головой.
  stars(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 3; i++) {
      const ang = time * 5 + (i * Math.PI * 2) / 3;
      const x = cx + Math.cos(ang) * size * 0.35;
      const y = cy - size * 0.55 + Math.sin(ang) * size * 0.1;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) px(ctx, x + dx * s, y + dy * s, s, '#ffe040');
    }
  },
  tears(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 4; i++) {
      const t = (time * 1.5 + i / 4) % 1;
      px(ctx, cx + (i % 2 ? 1 : -1) * size * 0.12, cy - size * 0.2 + t * size * 0.4, s, '#60b0ff');
    }
  },
  // Искры: во все стороны (data.dx — сдвиг в сторону взгляда, в размерах героя).
  sparks(ctx, { cx, cy, size, s, time, p, data }) {
    const k = p ?? (time % 0.5) / 0.5;
    const x0 = cx + (data?.dx ?? 0) * size * 0.3;
    for (let i = 0; i < 10; i++) {
      const ang = hash(i) * Math.PI * 2;
      const r = k * size * (0.3 + hash(i + 5) * 0.4);
      px(ctx, x0 + Math.cos(ang) * r, cy + Math.sin(ang) * r, s, i % 2 ? '#fff6a0' : '#ffb020');
    }
  },
  sparkle(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 6; i++) {
      if ((Math.floor(time * 8) + i) % 3) continue;
      const x = cx + (hash(i + Math.floor(time * 4)) - 0.5) * size;
      const y = cy + (hash(i + 40 + Math.floor(time * 4)) - 0.5) * size;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) px(ctx, x + dx * s, y + dy * s, s, dx || dy ? '#c8e8ff' : '#ffffff');
    }
  },
  // Крик: дуги от лица в обе стороны.
  shout(ctx, { cx, cy, size, time }) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const r = ((time * 1.5 + i / 3) % 1) * size * 1.6 + size * 0.2;
      ctx.globalAlpha = 1 - r / (size * 1.8);
      for (const dir of [0, Math.PI]) {
        ctx.beginPath();
        ctx.arc(cx, cy - size * 0.3, r, dir - 0.5, dir + 0.5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  },
  // Пламя вокруг: ряд языков у ног (data.width — ширина, px).
  flame(ctx, { cx, cy, size, s, time, data }) {
    const w = data?.width ?? size;
    for (let x = -w; x <= w; x += s * 2) {
      const h = size * (0.25 + 0.2 * Math.abs(Math.sin(time * 9 + x * 0.13)));
      const base = cy + size * 0.5;
      for (let y = 0; y < h; y += s) {
        const k = y / h;
        px(ctx, cx + x, base - y, s, k < 0.4 ? '#ff5010' : k < 0.75 ? '#ffa020' : '#ffe060');
      }
    }
  },
  explosion(ctx, { cx, cy, size, s, time, p }) {
    const k = p ?? Math.min(1, time / 0.7);
    ctx.globalAlpha = 1 - k * 0.8;
    ctx.fillStyle = '#ff6010';
    pixelCircle(ctx, cx, cy, size * (0.3 + k * 1.1), s);
    ctx.fillStyle = '#ffb020';
    pixelCircle(ctx, cx, cy, size * (0.2 + k * 0.8), s);
    ctx.fillStyle = '#fff6c0';
    pixelCircle(ctx, cx, cy, size * (0.1 + k * 0.4), s);
    ctx.globalAlpha = 1;
  },
  // Магический круг у ног: точки бегут по кругу.
  runes(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 12; i++) {
      const ang = time * 3 + (i * Math.PI * 2) / 12;
      px(ctx, cx + Math.cos(ang) * size * 0.6, cy + size * 0.45 + Math.sin(ang) * size * 0.12, s, i % 2 ? '#b080ff' : '#e0c0ff');
    }
  },
  hearts(ctx, { cx, cy, size, s, time }) {
    const shape = [[-1, 0], [1, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-1, -2], [1, -2], [0, 1], [-1, 0.0001]];
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.5 + i / 3) % 1;
      const x = cx + (hash(i) - 0.5) * size * 0.6;
      const y = cy - t * size * 0.8;
      ctx.globalAlpha = 1 - t;
      for (const [dx, dy] of shape) px(ctx, x + dx * s, y + dy * s, s, '#ff5a8a');
    }
    ctx.globalAlpha = 1;
  },
  notes(ctx, { cx, cy, size, time }) {
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.5 + i / 3) % 1;
      ctx.globalAlpha = 1 - t;
      label(ctx, i % 2 ? '♪' : '♫', cx + Math.sin(t * 6 + i) * size * 0.4, cy - size * 0.5 - t * size * 0.8, '#ffffff', 20);
    }
    ctx.globalAlpha = 1;
  },
  hello(ctx, { cx, cy, size, time }) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    const x = cx + size * 0.45;
    const y = cy - size * 0.45;
    for (let i = 1; i <= 2; i++) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 10 + i);
      ctx.beginPath();
      ctx.arc(x, y, i * 8, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  // Песок в глаза: частицы летят в сторону взгляда (data.dir).
  sand(ctx, { cx, cy, size, s, time, p, data }) {
    const k = p ?? (time % 0.7) / 0.7;
    const dir = data?.dir ?? 1;
    for (let i = 0; i < 14; i++) {
      const d = k * size * (0.6 + hash(i) * 0.8);
      px(ctx, cx + dir * d, cy - size * 0.1 + (hash(i + 3) - 0.5) * size * 0.3 * k, s, i % 3 ? '#e0c080' : '#b89050');
    }
  },
  // «Бум»: звёзды над головой.
  bonk(ctx, a) {
    EFFECTS.stars(ctx, a);
    label(ctx, 'бум!', a.cx, a.cy - a.size * 0.95, '#ffe060', 16);
  },
  // Костёр: поленья, пламя; data.meat — мясо на палке.
  campfire(ctx, { cx, cy, size, s, time, data }) {
    const base = cy;
    for (let x = -4; x <= 4; x++) px(ctx, cx + x * s, base, s, '#6a4a2a');
    for (let x = -3; x <= 3; x += 2) px(ctx, cx + x * s, base - s, s, '#4a3018');
    for (let x = -3; x <= 3; x++) {
      const h = 3 + Math.round(2 * Math.abs(Math.sin(time * 10 + x)));
      for (let y = 1; y <= h; y++) px(ctx, cx + x * s, base - s - y * s, s, y > h - 1 ? '#ffe060' : y > h / 2 ? '#ffa020' : '#ff5010');
    }
    if (data?.meat) {
      for (let x = -6; x <= 6; x++) px(ctx, cx + x * s, base - 8 * s, s, '#8a6a4a');
      for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]]) px(ctx, cx + dx * s, base - 8 * s + dy * s, s, '#a0522d');
    }
  },
  // Запах еды: волнистые линии вверх.
  smell(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 3; i++) {
      for (let y = 0; y < 8; y++) {
        const t = (time + y * 0.1) % 1;
        px(ctx, cx + (i - 1) * size * 0.2 + Math.sin(time * 4 + y) * s * 1.5, cy - y * s * 2 - t * s, s, 'rgba(255,255,255,0.6)');
      }
    }
  },
  crumbs(ctx, { cx, cy, size, s, time }) {
    for (let i = 0; i < 6; i++) {
      const t = (time * 1.4 + hash(i)) % 1;
      px(ctx, cx + (hash(i + 7) - 0.3) * size * 0.4, cy - size * 0.2 + t * size * 0.6, s, '#c89050');
    }
  },
};

// Эффекты сцен: у сущности (at — следует за ней, dy — выше её середины) или в точке (x, y над землёй).
export function drawSceneEffects(ctx, effects, world, assets) {
  const s = world.scale;
  for (const e of effects) {
    const fn = EFFECTS[e.name];
    if (!fn) continue;
    let cx = e.x;
    let cy = world.strip.groundY - (e.y ?? 0);
    let size = (assets.body?.frameHeight ?? 32) * s;
    if (e.at) {
      const t = e.at;
      const item = t.category ? assets.item(t.category, t.id) : null;
      size = item ? Math.max(item.frameWidth, item.frameHeight) * s : size;
      const feet = world.strip.groundY - (t.drawY ?? t.y ?? 0);
      cx = t.x;
      cy = feet - (item ? item.frameHeight * s : size) / 2;
    }
    ctx.save();
    fn(ctx, { cx, cy: cy - (e.dy ?? 0), size, s, time: e.time, p: e.duration ? Math.min(1, e.time / e.duration) : null, data: e.data, world });
    ctx.restore();
  }
}

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
  if (effect && EFFECTS[effect.name]) {
    ctx.save();
    EFFECTS[effect.name](ctx, { cx: actor.x, cy: ground - size / 2, size, s, time: effect.time, p: null, world });
    ctx.restore();
  }
  actor.drawTop = Math.round(top) - 6 - (traits.nameShown ? 22 : 0);
  if (!actor.visible || !traits.nameShown) return;
  // «Первое слово»: ник выплывает из облака и встаёт над головой.
  const float = actor.nameFloat;
  if (float && float.time < float.duration) {
    const k = float.time / float.duration;
    const box = actor.bubble?.box;
    const fromX = box ? box.left + box.w / 2 : actor.x;
    const fromY = box ? box.top + box.h / 2 + 11 : top - 60;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.3 + k);
    drawName(ctx, actor.name, fromX + (actor.x - fromX) * k, fromY + (top - 6 - fromY) * k, traits.nameColor);
    ctx.restore();
    return;
  }
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
