// Ваяр, спецдействие 3: поднимает меч и бежит в другую часть экрана; там появляется тень,
// они бьются, тень гибнет от удара.
export const meta = { title: 'Бой з ценем', weight: 1, order: 3 };

export function* run(s) {
  const me = s.me;
  const W = s.world;
  s.hold(me, 'props/sword', 'handR');
  yield s.play(me, 'sword_up', 0.6);
  const far = me.x < W.width / 2 ? s.between(W.width * 0.6, W.strip.right - 150) : s.between(W.strip.left + 150, W.width * 0.4);
  yield s.run(me, s.clampX(far));
  const side = me.facing;
  const shadow = s.spawn('creatures/shadow', { x: me.x + side * 110, facing: -side, alpha: 0 });
  s.effect('smoke', { at: shadow, time: 0.8 });
  for (let a = 0; a <= 1; a += 0.1) {
    shadow.alpha = a;
    yield 0.05;
  }
  s.face(me, shadow);
  for (let i = 0; i < 3; i++) {
    s.anim(me, 'fight');
    s.anim(shadow, 'attack');
    s.effect('sparks', { x: (me.x + shadow.x) / 2, y: 50, time: 0.4 });
    yield 0.7;
    s.anim(me, 'sword_up');
    s.anim(shadow, 'idle');
    yield 0.3;
  }
  // Последний удар — тень падает и тает.
  s.anim(me, 'fight');
  s.effect('sparks', { x: shadow.x, y: 50, time: 0.5 });
  yield s.play(shadow, 'hit', 0.5);
  for (let a = 1; a >= 0; a -= 0.1) {
    shadow.alpha = a;
    yield 0.05;
  }
  s.effect('smoke', { at: shadow, time: 0.8 });
  s.remove(shadow);
  yield s.play(me, 'joy', 1);
}
