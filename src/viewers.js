// Список зрителей, у которых сейчас есть персонаж на экране.
// Источник событий любой: тестовая панель сейчас, Twitch в задаче 4.
// Сервер подписывается на события и пересылает их оверлею.
import { EventEmitter } from 'node:events';

export class Viewers extends EventEmitter {
  #byId = new Map();
  #store;

  // store — закрепление зритель → персонаж (store.js).
  constructor(store) {
    super();
    this.#store = store;
  }

  // viewer = { id, name }. id — ключ (в задаче 4 станет user_id Twitch), name — ник как есть.
  // На экран уходит { id, name, character }; character = null, если каталог пуст.
  join({ id, name }) {
    if (this.#byId.has(id)) return false;
    const viewer = { id, name, character: this.#store.characterFor({ id, name }) };
    this.#byId.set(id, viewer);
    this.emit('join', viewer);
    return true;
  }

  // Смена персонажа: тестовая панель сейчас, команда `!перс` в задаче 5.
  // Работает и для зрителя не на экране — выбор запоминается до его появления.
  // Имя не из каталога — ничего не меняется, событие 'unknownCharacter'.
  choose({ id, name }, characterName) {
    const character = this.#store.setCharacter({ id, name }, characterName);
    if (!character) {
      this.emit('unknownCharacter', { id, name }, characterName);
      return false;
    }
    const viewer = this.#byId.get(id);
    if (viewer && viewer.character !== character) {
      viewer.character = character;
      this.emit('character', viewer);
    }
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
