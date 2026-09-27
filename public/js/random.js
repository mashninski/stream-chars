// Случайность: выбор по весам и генератор по зерну. Без зависимостей — работает и в программе (Node),
// и в оверлее: программа выбирает класс и сцену, оверлей по зерну — цели и случаи внутри сцены.

// Выбор по весам. entries — [[значение, вес], ...] или { значение: вес }. Вес 0 (и не число) — не выпадает.
// Все веса 0 — null.
export function pickWeighted(entries, rand = Math.random) {
  const list = (Array.isArray(entries) ? entries : Object.entries(entries ?? {})).filter(
    ([, w]) => typeof w === 'number' && Number.isFinite(w) && w > 0,
  );
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  if (!total) return null;
  let r = rand() * total;
  for (const [value, w] of list) {
    if ((r -= w) < 0) return value;
  }
  return list.at(-1)[0];
}

// Проценты выпадения: { значение: вес } → { значение: процент } (0–100, для окна «Рэдкасць»).
export function percentages(weights) {
  const entries = Object.entries(weights ?? {});
  const total = entries.reduce((sum, [, w]) => sum + (w > 0 ? w : 0), 0);
  return Object.fromEntries(entries.map(([k, w]) => [k, total && w > 0 ? (w / total) * 100 : 0]));
}

// Генератор по зерну (mulberry32): одно зерно — одна и та же последовательность в любом оверлее.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed(rand = Math.random) {
  return Math.floor(rand() * 4294967296) >>> 0;
}
