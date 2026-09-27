// Ваяр, спецдействие 1: крик и удар в щит — соседи в радиусе в панике бегут прочь (реакция panic).
export const meta = { title: 'Крык і ўдар у шчыт', weight: 1, order: 1 };

export function* run(s) {
  const me = s.me;
  s.hold(me, 'props/shield', 'handR');
  s.hold(me, 'props/sword', 'handL');
  yield s.play(me, 'shout', 0.5);
  // Удар мечом в щит: искры и «крик» волнами.
  s.effect('sparks', { at: me, dy: 10, time: 0.5, data: { dx: 1 } });
  s.effect('shout', { at: me, dy: 20, time: 1.5 });
  const radius = s.world.scenes?.shoutRadius ?? 300;
  for (const t of s.inRadius(me.x, radius)) s.affect(t, 'panic', { from: me.x });
  yield s.play(me, 'shout', 1.2);
  s.effect('sparks', { at: me, dy: 10, time: 0.5, data: { dx: 1 } });
  yield 0.6;
}
