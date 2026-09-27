// Общее действие: помахать (ближайшему соседу, если есть).
export const meta = { title: 'Памахаць', kind: 'action' };

export function* run(s) {
  const me = s.me;
  const friend = s.nearest(1, { max: 500 })[0];
  if (friend) s.face(me, friend);
  s.effect('hello', { at: me, dy: 10, time: 2.5 });
  yield s.play(me, 'wave', 2.5);
}
