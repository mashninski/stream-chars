// Карчмар, спецдействие 2: драка в таверне — несколько ближайших подходят, карчмар раздаёт выпивку,
// они пьют, толкаются, начинают драться; карчмар смотрит, потом раздаёт подзатыльники — все разлетаются
// (реакция knocked) и расходятся по своим делам.
export const meta = { title: 'Бойка ў карчме', weight: 1, order: 2 };

export function* run(s) {
  const me = s.me;
  const guests = s.nearest(s.world.scenes?.brawlGuests ?? 3, { max: 600 }).filter((a) => s.take(a));
  if (!guests.length) {
    s.hold(me, 'props/mug', 'handR');
    yield s.play(me, 'drink', 1.5);
    return;
  }
  // Подходят к карчмару.
  const spots = [34, -34, 62, -62];
  yield guests.map((g, i) => s.walk(g, me.x + spots[i % spots.length]));
  guests.forEach((g) => s.face(g, me));
  // Раздаёт выпивку.
  for (const g of guests) {
    s.face(me, g);
    yield s.play(me, 'hug', 0.4);
    s.hold(g, 'props/mug', 'handR');
  }
  guests.forEach((g) => s.anim(g, 'drink'));
  yield 2;
  guests.forEach((g) => s.drop(g));
  // Толкаются и дерутся; карчмар смотрит.
  s.anim(me, 'idle');
  const center = guests.reduce((sum, g) => sum + g.x, 0) / guests.length;
  const fightTime = s.world.reactions?.fight ?? 5;
  s.effect('dust', { x: center, y: 10, time: fightTime });
  for (let t = 0; t < fightTime; t += 0.4) {
    for (const g of guests) s.walk(g, g.x + s.between(-15, 15), { anim: 'fight', speed: 80 });
    yield 0.4;
  }
  // Подзатыльники — все разлетаются.
  for (const g of guests) {
    yield s.walk(me, g.x - Math.sign(g.x - me.x || 1) * 20);
    s.face(me, g);
    yield s.play(me, 'slap', 0.4);
    s.effect('bonk', { at: g, dy: 20, time: 0.5 });
    s.affect(g, 'knocked', { from: me.x });
  }
  yield 1.5;
}
