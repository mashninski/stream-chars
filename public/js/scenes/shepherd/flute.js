// Пастух, спецдействие 2: флейта — играет, овцы танцуют один из танцев (по весам).
// Новый танец — значение в cases.dance и ветка в DANCES ниже.
export const meta = {
  title: 'Дудка',
  weight: 1,
  order: 2,
  cases: {
    dance: {
      title: 'Танец авечак',
      values: {
        hop: { title: 'Скокі', weight: 1 },
        spin: { title: 'Кружэнне', weight: 1 },
        line: { title: 'Карагод', weight: 1 },
        wave: { title: 'Хваля', weight: 1 },
        moon: { title: 'Месяцовая хада', weight: 1 },
      },
    },
  },
};

// Танцы: s — сцена, sheep — овцы. Каждый ~6 с.
const DANCES = {
  *hop(s, sheep) {
    for (let i = 0; i < 6; i++) yield sheep.map((sh) => s.fly(sh, { y: 0, time: 0.5, arc: 26, anim: 'jump' }));
  },
  *spin(s, sheep) {
    for (let i = 0; i < 24; i++) {
      for (const sh of sheep) sh.facing = -sh.facing;
      yield 0.25;
    }
  },
  *line(s, sheep) {
    for (let i = 0; i < 3; i++) {
      yield sheep.map((sh, k) => s.walk(sh, sh.x + (k % 2 ? 40 : -40), { speed: 60 }));
      yield sheep.map((sh, k) => s.walk(sh, sh.x + (k % 2 ? -40 : 40), { speed: 60 }));
    }
  },
  *wave(s, sheep) {
    for (let i = 0; i < 4; i++) {
      for (const sh of sheep) {
        s.fly(sh, { y: 0, time: 0.5, arc: 30, anim: 'jump' });
        yield 0.2;
      }
      yield 0.8;
    }
  },
  *moon(s, sheep) {
    for (let i = 0; i < 2; i++) {
      yield sheep.map((sh) => s.walk(sh, sh.x + 50, { speed: 35, backwards: true }));
      yield sheep.map((sh) => s.walk(sh, sh.x - 50, { speed: 35, backwards: true }));
    }
  },
};

export function* run(s) {
  const me = s.me;
  const W = s.world;
  const dance = s.weighted('dance') ?? 'hop';
  s.hold(me, 'props/flute', 'handR');
  s.anim(me, 'flute');
  const notes = s.effect('notes', { at: me, dy: 20 });
  const edge = s.edgeNear();
  const sheep = [0, 1, 2].map((i) => s.spawn('creatures/sheep', { x: edge.off + edge.side * i * 30, facing: -edge.side }));
  yield sheep.map((sh, i) => s.run(sh, me.x + edge.side * (50 + i * 40), { anim: 'walk', speed: W.walkSpeed * 2.5 }));
  for (const sh of sheep) s.face(sh, me);
  yield* (DANCES[dance] ?? DANCES.hop)(s, sheep);
  s.stopEffect(notes);
  s.anim(me, 'joy');
  yield sheep.map((sh, i) => s.run(sh, edge.off + edge.side * i * 30, { anim: 'walk', speed: W.walkSpeed * 2.5 }));
  sheep.forEach((sh) => s.remove(sh));
}
