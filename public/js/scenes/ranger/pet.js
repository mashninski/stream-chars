// Рэйнджэр, спецдействие 2: питомец — прибегает один из зверей (по весам: существа группы pet),
// они радуются друг другу, зверь убегает.
export const meta = {
  title: 'Гадаванец',
  weight: 1,
  order: 2,
  cases: { pet: { title: 'Гадаванец рэйнджэра', from: 'creatures:pet' } },
};

export function* run(s) {
  const me = s.me;
  const W = s.world;
  const id = s.weighted('pet');
  if (!id) return;
  const edge = s.edgeNear();
  const pet = s.spawn(`creatures/${id}`, { x: edge.off, facing: -edge.side });
  s.face(me, pet);
  s.anim(me, 'wave');
  yield s.run(pet, me.x + edge.side * 36, { anim: 'walk', speed: W.walkSpeed * 3 });
  s.face(pet, me);
  s.anim(pet, 'happy');
  s.anim(me, 'joy');
  s.effect('hearts', { x: (me.x + pet.x) / 2, y: 60, time: 3 });
  yield 1.5;
  s.anim(me, 'wave');
  yield 1.5;
  s.anim(me, 'idle');
  yield s.run(pet, edge.off, { anim: 'walk', speed: W.walkSpeed * 3 });
  s.remove(pet);
}
