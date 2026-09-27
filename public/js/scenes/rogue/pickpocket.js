// Злодзей, спецдействие 1: кража кошелька — появляется за спиной случайного героя, ворует кошелёк;
// тот секунду не замечает; злодзей убегает; жертва хлопает по карманам, кричит и ~6 с бегает
// в злости и панике (реакции patPockets, rage).
export const meta = { title: 'Крадзеж кашалька', weight: 1, order: 1 };

export function* run(s) {
  const me = s.me;
  const victim = s.randomOne();
  if (!victim || !s.take(victim)) {
    // Некого обокрасть — задумался и пошёл дальше.
    yield s.play(me, 'think', 1.5);
    return;
  }
  s.anim(victim, 'idle');
  s.effect('poof', { at: me, time: 0.6 });
  s.alpha(me, 0);
  yield 0.3;
  s.place(me, victim.x - victim.facing * 26, 0);
  s.face(me, victim);
  s.effect('poof', { at: me, time: 0.6 });
  s.alpha(me, 1);
  yield 0.4;
  yield s.play(me, 'steal', 0.8);
  s.hold(me, 'props/purse', 'handR');
  const escape = s.run(me, s.clampX(me.x + (me.x < victim.x ? -1 : 1) * 380));
  // Жертва секунду ничего не замечает.
  yield 1;
  yield s.affect(victim, 'patPockets');
  s.affect(victim, 'rage');
  yield escape;
  yield s.play(me, 'joy', 0.8);
}
