// Общее действие: сесть отдохнуть.
export const meta = { title: 'Сесці адпачыць', kind: 'action' };

export function* run(s) {
  const me = s.me;
  s.effect('zzz', { at: me, dy: -10, time: s.world.scenes?.restSeconds ?? 8 });
  yield s.play(me, 'sit', s.world.scenes?.restSeconds ?? 8);
  yield s.play(me, 'get_up');
}
