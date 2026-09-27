// Злодзей, спецдействие 2: песок в глаза — встаёт в выжидающую позу на одном колене; первый подошедший
// получает песок в глаза (реакция rubEyes), злодзей убегает. Никто не подошёл за world.scenes.ambushSeconds —
// встаёт и идёт дальше.
export const meta = { title: 'Пясок у вочы', weight: 1, order: 2 };

export function* run(s) {
  const me = s.me;
  s.anim(me, 'kneel');
  const near = s.world.scenes?.ambushDistance ?? 60;
  const victim = yield s.until(() => s.others().find((a) => Math.abs(a.x - me.x) < near), s.world.scenes?.ambushSeconds ?? 20);
  if (!victim) {
    yield s.play(me, 'get_up');
    return;
  }
  s.face(me, victim);
  s.effect('sand', { at: me, dy: 10, time: 0.7, data: { dir: me.facing } });
  yield 0.3;
  s.affect(victim, 'rubEyes');
  yield s.run(me, s.clampX(me.x - me.facing * 300));
}
