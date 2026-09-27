// Злодзей, спецдействие 3: арест — прибегают стражники, заламывают его и ведут к краю экрана; у края он
// раздаёт подзатыльники, делает сальто, бежит к другому краю и убегает за экран, стражники — за ним;
// потом он возвращается с другого края на своё место.
export const meta = { title: 'Арышт', weight: 1, order: 3 };

export function* run(s) {
  const me = s.me;
  const W = s.world;
  const home = me.x;
  const near = s.edgeNear();
  const far = s.edgeFar();
  const inward = -near.side; // от ближнего края к середине
  const g1 = s.spawn('creatures/guard', { x: near.off, facing: inward });
  const g2 = s.spawn('creatures/guard', { x: near.off + near.side * 50, facing: inward });
  s.effect('exclaim', { at: me, time: 1 });
  s.face(me, g1);
  const fast = { speed: W.walkSpeed * 3.5 };
  yield [s.run(g1, me.x - inward * 26, fast), s.run(g2, me.x + inward * 26, fast)];
  s.face(g1, me);
  s.face(g2, me);
  s.anim(g1, 'grab');
  s.anim(g2, 'grab');
  s.anim(me, 'angry');
  yield 1;
  // Ведут к ближнему краю — все вместе, одной скоростью.
  const to = near.in - near.side * 40;
  const shift = to - me.x;
  const slow = { speed: 50 };
  yield [s.walk(me, to, { ...slow, anim: 'angry' }), s.walk(g1, g1.x + shift, slow), s.walk(g2, g2.x + shift, slow)];
  // Подзатыльники.
  for (const g of [g1, g2]) {
    s.face(me, g);
    s.anim(me, 'fight');
    s.effect('bonk', { at: g, dy: 20, time: 0.6 });
    s.anim(g, 'hit');
    yield 0.5;
  }
  // Сальто — и бегом к другому краю, за экран. Стражники — следом.
  yield s.fly(me, { x: me.x + inward * 120, y: 0, time: 0.8, arc: 70, anim: 'flip' });
  const escape = s.run(me, far.off, { speed: W.walkSpeed * 4 });
  yield 0.6;
  s.anim(g1, 'idle');
  s.anim(g2, 'idle');
  yield 0.4;
  const chase = { speed: W.walkSpeed * 3.2 };
  yield [escape, s.run(g1, far.off + far.side * 40, chase), s.run(g2, far.off + far.side * 90, chase)];
  s.remove(g1);
  s.remove(g2);
  yield 1.5;
  // Возвращается с другого края на своё место.
  s.place(me, near.off, 0);
  yield s.walk(me, home);
}
