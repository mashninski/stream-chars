// Закрепление зритель → персонаж: data/viewers.json.
// Ключ — id зрителя (сейчас ник в нижнем регистре, в задаче 4 — user_id Twitch).
// Формат: { "viewers": { "<id>": { "character": "<імя>", "name": "<последний ник>" } } }
import fs from 'node:fs';
import path from 'node:path';

export class ViewerStore {
  #file;
  #catalog;
  #viewers = {};
  #tmpCounter = 0;

  constructor(file, catalog) {
    this.#file = file;
    this.#catalog = catalog;
    this.#load();
  }

  #load() {
    let text;
    try {
      text = fs.readFileSync(this.#file, 'utf8');
    } catch {
      return; // файла ещё нет — первый запуск
    }
    try {
      const data = JSON.parse(text);
      if (!data?.viewers || typeof data.viewers !== 'object') throw new Error('няма раздзела viewers');
      this.#viewers = data.viewers;
      console.log(`Замацаваныя персанажы: ${Object.keys(this.#viewers).length} гледачоў з ${path.basename(this.#file)}`);
    } catch (err) {
      // Битый файл не перезаписываем: откладываем в сторону, чтобы его можно было починить руками.
      const aside = this.#file.replace(/\.json$/, `.broken-${Date.now()}.json`);
      fs.renameSync(this.#file, aside);
      console.error(`${path.basename(this.#file)} пашкоджаны (${err.message}). Адкладзены ў ${path.basename(aside)}, пачынаем з пустога спісу.`);
    }
  }

  // Запись через временный файл и переименование: при сбое на диске остаётся
  // либо старый файл, либо новый целиком, но не половина.
  #save() {
    const tmp = `${this.#file}.tmp-${process.pid}-${++this.#tmpCounter}`;
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, JSON.stringify({ viewers: this.#viewers }, null, 2) + '\n');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this.#file);
    } catch (err) {
      console.error(`Не атрымалася запісаць ${path.basename(this.#file)}: ${err.message}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
    }
  }

  // Дизайн, который реже всего закреплён за зрителями; при равенстве — случайный.
  #leastUsed() {
    const counts = new Map(this.#catalog.names().map((n) => [n, 0]));
    for (const { character } of Object.values(this.#viewers)) {
      if (counts.has(character)) counts.set(character, counts.get(character) + 1);
    }
    if (!counts.size) return null;
    const min = Math.min(...counts.values());
    const best = [...counts].filter(([, n]) => n === min).map(([name]) => name);
    return best[Math.floor(Math.random() * best.length)];
  }

  // Персонаж зрителя; нет или исчез из каталога — выдаётся новый. Заодно запоминает последний ник.
  characterFor(viewer) {
    const entry = this.#viewers[viewer.id];
    let character = entry && this.#catalog.get(entry.character)?.name;
    if (!character) {
      if (entry) console.log(`[перс] персанажа «${entry.character}» больш няма ў каталогу — ${viewer.name} атрымлівае новага`);
      character = this.#leastUsed();
      if (!character) return null;
    }
    if (!entry || entry.name !== viewer.name || entry.character !== character) {
      this.#viewers[viewer.id] = { character, name: viewer.name };
      this.#save();
    }
    return character;
  }

  // Закрепить выбранного персонажа. Имя не из каталога — null, ничего не меняется.
  setCharacter(viewer, characterName) {
    const character = this.#catalog.get(characterName)?.name;
    if (!character) return null;
    const entry = this.#viewers[viewer.id];
    if (!entry || entry.character !== character || entry.name !== viewer.name) {
      this.#viewers[viewer.id] = { character, name: viewer.name };
      this.#save();
    }
    return character;
  }
}
