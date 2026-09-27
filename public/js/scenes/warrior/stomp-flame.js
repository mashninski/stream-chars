// Ваяр, спецдействие 2: мощно топает и поднимает меч вверх — вокруг пламя.
export const meta = { title: 'Тупат і полымя', weight: 1, order: 2 };

export function* run(s) {
  const me = s.me;
  s.hold(me, 'props/sword', 'handR');
  for (let i = 0; i < 2; i++) {
    yield s.play(me, 'stomp', 0.35);
    s.effect('dust', { at: me, dy: -40, time: 0.6 });
    yield 0.25;
  }
  s.anim(me, 'sword_up');
  s.effect('sparkle', { at: me, dy: 60, time: 0.8 });
  s.effect('flame', { at: me, dy: -30, time: 3.2, data: { width: 120 } });
  yield 3.2;
}
