// Рисование персонажа спрайтом из characters/<імя>/sheet.png. Логика (actor.js) сюда не входит.
// Кадры в листе смотрят вправо; влево — зеркало. Низ кадра стоит на линии земли.

// Состояние логики → анимация листа. Нет такой анимации у персонажа — idle.
const ANIMATION_FOR_STATE = { idle: 'idle', walk: 'walk', leave: 'walk' };

// sprite = { info: { frameWidth, frameHeight, animations }, image } или undefined, пока лист не загружен.
export function drawActor(ctx, actor, world, sprite) {
  const s = world.scale;
  let top = world.strip.groundY;

  if (sprite?.image.complete && sprite.image.naturalWidth) {
    const { frameWidth: fw, frameHeight: fh, animations } = sprite.info;
    const anim = animations[ANIMATION_FOR_STATE[actor.state] ?? actor.state] ?? animations.idle;
    const frame = Math.floor(actor.stateTime * anim.fps) % anim.frames;
    const w = fw * s;
    const h = fh * s;
    const left = Math.round(actor.x - w / 2);
    top = world.strip.groundY - h;

    ctx.save();
    ctx.translate(actor.facing < 0 ? left + w : left, top);
    if (actor.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(sprite.image, frame * fw, anim.row * fh, fw, fh, 0, 0, w, h);
    ctx.restore();
  }

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
