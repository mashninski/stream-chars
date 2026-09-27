// Карчмар, спецдействие 3: бочка — уходит за край экрана, выкатывает оттуда бочку через весь низ экрана
// и уходит с ней за другой край; потом возвращается обычным шагом.
export const meta = { title: 'Бочка', weight: 1, order: 3 };

export function* run(s) {
  const me = s.me;
  const home = me.x;
  const near = s.edgeNear(me.x, 70);
  const far = s.edgeFar(me.x, 110);
  const dir = -near.side; // куда катить
  yield s.walk(me, near.off);
  yield 0.8;
  const barrel = s.spawn('props/barrel', { x: near.off + dir * 40, anim: 'roll', facing: dir });
  s.face(me, far.off);
  yield [s.walk(me, far.off - dir * 40, { anim: 'push', speed: 110 }), s.walk(barrel, far.off, { anim: 'roll', speed: 110 })];
  s.remove(barrel);
  yield 1;
  // Возвращается обычным шагом.
  yield s.walk(me, home);
}
