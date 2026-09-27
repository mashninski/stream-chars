// Маг, спецдействие 3: вино — выпивает бутылку залпом, щёлкает пальцами — бутылка снова полная;
// так три раза; пьянеет и падает на минуту (реакция drunkSleep: пузырьки и «хрррр»).
export const meta = { title: 'Віно', weight: 1, order: 3 };

export function* run(s) {
  const me = s.me;
  for (let i = 0; i < 3; i++) {
    s.hold(me, 'props/bottle', 'handR');
    s.effect('bubbles', { at: me, dy: 20, time: 1.2 });
    yield s.play(me, 'drink', 1.2);
    // Щелчок — бутылка снова полная.
    yield s.play(me, 'snap', 0.5);
    s.effect('sparkle', { at: me, dy: 10, time: 0.5 });
    yield 0.3;
  }
  s.drop(me);
  yield s.play(me, 'drunk', 2.5);
  // Дальше — реакция, а не сцена: место для других сцен освобождается.
  s.affect(me, 'drunkSleep');
}
