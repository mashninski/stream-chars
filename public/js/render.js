// Рисование персонажа спрайтом из characters/<імя>/sheet.png. Логика (actor.js) сюда не входит:
// какую анимацию играть, на какой высоте и с каким эффектом — говорит сам персонаж.
// Кадры в листе смотрят вправо; влево — зеркало. Низ кадра стоит на линии земли.
import { wrapLines } from './actor.js';

// Эффекты вокруг персонажа — рисуются программно, без файлов графики.
// Новый эффект — запись здесь и `effect: '<имя>'` у состояния в actor.js.
const EFFECTS = {
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
function pixelCircle(ctx, cx, cy, r, s) {
  for (let dy = -r; dy <= r; dy += s) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) / s) * s;
    if (half > 0) ctx.fillRect(Math.round((cx - half) / s) * s, Math.round((cy + dy) / s) * s, half * 2, s);
  }
}

// Номер кадра: зацикленная анимация — по кругу, одноразовая (`"loop": false`) — держит последний кадр.
function frameOf(anim, time) {
  const n = Math.floor(time * anim.fps);
  return anim.loop === false ? Math.min(n, anim.frames - 1) : n % anim.frames;
}

// sprite = { info: { frameWidth, frameHeight, animations }, image } или undefined, пока лист не загружен.
// Запоминает у персонажа actor.drawTop — верх надписи над ним (для облака, drawBubbles).
export function drawActor(ctx, actor, world, sprite) {
  const s = world.scale;
  const ground = world.strip.groundY - actor.drawY;
  let top = ground;
  let size = 32 * s;

  if (sprite?.image.complete && sprite.image.naturalWidth) {
    const { frameWidth: fw, frameHeight: fh, animations } = sprite.info;
    const want = actor.animation;
    // Нет нужной анимации у персонажа — запасная, потом idle.
    const anim = animations[want.name] ?? animations[want.fallback] ?? animations.idle;
    const w = fw * s;
    const h = fh * s;
    size = Math.max(w, h);
    top = ground - h;
    if (actor.visible) {
      const left = Math.round(actor.x - w / 2);
      ctx.save();
      ctx.translate(actor.facing < 0 ? left + w : left, Math.round(top));
      if (actor.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(sprite.image, frameOf(anim, want.time) * fw, anim.row * fh, fw, fh, 0, 0, w, h);
      ctx.restore();
    }
  }

  const effect = actor.effect;
  if (effect) EFFECTS[effect.name]?.(ctx, { cx: actor.x, cy: ground - size / 2, size, s, time: effect.time, world });
  actor.drawTop = Math.round(top) - 6 - 22;
  if (!actor.visible) return;

  // Ник над головой, с тёмной обводкой — читается на любом фоне.
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  const nameX = Math.round(actor.x);
  const nameY = Math.round(top) - 6;
  ctx.strokeText(actor.name, nameX, nameY);
  ctx.fillText(actor.name, nameX, nameY);
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
