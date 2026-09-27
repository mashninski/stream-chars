// Маг, спецдействие 1: фаербол — огненный сгусток летит и взрывается; героев в радиусе раскидывает (отброс).
export const meta = { title: 'Фаербол', weight: 1, order: 1 };

export function* run(s) {
  const me = s.me;
  const target = s.nearest(1, { max: 700 })[0];
  const tx = target ? target.x : s.clampX(me.x + (s.chance(0.5) ? 1 : -1) * 300);
  s.face(me, tx);
  s.effect('sparkle', { at: me, dy: 20, time: 1.2 });
  yield s.play(me, 'cast', 1.2);
  s.anim(me, 'snap');
  const ball = s.spawn('props/fireball', { x: me.x + me.facing * 30, y: 45, facing: me.facing });
  yield s.walk(ball, tx, { speed: 520, anim: 'idle' });
  s.remove(ball);
  s.effect('explosion', { x: tx, y: 30, time: 0.7 });
  for (const t of s.inRadius(tx, s.world.scenes?.blastRadius ?? 140)) s.affect(t, 'knocked', { from: tx });
  yield s.play(me, 'joy', 0.8);
}
