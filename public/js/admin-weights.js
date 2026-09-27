// Окно «Рэдкасць» (/admin/weights): веса по категориям (классы, уборы, пол, спецдействия классов,
// случаи внутри сцен), процент у каждого значения, «Захаваць». Категории приходят от программы —
// новый предмет или сцена появятся сами.
import { el, adminConnection, rememberOpen } from './admin-common.js';

const $ = (id) => document.getElementById(id);
let cats = [];
// Что поменяно, но не сохранено: ключ категории → { значение: вес }.
const edits = new Map();

function percent(values) {
  const total = values.reduce((s, v) => s + (v.w > 0 ? v.w : 0), 0);
  return (w) => (total && w > 0 ? ((w / total) * 100).toFixed(1).replace(/\.0$/, '') : '0');
}

function render() {
  const box = $('cats');
  box.replaceChildren();
  for (const c of cats) {
    const vals = c.values.map((v) => ({ ...v, w: edits.get(c.key)?.[v.id] ?? v.weight }));
    const pct = percent(vals);
    const table = el('table', {}, el('tr', {}, el('th', {}, 'Значэнне'), el('th', {}, 'Вага'), el('th', {}, '%'), el('th', {}, 'Па змаўчанні')));
    const cells = [];
    for (const v of vals) {
      const p = el('td', {}, `${pct(v.w)}%`);
      cells.push([v, p]);
      const input = el('input', {
        type: 'number', min: 0, step: 'any', value: v.w,
        oninput: (e) => {
          const w = Math.max(0, Number(e.target.value) || 0);
          v.w = w;
          edits.set(c.key, { ...edits.get(c.key), [v.id]: w });
          const f = percent(vals);
          for (const [vv, cell] of cells) cell.textContent = `${f(vv.w)}%`;
          $('msg').textContent = 'ёсць незахаваныя змены';
        },
      });
      table.append(el('tr', {}, el('td', { title: v.id }, v.title), el('td', {}, input), p, el('td', { class: 'muted' }, String(v.default))));
    }
    const d = el('details', { id: `w-${c.key}` },
      el('summary', {}, c.title),
      el('div', { class: 'body' }, table,
        el('div', { class: 'row' }, el('button', {
          class: 'small',
          onclick: async () => {
            const r = await request('weights.reset', { key: c.key });
            edits.delete(c.key);
            $('msg').textContent = r.ok ? 'вернута па змаўчанні' : r.error;
            load();
          },
        }, 'Вярнуць па змаўчанні'))),
    );
    box.append(d);
  }
  rememberOpen(box.querySelectorAll('details'), 'stream-chars-weights-open');
}

async function load() {
  const r = await request('weights.get');
  if (!r.ok) return ($('msg').textContent = r.error);
  cats = r.data;
  render();
}

$('save').onclick = async () => {
  if (!edits.size) return ($('msg').textContent = 'няма змен');
  const r = await request('weights.set', { weights: Object.fromEntries(edits) });
  if (r.ok) {
    edits.clear();
    $('msg').textContent = 'захавана';
    load();
  } else {
    $('msg').textContent = r.error;
  }
};

const { request } = adminConnection(
  (msg) => {
    if (msg.type === 'admin-state' && !edits.size) load();
  },
  (online) => {
    $('conn').textContent = online ? '' : 'няма злучэння з праграмай';
    $('conn').className = online ? '' : 'off';
  },
);
