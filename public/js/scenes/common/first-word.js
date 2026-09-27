// «Первое слово» — первое сообщение зрителя за всё время: облако с текстом; из облака выплывает ник
// и встаёт над головой; ~10 с герой стоит задумчиво и смотрит на облако; потом радостно подпрыгивает.
// Облако показывает сама сцена (ownsText): оверлей не рисует его заранее.
export const meta = { title: 'Першае слова', kind: 'system', ownsText: true };

export function* run(s) {
  const me = s.me;
  const think = s.world.scenes?.firstWordThinkSeconds ?? 10;
  s.anim(me, 'think');
  if (s.params.text) s.say(me, s.params.text, 0.8 + 1.5 + think);
  yield 0.8;
  yield s.showName(me, 1.5);
  yield think;
  yield s.fly(me, { y: 0, time: 0.5, arc: 40, anim: 'joy' });
  yield s.play(me, 'joy', 0.6);
}
