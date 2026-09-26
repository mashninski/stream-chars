// Рисование персонажа спрайтом из characters/<імя>/sheet.png. Логика (actor.js) сюда не входит:
// какую анимацию играть, на какой высоте и с каким эффектом — говорит сам персонаж.
// Кадры в листе смотрят вправо; влево — зеркало. Низ кадра стоит на линии земли.

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
