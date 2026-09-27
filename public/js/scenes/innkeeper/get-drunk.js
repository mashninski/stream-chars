// Карчмар, спецдействие 1: напоить — ближайший герой попадает под руку: карчмар обнимает его и вливает
// в глотку бочонок вина; тот падает и спит (реакция drunkSleep); карчмар идёт дальше.
export const meta = { title: 'Напаіць', weight: 1, order: 1 };

export function* run(s) {
  const me = s.me;
  const t = s.nearest(1, { max: 600 })[0];
  if (!t || !s.take(t)) {
    // Некого — пьёт сам.
    s.hold(me, 'props/keg', 'handR');
    yield s.play(me, 'drink', 1.5);
    return;
  }
  s.anim(t, 'idle');
  yield s.walk(me, t.x - Math.sign(t.x - me.x || 1) * 18);
  s.face(me, t);
  s.face(t, me);
  s.hold(me, 'props/keg', 'handR');
  s.anim(me, 'hug');
  s.anim(t, 'drink');
  s.effect('bubbles', { at: t, dy: 20, time: 2.5 });
  yield 2.5;
  s.drop(me);
  s.affect(t, 'drunkSleep');
  yield s.walk(me, s.clampX(me.x + me.facing * 160));
}
