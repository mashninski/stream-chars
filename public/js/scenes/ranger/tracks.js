// Рэйнджэр, спецдействие 3: поиск следов — достаёт комично большую лупу и какое-то время ищет следы на земле.
export const meta = { title: 'Пошук слядоў', weight: 1, order: 3 };

export function* run(s) {
  const me = s.me;
  s.hold(me, 'props/magnifier', 'handR');
  s.effect('sparkle', { at: me, time: 0.4 });
  for (let i = 0; i < 4; i++) {
    yield s.walk(me, s.clampX(me.x + s.between(-120, 120)), { anim: 'search', speed: 25 });
    s.effect('question', { at: me, time: 1 });
    yield s.play(me, 'search', 1.2);
  }
  s.effect('exclaim', { at: me, time: 1 });
  yield s.play(me, 'joy', 1);
}
