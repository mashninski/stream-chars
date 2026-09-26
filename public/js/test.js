// Тестовая панель: шлёт программе команды join/leave/message/смена персонажа и показывает текущий список.
import { connect } from './connection.js';

const nameInput = document.getElementById('name');
const characterSelect = document.getElementById('character');
const list = document.getElementById('list');
const count = document.getElementById('count');
const status = document.getElementById('status');
const viewers = new Map();

function render() {
  list.replaceChildren();
  count.textContent = viewers.size;
  if (!viewers.size) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Нікога няма';
    list.append(li);
    return;
  }
  for (const viewer of viewers.values()) {
    const li = document.createElement('li');
    const character = document.createElement('span');
    character.className = 'character';
    character.textContent = ` — ${viewer.character ?? 'без персанажа'}`;
    li.append(viewer.name, character);
    li.title = 'Падставіць нік у поле';
    li.onclick = () => {
      nameInput.value = viewer.name;
      nameInput.focus();
    };
    list.append(li);
  }
}

const send = connect(
  (msg) => {
    if (msg.type === 'state') {
      // Каталог персонажей — в выпадающий список, выбранный сохраняется.
      const chosen = characterSelect.value;
      characterSelect.replaceChildren(
        ...Object.keys(msg.characters ?? {}).map((name) => new Option(name, name, false, name === chosen)),
      );
      viewers.clear();
      for (const v of msg.viewers) viewers.set(v.id, v);
    } else if (msg.type === 'join') {
      viewers.set(msg.viewer.id, msg.viewer);
    } else if (msg.type === 'leave') {
      viewers.delete(msg.id);
    } else if (msg.type === 'character') {
      const viewer = viewers.get(msg.id);
      if (viewer) viewer.character = msg.character;
    }
    render();
  },
  (online) => {
    status.textContent = online ? 'Праграма падлучана' : 'Няма злучэння з праграмай';
    status.className = online ? '' : 'off';
  },
);

for (const button of document.querySelectorAll('button[data-action]')) {
  button.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return nameInput.focus();
    send({ type: 'test', action: button.dataset.action, name, character: characterSelect.value });
  };
}

// Enter в поле — «Дадаць гледача».
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.querySelector('button[data-action="join"]').click();
});

render();
