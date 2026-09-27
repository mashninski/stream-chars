// Общее для админки и её окон: подключение (роль admin), команды с ответом, построение элементов.
// Текст зрителей (ники, сообщения) — только через textContent: чужой текст не становится разметкой.
import { connect } from './connection.js';

// el('button', { class: 'small', title: '…', onclick }, 'текст', другойЭлемент)
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e[k] = v;
    else if (k === 'class') e.className = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

// Подключение админки: onMessage(msg) — всё, что прислала программа; request(cmd, args) → Promise ответа.
export function adminConnection(onMessage, onStatus = () => {}) {
  const waiting = new Map();
  let counter = 0;
  const send = connect(
    (msg) => {
      if (msg.type === 'admin-reply') {
        waiting.get(msg.id)?.(msg);
        waiting.delete(msg.id);
        return;
      }
      onMessage(msg);
    },
    (online) => {
      if (!online) {
        for (const resolve of waiting.values()) resolve({ ok: false, error: 'няма злучэння з праграмай' });
        waiting.clear();
      }
      onStatus(online);
    },
    'admin',
  );
  const request = (cmd, args = {}) =>
    new Promise((resolve) => {
      const id = ++counter;
      waiting.set(id, resolve);
      send({ type: 'admin', id, cmd, ...args });
      setTimeout(() => {
        if (waiting.has(id)) {
          waiting.delete(id);
          resolve({ ok: false, error: 'праграма не адказала' });
        }
      }, 30000);
    });
  return { request, send };
}

// Подпись значения признака: название предмета или варианта из реестра.
export function valueTitle(catalog, trait, value) {
  if (value == null || value === '') return '—';
  if (trait.type === 'item') return catalog.categories?.[trait.category]?.[value]?.title ?? value;
  if (trait.type === 'choice') return trait.values?.[value]?.title ?? value;
  if (trait.type === 'bool') return value ? 'так' : 'не';
  return String(value);
}

// Поле значения признака: список (предметы, варианты), цвет, да/нет. onChange(значение).
export function traitInput(catalog, trait, value, onChange) {
  if (trait.type === 'color') {
    return el('input', { type: 'color', value: value || '#ffffff', title: trait.title, onchange: (e) => onChange(e.target.value) });
  }
  if (trait.type === 'bool') {
    return el('input', { type: 'checkbox', checked: !!value, title: trait.title, onchange: (e) => onChange(e.target.checked) });
  }
  let options = [];
  if (trait.type === 'item') options = Object.values(catalog.categories?.[trait.category] ?? {}).map((it) => [it.id, it.title]);
  if (trait.type === 'choice') options = Object.entries(trait.values ?? {}).map(([id, v]) => [id, v.title ?? id]);
  if (trait.optional || trait.appears !== 'firstSeen') options.unshift(['', '— няма']);
  const sel = el('select', { title: trait.title, onchange: (e) => onChange(e.target.value) });
  for (const [v, t] of options) sel.append(new Option(t, v, false, v === (value ?? '')));
  return sel;
}

// Открыть окно админки. В OBS всплывающее окно может не открыться — тогда подсказка:
// добавить страницу второй док-панелью.
export function openWindow(path, name, hintBox) {
  const w = window.open(path, name, 'width=1100,height=720');
  hintBox.replaceChildren();
  if (!w) {
    hintBox.append(
      'Акно не адкрылася. Дадайце яго асобнай док-панэллю: «Док-панэлі» → «Карыстальніцкія док-панэлі браўзера…», адрас ',
      el('code', {}, `${location.origin}${path}`),
    );
  }
}

// Сохранение открытых разделов в браузере (у каждой док-панели свои).
export function rememberOpen(details, key) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {}
  for (const d of details) {
    if (saved[d.id] !== undefined) d.open = saved[d.id];
    d.addEventListener('toggle', () => {
      saved[d.id] = d.open;
      try {
        localStorage.setItem(key, JSON.stringify(saved));
      } catch {}
    });
  }
}
