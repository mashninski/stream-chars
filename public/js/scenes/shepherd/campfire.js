// Пастух, спецдействие 1: костёр с едой. Подробностей у автора пока нет (claude/open-questions.md) —
// простая сцена: разжигает, жарит, ест, костёр гаснет.
export const meta = { title: 'Вогнішча', weight: 1, order: 1 };

export function* run(s) {
  const me = s.me;
  const fx = s.clampX(me.x + me.facing * 40);
  s.face(me, fx);
  s.anim(me, 'sit');
  s.effect('sparks', { x: fx, y: 5, time: 0.8 });
  yield 0.8;
  const fire = s.effect('campfire', { x: fx, y: 0, data: { meat: true } });
  s.effect('smell', { x: fx, y: 40, time: 4 });
  yield 4;
  // Ест.
  s.effect('crumbs', { at: me, dy: 10, time: 1.5 });
  yield s.play(me, 'drink', 1.5);
  yield s.play(me, 'joy', 1);
  s.stopEffect(fire);
  s.effect('smoke', { x: fx, y: 0, time: 1.2 });
  yield 1.2;
}
