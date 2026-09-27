// Рэйнджэр, спецдействие 1: незаметность — становится полупрозрачным и быстро бежит в другую сторону
// экрана, в конце спотыкается и падает, прозрачность возвращается.
export const meta = { title: 'Нябачнасць', weight: 1, order: 1 };

export function* run(s) {
  const me = s.me;
  const W = s.world;
  s.effect('sparkle', { at: me, time: 0.6 });
  for (let a = 1; a >= 0.3; a -= 0.1) {
    s.alpha(me, a);
    yield 0.05;
  }
  const far = s.edgeFar();
  yield s.run(me, s.clampX(far.in - far.side * s.between(20, 120)), { anim: 'sneak', speed: W.walkSpeed * 4 });
  // Спотыкается и падает.
  yield s.fly(me, { x: me.x + me.facing * 40, y: 0, time: 0.4, arc: 25, anim: 'knocked' });
  s.alpha(me, 1);
  s.effect('stars', { at: me, time: 1.6 });
  yield s.play(me, 'sleep', 1.4);
  yield s.play(me, 'get_up');
}
