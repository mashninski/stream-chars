// Пастух, спецдействие 3: секретный агент — пастух с овцами идёт к краю экрана; с другого края прибегает
// овца-шпион (чёрный костюм, тёмные очки), оглядывается, передаёт пакет документов и убегает;
// пастух быстро изучает пакет и прячет в карман.
export const meta = { title: 'Сакрэтны агент', weight: 1, order: 3 };

export function* run(s) {
  const me = s.me;
  const W = s.world;
  const near = s.edgeNear();
  const far = s.edgeFar();
  const toEdge = near.side;
  const sheep = [40, 75].map((d) => s.spawn('creatures/sheep', { x: me.x - toEdge * d, facing: toEdge }));
  sheep.forEach((sh) => s.effect('poof', { at: sh, time: 0.5 }));
  yield 0.4;
  const stop = near.in - near.side * 60;
  yield [s.walk(me, stop), s.walk(sheep[0], stop - toEdge * 40), s.walk(sheep[1], stop - toEdge * 75)];
  s.face(me, far.off);
  // Шпион — с другого края.
  const spy = s.spawn('creatures/spy-sheep', { x: far.off, facing: -far.side });
  yield s.run(spy, me.x - toEdge * 40, { anim: 'walk', speed: W.walkSpeed * 4 });
  yield s.play(spy, 'look', 1.5);
  s.hold(me, 'props/docs', 'handR');
  s.effect('sparkle', { at: me, time: 0.4 });
  yield 0.4;
  yield s.run(spy, far.off, { anim: 'walk', speed: W.walkSpeed * 4 });
  s.remove(spy);
  // Быстро изучает и прячет в карман.
  yield s.play(me, 'read', 1.5);
  s.drop(me);
  yield s.play(me, 'pat_pockets', 0.6);
  yield sheep.map((sh, i) => s.walk(sh, near.off + near.side * i * 30));
  sheep.forEach((sh) => s.remove(sh));
}
