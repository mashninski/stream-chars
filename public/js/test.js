// Тестовая панель: шлёт программе команды join/leave/message/смена персонажа/рейд
// и показывает, кто на экране, кто в очереди и сколько рейдеров.
import { connect } from './connection.js';

const nameInput = document.getElementById('name');
const textInput = document.getElementById('text');
const characterSelect = document.getElementById('character');
const channelInput = document.getElementById('channel');
const raidCount = document.getElementById('raidCount');
const status = document.getElementById('status');
// На экране: зрители и рейдеры (у рейдера raider: true). Очередь — порядок выхода.
const onScreen = new Map();
let queue = [];

// Список зрителей: клик по строке подставляет ник в поле.
function renderList(listId, countId, viewers, empty) {
  const list = document.getElementById(listId);
  document.getElementById(countId).textContent = viewers.length;
  list.replaceChildren();
  if (!viewers.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = empty;
    list.append(li);
    return;
  }
  for (const viewer of viewers) {
    const li = document.createElement('li');
    const character = document.createElement('span');
    character.className = 'character';
    character.textContent = ` — ${viewer.character ?? 'без персанажа'}`;
    li.append(viewer.name, character);
    if (!viewer.raider) {
      li.title = 'Падставіць нік у поле';
      li.onclick = () => {
        nameInput.value = viewer.name;
        nameInput.focus();
      };
    }
    list.append(li);
  }
}

function render() {
  const all = [...onScreen.values()];
  renderList('list', 'count', all.filter((v) => !v.raider), 'Нікога няма');
  renderList('queue', 'queueCount', queue, 'Чарга пустая');
  renderList('raiders', 'raidersCount', all.filter((v) => v.raider), 'Рэйду няма');
}

const send = connect(
  (msg) => {
    if (msg.type === 'state') {
      // Каталог персонажей — в выпадающий список, выбранный сохраняется.
      const chosen = characterSelect.value;
      characterSelect.replaceChildren(
        ...Object.keys(msg.characters ?? {}).map((name) => new Option(name, name, false, name === chosen)),
      );
      onScreen.clear();
      for (const v of msg.viewers) onScreen.set(v.id, v);
      queue = msg.queue ?? [];
    } else if (msg.type === 'join') {
      onScreen.set(msg.viewer.id, msg.viewer);
    } else if (msg.type === 'leave') {
      onScreen.delete(msg.id);
    } else if (msg.type === 'queue') {
      queue = msg.queue;
    } else if (msg.type === 'character') {
      const viewer = onScreen.get(msg.id);
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
    send({ type: 'test', action: button.dataset.action, name, character: characterSelect.value, text: textInput.value });
  };
}

document.getElementById('raid').onclick = () => {
  const channel = channelInput.value.trim();
  if (!channel) return channelInput.focus();
  send({ type: 'test', action: 'raid', channel, count: Number(raidCount.value) });
};

// Enter в поле текста — «Паведамленне».
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.querySelector('button[data-action="message"]').click();
});

// Enter в поле ника — «Дадаць гледача».
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.querySelector('button[data-action="join"]').click();
});

render();
