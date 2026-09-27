// Общее действие: помахать (ближайшему соседу, если есть) и обратить на себя внимание:
// над героем большая стрелка, за ним свет, ник на 3 с крупнее; посередине — невысокий медленный подскок.
export const meta = { title: 'Памахаць', kind: 'action' };

export function* run(s) {
  const me = s.me;
  const friend = s.nearest(1, { max: 500 })[0];
  if (friend) s.face(me, friend);
  s.highlight(me, 3);
  s.effect('arrow', { at: me, time: 3.5 });
  s.effect('hello', { at: me, dy: 10, time: 3.5 });
  yield s.play(me, 'wave', 1);
  yield s.fly(me, { y: 0, time: 1.2, arc: 35, anim: 'wave' });
  yield s.play(me, 'wave', 1.3);
}
