// Список зрителей, у которых сейчас есть персонаж на экране.
// Источник событий любой: тестовая панель сейчас, Twitch в задаче 4.
// Сервер подписывается на события и пересылает их оверлею.
import { EventEmitter } from 'node:events';

export class Viewers extends EventEmitter {
  #byId = new Map();

  // viewer = { id, name }. id — ключ (в задаче 4 станет user_id Twitch), name — ник как есть.
  join(viewer) {
    if (this.#byId.has(viewer.id)) return false;
    this.#byId.set(viewer.id, viewer);
    this.emit('join', viewer);
    return true;
  }

  leave(id) {
    const viewer = this.#byId.get(id);
    if (!viewer) return false;
    this.#byId.delete(id);
    this.emit('leave', viewer);
    return true;
  }

  message(id, text) {
    const viewer = this.#byId.get(id);
    if (!viewer) return false;
    this.emit('message', viewer, text);
    return true;
  }

  list() {
    return [...this.#byId.values()];
  }
}
