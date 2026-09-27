// Тестовая панель: шлёт программе команды join/leave/message/смена признака/рейд
// и показывает, кто на экране, кто в очереди и сколько рейдеров.
import { connect } from './connection.js';

const nameInput = document.getElementById('name');
const textInput = document.getElementById('text');
const traitSelect = document.getElementById('trait');
const valueBox = document.getElementById('valueBox');
const channelInput = document.getElementById('channel');
const raidCount = document.getElementById('raidCount');
const status = document.getElementById('status');
// На экране: зрители и рейдеры (у рейдера raider: true). Очередь — порядок выхода.
const onScreen = new Map();
let queue = [];
// Каталог и реестр признаков — из 'state'.
let catalog = { categories: {}, traits: [] };

// Подпись значения признака: название предмета или значения из реестра.
function valueTitle(trait, value) {
  if (value == null) return '—';
  if (trait.type === 'item') return catalog.categories[trait.category]?.[value]?.title ?? value;
  if (trait.type === 'choice') return trait.values[value]?.title ?? value;
  return String(value);
}

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
    const info = document.createElement('span');
    info.className = 'character';
    const t = viewer.traits ?? {};
    const shown = catalog.traits.filter((tr) => tr.appears === 'firstSeen' && tr.type !== 'color');
    info.textContent = ` — ${shown.map((tr) => valueTitle(tr, t[tr.id])).join(', ')}`;
    li.append(viewer.name, info);
    if (t.color) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = t.color;
      li.append(sw);
    }
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

// Поле значения под выбранный признак: список (предметы, варианты), цвет, да/нет.
let valueInput = null;
function renderValueInput() {
  const trait = catalog.traits.find((t) => t.id === traitSelect.value);
  valueBox.replaceChildren();
  if (!trait) return;
  if (trait.type === 'color') {
    valueInput = Object.assign(document.createElement('input'), { type: 'color', value: '#e05050' });
  } else {
    valueInput = document.createElement('select');
    let options = [];
    if (trait.type === 'bool') options = [['true', 'так'], ['false', 'не']];
    else if (trait.type === 'item') options = Object.values(catalog.categories[trait.category] ?? {}).map((it) => [it.id, it.title]);
    else if (trait.type === 'choice') options = Object.entries(trait.values).map(([id, v]) => [id, v.title ?? id]);
    if (trait.optional) options.unshift(['', '— няма']);
    valueInput.replaceChildren(...options.map(([v, t]) => new Option(t, v)));
  }
  valueBox.append(valueInput);
}
traitSelect.onchange = renderValueInput;

const send = connect(
  (msg) => {
    if (msg.type === 'state') {
      catalog = msg.catalog ?? catalog;
      const chosen = traitSelect.value;
      traitSelect.replaceChildren(
        ...catalog.traits.filter((t) => t.admin).map((t) => new Option(t.title, t.id, false, t.id === chosen)),
      );
      renderValueInput();
      onScreen.clear();
      for (const v of msg.viewers) onScreen.set(v.id, v);
      queue = msg.queue ?? [];
    } else if (msg.type === 'join') {
      onScreen.set(msg.viewer.id, msg.viewer);
    } else if (msg.type === 'leave') {
      onScreen.delete(msg.id);
    } else if (msg.type === 'queue') {
      queue = msg.queue;
    } else if (msg.type === 'traits') {
      const viewer = onScreen.get(msg.id);
      if (viewer) viewer.traits = msg.traits;
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
    send({ type: 'test', action: button.dataset.action, name, text: textInput.value, trait: traitSelect.value, value: valueInput?.value ?? '' });
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
