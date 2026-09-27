// Смена выгляда: новый головной убор (стал фолловером), смена класса, пола, цвета за баллы или из админки.
// Сам признак уже поменяла программа — здесь «пух» и радость.
export const meta = { title: 'Змена выгляду', kind: 'system' };

export function* run(s) {
  const me = s.me;
  s.effect('poof', { at: me, time: 0.6 });
  s.effect('sparkle', { at: me, dy: 30, time: 0.8 });
  yield s.play(me, 'joy', 1);
}
