// Маг, спецдействие 2: блинк — долго и пафосно кастует телепорт, телепортируется в случайное место
// вверху экрана, пугается и падает.
export const meta = { title: 'Блінк', weight: 1, order: 2 };

export function* run(s) {
  const me = s.me;
  const W = s.world;
  s.effect('runes', { at: me, dy: -40, time: 3.2 });
  s.effect('sparkle', { at: me, dy: 20, time: 3.2 });
  yield s.play(me, 'cast', 3.2);
  s.effect('poof', { at: me, time: 0.6 });
  s.alpha(me, 0);
  yield 0.3;
  // Вверху экрана: высота над землёй почти до верхнего края.
  s.place(me, s.between(W.strip.left + 50, W.strip.right - 50), W.strip.groundY - 150);
  s.effect('poof', { at: me, time: 0.6 });
  s.alpha(me, 1);
  s.effect('exclaim', { at: me, time: 1 });
  yield s.play(me, 'panic', 0.9);
  yield s.fall(me);
  s.effect('dust', { at: me, dy: -40, time: 0.5 });
  yield s.play(me, 'land');
  yield s.play(me, 'shake');
}
