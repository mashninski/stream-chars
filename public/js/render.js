// Рисование персонажа. Заглушка: цветной прямоугольник с «глазом» в сторону взгляда.
// В задаче 2 заменяется на спрайт; логика (actor.js) при этом не меняется.

// Размер заглушки в «пикселях арта», на экране умножается на world.scale.
const BODY_W = 14;
const BODY_H = 22;

// Цвет от ника: один и тот же ник — всегда один цвет.
export function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 70%, 55%)`;
}

export function drawActor(ctx, actor, world) {
  const s = world.scale;
  const w = BODY_W * s;
  const h = BODY_H * s;
  const left = Math.round(actor.x - w / 2);
  const top = world.strip.groundY - h;

  ctx.fillStyle = colorFor(actor.name);
  ctx.fillRect(left, top, w, h);

  // Глаз: 2×2 пикселя арта, со стороны взгляда.
  ctx.fillStyle = '#111';
  const eyeX = actor.facing > 0 ? left + w - 5 * s : left + 3 * s;
  ctx.fillRect(eyeX, top + 5 * s, 2 * s, 2 * s);

  // Ник над головой, с тёмной обводкой — читается на любом фоне.
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  const nameX = Math.round(actor.x);
  const nameY = top - 6;
  ctx.strokeText(actor.name, nameX, nameY);
  ctx.fillText(actor.name, nameX, nameY);
}
