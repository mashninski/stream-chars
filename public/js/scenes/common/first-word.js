// «Первое слово» — первое сообщение зрителя за всё время: над головой хлопком появляется ник,
// герой ~2 с смотрит на него, потом радостно подлетает с поднятыми руками — и в этот момент
// появляется облако с текстом (держится как обычное, bubble в config.json).
// Облако показывает сама сцена (ownsText): оверлей не рисует его заранее.
export const meta = { title: 'Першае слова', kind: 'system', ownsText: true };

export function* run(s) {
  const me = s.me;
  const look = s.world.scenes?.firstWordLookSeconds ?? 2;
  s.anim(me, 'idle');
  // Хлопок там, где встанет ник: чуть выше верха героя (drawTop — верх, который рисует оверлей).
  const groundY = s.world.strip?.groundY ?? 0;
  const nameY = me.drawTop !== undefined ? groundY - (me.drawTop - 11) : 90;
  s.effect('poof', { x: me.x, y: nameY, time: s.world.poofTime ?? 0.6 });
  yield 0.15;
  yield s.showName(me, 0);
  yield look;
  if (s.params.text) s.say(me, s.params.text);
  yield s.fly(me, { y: 0, time: 1.5, arc: 90, anim: 'joy' });
  yield s.play(me, 'joy', 0.6);
}
