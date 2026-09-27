// Картинки каталога героев в оверлее: загрузка, окраска маски куртки (с кэшем по паре «лист + цвет»),
// выбор анимации с запасными. Каталог приходит от программы (catalog.toClient() + реестр признаков).
import { hexToRgb, tintGray } from './color.js';

export class Assets {
  #images = new Map();
  #tinted = new Map();

  constructor(catalog) {
    this.catalog = catalog ?? { body: null, categories: {}, traits: [] };
    for (const items of Object.values(this.catalog.categories ?? {})) {
      for (const it of Object.values(items)) {
        if (it.image) this.#load(it.image);
        for (const layers of Object.values(it.layers ?? {})) for (const url of Object.values(layers)) this.#load(url);
      }
    }
  }

  #load(url) {
    if (this.#images.has(url)) return;
    const img = new Image();
    img.src = url;
    this.#images.set(url, img);
  }

  get body() {
    return this.catalog.body;
  }

  get traits() {
    return this.catalog.traits ?? [];
  }

  item(category, id) {
    return id == null ? undefined : this.catalog.categories?.[category]?.[id];
  }

  // Готовая картинка или null (ещё грузится, не загрузилась).
  image(url) {
    const img = this.#images.get(url);
    return img?.complete && img.naturalWidth ? img : null;
  }

  // Маска в оттенках серого → окрашенный лист. Кэш по паре «лист + цвет».
  tinted(url, hex) {
    const key = `${url}|${hex}`;
    const hit = this.#tinted.get(key);
    if (hit) return hit;
    const img = this.image(url);
    const rgb = hexToRgb(hex);
    if (!img || !rgb) return img;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    const data = c.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const [r, g, b] = tintGray(px[i], rgb);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
    c.putImageData(data, 0, 0);
    this.#tinted.set(key, canvas);
    return canvas;
  }

  // Анимация по имени: своя → запасная из body.json (цепочкой) → запасная состояния → idle.
  resolveAnim(animations, name, fallback = 'idle') {
    const fb = this.body?.fallbacks ?? {};
    let n = name;
    for (let i = 0; i < 5 && n; i++) {
      if (animations?.[n]) return animations[n];
      n = fb[n];
    }
    return animations?.[fallback] ?? animations?.idle;
  }

  // Длина анимации вещи сцены ({ category, id }), с.
  itemAnimLength(thing, name) {
    const it = this.item(thing.category, thing.id);
    const a = it && this.resolveAnim(it.animations, name);
    return a ? a.frames / a.fps : undefined;
  }

  // Длина анимации героя, с (логике — когда кончилась одноразовая).
  heroAnimLength(traits, name) {
    const cls = this.item('classes', traits?.class);
    const a = cls && this.resolveAnim(cls.animations, name);
    return a ? a.frames / a.fps : undefined;
  }
}
