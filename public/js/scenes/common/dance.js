// Общее действие: потанцевать.
export const meta = { title: 'Патанцаваць', kind: 'action' };

export function* run(s) {
  const me = s.me;
  const notes = s.effect('notes', { at: me, dy: 20 });
  for (let i = 0; i < 3; i++) {
    yield s.play(me, 'dance', 1.4);
    me.facing = -me.facing;
  }
  s.stopEffect(notes);
  yield s.play(me, 'joy', 0.6);
}
