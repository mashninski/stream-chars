// Журнал программы — один на всех вместо console.log.
// Пишет в терминал, в файл <папка данных>/logs/<дата>.log (хранятся 7 последних файлов)
// и в кольцо последних строк для админки. Уровни: обычная (info) и ошибка (error).
// Секреты: значение, отданное в log.secret(), в журнал не попадает — заменяется на «***».
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const pad = (n) => String(n).padStart(2, '0');
const dateOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export class Log extends EventEmitter {
  #dir = null;
  #keep = 7;
  #ringSize = 500;
  #ring = [];
  #secrets = new Set();
  #fileDate = null;
  #now;
  #quiet;

  // now — подменяется в проверке; quiet — не писать в терминал (проверки).
  constructor({ now = () => new Date(), quiet = false } = {}) {
    super();
    this.#now = now;
    this.#quiet = quiet;
  }

  // Папка файлов журнала. До вызова журнал пишет только в терминал и кольцо.
  init({ dir, keep = 7, ringSize = 500 }) {
    this.#dir = dir;
    this.#keep = keep;
    this.#ringSize = ringSize;
    this.#fileDate = null;
  }

  secret(value) {
    if (value && String(value).length >= 4) this.#secrets.add(String(value));
  }

  info(...parts) {
    this.#write('info', parts);
  }

  error(...parts) {
    this.#write('error', parts);
  }

  // Последние строки для админки: [{ time, level, text }].
  lines() {
    return [...this.#ring];
  }

  #write(level, parts) {
    let text = parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    for (const s of this.#secrets) text = text.split(s).join('***');
    const d = this.#now();
    const line = { time: d.getTime(), level, text };
    this.#ring.push(line);
    if (this.#ring.length > this.#ringSize) this.#ring.splice(0, this.#ring.length - this.#ringSize);
    if (!this.#quiet) (level === 'error' ? console.error : console.log)(text);
    this.#toFile(d, level, text);
    this.emit('line', line);
  }

  #toFile(d, level, text) {
    if (!this.#dir) return;
    const date = dateOf(d);
    try {
      if (date !== this.#fileDate) {
        fs.mkdirSync(this.#dir, { recursive: true });
        this.#fileDate = date;
        this.#prune();
      }
      const mark = level === 'error' ? ' [памылка]' : '';
      fs.appendFileSync(path.join(this.#dir, `${date}.log`), `${date} ${timeOf(d)}${mark} ${text}\n`);
    } catch (err) {
      // Диск недоступен — журнал остаётся в терминале и админке, программа работает дальше.
      if (!this.#quiet) console.error(`Журнал не запісваецца ў файл: ${err.message}`);
      this.#dir = null;
    }
  }

  // Старые файлы журнала: остаются #keep последних по дате (имя файла — дата, сортируется как текст).
  #prune() {
    const files = fs.readdirSync(this.#dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    const today = `${this.#fileDate}.log`;
    if (!files.includes(today)) files.push(today);
    files.sort();
    for (const f of files.slice(0, Math.max(0, files.length - this.#keep))) {
      fs.rmSync(path.join(this.#dir, f), { force: true });
    }
  }
}

// Журнал программы. Модули пишут сюда; server.js при запуске говорит, где папка.
export const log = new Log();
