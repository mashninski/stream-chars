// Цвета героев: пространство OKLab и выбор «дальнего цвета». Без зависимостей — работает в программе
// и в оверлее. OKLab — разница чисел близка к тому, как разницу видит глаз.
//
// «Дальний цвет»: кандидаты — сетка оттенков × яркостей × насыщенностей в заданном диапазоне
// (тёмные и блёклые на стриме не читаются); выбирается кандидат, у которого наименьшее расстояние
// до цветов героев на экране — наибольшее. Равные — случайный. Экран пуст — случайный кандидат.

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// OKLab → sRGB 0–255; вне охвата экрана — null.
export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return lin.map((v) => toGamma(Math.min(1, Math.max(0, v))) * 255);
}

export function distance(hexA, hexB) {
  const a = rgbToOklab(hexToRgb(hexA));
  const b = rgbToOklab(hexToRgb(hexB));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Диапазон по умолчанию; поверх — настройки "colors" (config.json).
export const COLOR_DEFAULTS = { lightness: [0.6, 0.85], chroma: [0.1, 0.2], hueStep: 10, steps: 3 };

// Кандидаты: оттенки через hueStep градусов × steps яркостей × steps насыщенностей (OKLCh), только в охвате sRGB.
export function candidates(range = {}) {
  const { lightness, chroma, hueStep, steps } = { ...COLOR_DEFAULTS, ...range };
  const lerp = ([a, b], i) => (steps > 1 ? a + ((b - a) * i) / (steps - 1) : (a + b) / 2);
  const out = [];
  for (let h = 0; h < 360; h += Math.max(1, hueStep)) {
    const rad = (h * Math.PI) / 180;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const L = lerp(lightness, i);
        const C = lerp(chroma, j);
        const rgb = oklabToRgb([L, C * Math.cos(rad), C * Math.sin(rad)]);
        if (rgb) out.push(rgbToHex(rgb));
      }
    }
  }
  return [...new Set(out)];
}

// Дальний цвет от занятых (taken — цвета '#rrggbb' героев на экране).
export function farColor(taken, rand = Math.random, range = {}) {
  const list = candidates(range);
  const labs = taken.map(hexToRgb).filter(Boolean).map(rgbToOklab);
  if (!labs.length) return list[Math.floor(rand() * list.length)];
  let best = [];
  let bestDist = -1;
  for (const hex of list) {
    const c = rgbToOklab(hexToRgb(hex));
    let min = Infinity;
    for (const t of labs) min = Math.min(min, Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]));
    if (min > bestDist + 1e-9) {
      bestDist = min;
      best = [hex];
    } else if (Math.abs(min - bestDist) <= 1e-9) {
      best.push(hex);
    }
  }
  return best[Math.floor(rand() * best.length)];
}

// Окраска маски куртки: серый g (0–255) → цвет героя с сохранением теней и бликов.
// До MASK_BASE — темнее цвета пропорционально, выше — к белому. Возвращает [r, g, b].
export const MASK_BASE = 178;
export function tintGray(g, rgb) {
  if (g <= MASK_BASE) return rgb.map((c) => (c * g) / MASK_BASE);
  const k = (g - MASK_BASE) / (255 - MASK_BASE);
  return rgb.map((c) => c + (255 - c) * k);
}

// Стандартная палитра Twitch для ников без выбранного цвета — по нику, всегда одна и та же.
export const TWITCH_DEFAULT_COLORS = [
  '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57',
  '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F',
];
export function defaultNameColor(login) {
  let h = 0;
  for (const ch of String(login ?? '').toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return TWITCH_DEFAULT_COLORS[h % TWITCH_DEFAULT_COLORS.length];
}
