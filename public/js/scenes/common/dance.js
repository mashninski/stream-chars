// Общее действие: потанцевать (scenes.danceSeconds, по умолчанию 15 с), каждые 1,4 с — разворот.
export const meta = { title: 'Патанцаваць', kind: 'action' };

export function* run(s) {
  const me = s.me;
  const total = s.world.scenes?.danceSeconds ?? 15;
  const notes = s.effect('notes', { at: me, dy: 20 });
  for (let left = total; left > 0; left -= 1.4) {
    yield s.play(me, 'dance', Math.min(1.4, left));
    me.facing = -me.facing;
  }
  s.stopEffect(notes);
  yield s.play(me, 'joy', 0.6);
}
