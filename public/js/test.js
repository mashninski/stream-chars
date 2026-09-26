// Тестовая панель: шлёт программе команды join/leave/message и показывает текущий список.
import { connect } from './connection.js';

const nameInput = document.getElementById('name');
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
    li.textContent = viewer.name;
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
      viewers.clear();
      for (const v of msg.viewers) viewers.set(v.id, v);
    } else if (msg.type === 'join') {
      viewers.set(msg.viewer.id, msg.viewer);
    } else if (msg.type === 'leave') {
      viewers.delete(msg.id);
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
    send({ type: 'test', action: button.dataset.action, name });
  };
}

// Enter в поле — «Дадаць гледача».
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.querySelector('button[data-action="join"]').click();
});

render();
