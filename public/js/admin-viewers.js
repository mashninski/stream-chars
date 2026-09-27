// Окно «Персанажы» (/admin/viewers): все зрители с героем. Онлайн — сверху. Ник — его цветом.
// Признаки — выпадающими списками из реестра (меняются сразу); кнопки спецдействий класса («1», «2», «3»,
// название — по наведению) и общих действий. Столбцы — из реестра: новый признак появится сам.
// Сотни строк: рисуются только видимые (виртуальный список).
import { el, adminConnection, traitInput } from './admin-common.js';

const ROW = 44;
const $ = (id) => document.getElementById(id);
const scroller = $('scroller');
const rowsBox = $('rows');
let catalog = { categories: {}, traits: [] };
let specials = {};
let common = [];
const byId = new Map();
let shown = [];

function sortKey(r) {
  return [r.online ? 0 : r.queued ? 1 : 2, (r.name ?? '').toLowerCase()];
}

function refilter() {
  const q = $('search').value.trim().toLowerCase();
  shown = [...byId.values()].filter((r) => !q || (r.name ?? '').toLowerCase().includes(q));
  shown.sort((a, b) => {
    const [x1, y1] = sortKey(a);
    const [x2, y2] = sortKey(b);
    return x1 - x2 || (y1 < y2 ? -1 : y1 > y2 ? 1 : 0);
  });
  const online = [...byId.values()].filter((r) => r.online).length;
  $('count').textContent = `усяго ${byId.size}, на экране ${online}${q ? `, знойдзена ${shown.length}` : ''}`;
  rowsBox.style.height = `${(shown.length + 1) * ROW}px`;
  draw();
}

async function run(cmd, args) {
  const r = await request(cmd, args);
  $('error').textContent = r.ok ? '' : r.error;
}

function rowEl(r, i) {
  const traits = catalog.traits.filter((t) => t.admin);
  const nameColor = r.traits?.nameColor || '#ffffff';
  const row = el('div', { class: 'vrow', style: `top:${i * ROW}px` },
    el('span', { class: 'name', style: `color:${nameColor}`, title: r.id }, r.name),
    el('span', { class: 'online' }, el('span', { class: `badge ${r.online ? 'on' : r.queued ? 'q' : ''}` }, r.online ? 'на экране' : r.queued ? 'у чарзе' : 'не тут')),
  );
  for (const t of traits) {
    row.append(traitInput(catalog, t, r.traits?.[t.id], (value) => run('trait.set', { id: r.id, trait: t.id, value })));
  }
  const acts = el('span', { class: 'acts' });
  (specials[r.traits?.class] ?? []).forEach((s, k) => acts.append(el('button', { title: s.title, onclick: () => run('act', { id: r.id, action: s.id }) }, String(k + 1))));
  for (const a of common) acts.append(el('button', { title: a.title, onclick: () => run('act', { id: r.id, action: a.id }) }, a.title.slice(0, 3)));
  if (r.pending) acts.append(el('span', { class: 'muted', title: 'Дзеянні чакаюць, пакуль гледач з\'явіцца' }, `⏳${r.pending}`));
  row.append(acts);
  return row;
}

// Заголовок столбцов — из реестра признаков (те же ширины, что у строк).
function header() {
  const h = el('div', { class: 'vrow vhead' }, el('span', { class: 'name' }, 'Нік'), el('span', { class: 'online' }, ''));
  for (const t of catalog.traits.filter((x) => x.admin)) h.append(el('span', { class: `col-${t.type}` }, t.title));
  h.append(el('span', {}, 'Спецдзеянні і агульныя'));
  return h;
}

// Только строки, которые видно в прокрутке (+ запас).
function draw() {
  const top = scroller.scrollTop;
  const from = Math.max(0, Math.floor(top / ROW) - 5);
  const to = Math.min(shown.length, Math.ceil((top + scroller.clientHeight) / ROW) + 5);
  // Не перерисовывать, пока человек выбирает значение в списке.
  if (rowsBox.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  const frag = document.createDocumentFragment();
  frag.append(header());
  for (let i = from; i < to; i++) frag.append(rowEl(shown[i], i + 1));
  rowsBox.replaceChildren(frag);
}

scroller.addEventListener('scroll', draw);
window.addEventListener('resize', draw);
$('search').addEventListener('input', refilter);

let pendingRefilter = false;
const { request } = adminConnection(
  async (msg) => {
    if (msg.type === 'state') {
      catalog = msg.catalog ?? catalog;
    } else if (msg.type === 'admin-state') {
      specials = msg.specials ?? {};
      common = msg.commonActions ?? [];
      const r = await request('viewers.list');
      if (r.ok) {
        byId.clear();
        for (const row of r.data) byId.set(row.id, row);
        refilter();
      }
    } else if (msg.type === 'viewer') {
      byId.set(msg.row.id, msg.row);
      // Пачка событий (рейд, очередь) — одна перерисовка. Таймер, а не requestAnimationFrame:
      // окно в фоне (или свёрнутая док-панель) иначе не обновилось бы.
      if (!pendingRefilter) {
        pendingRefilter = true;
        setTimeout(() => {
          pendingRefilter = false;
          refilter();
        }, 50);
      }
    }
  },
  (online) => {
    $('conn').textContent = online ? '' : 'няма злучэння з праграмай';
    $('conn').className = online ? '' : 'off';
  },
);
