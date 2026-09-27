// Док-панель /admin: сворачиваемые разделы (открытые запоминаются в браузере), окна «Персанажы» и «Рэдкасць».
import { el, adminConnection, traitInput, openWindow, rememberOpen } from './admin-common.js';

const $ = (id) => document.getElementById(id);
let catalog = { categories: {}, traits: [], actions: [] };
let adm = null; // состояние админки от программы (admin-state)
let settings = {};

// ---------- Налады ----------
// Поле — путь в настройках и подпись. Поле, которого нет в config.json, не показывается.
const FIELDS = [
  ['maxOnScreen', 'Герояў на экране, не больш'],
  ['entrances.edge', "З'яўленне з-за краю — вага"],
  ['entrances.poof', "З'яўленне «пух» — вага"],
  ['entrances.fall', "З'яўленне зверху — вага"],
  ['raid.maxCount', 'Рэйд: парашутыстаў, не больш'],
  ['raid.staySeconds', 'Рэйд: колькі гуляюць, с'],
  ['raid.parachuteWindowSeconds', 'Рэйд: новыя — на парашуце, с'],
  ['bubble.maxChars', 'Воблака: сімвалаў, не больш'],
  ['bubble.maxLines', 'Воблака: радкоў, не больш'],
  ['bubble.maxSeconds', 'Воблака: вісіць не даўжэй, с'],
  ['scenes.maxConcurrent', 'Сцэн адначасова, не больш'],
  ['scenes.leaveWaitSeconds', 'Сыход падчас сцэны — чакаць, с'],
  ['twitch.pollSeconds', 'Twitch: спіс чата — раз у, с'],
  ['twitch.leaveAfterPolls', 'Twitch: сыходзіць пасля апытанняў без яго'],
];

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const patchOf = (path, value) => path.split('.').reduceRight((v, k) => ({ [k]: v }), value);

function renderSettings() {
  const box = $('settings');
  box.replaceChildren();
  for (const [path, title] of FIELDS) {
    const def = get(adm.defaults, path);
    if (typeof def !== 'number') continue;
    const err = el('div', { class: 'error' });
    const input = el('input', { type: 'number', step: 'any', value: get(settings, path) });
    input.onchange = async () => {
      const r = await request('settings.set', { patch: patchOf(path, Number(input.value)) });
      err.textContent = r.ok ? '' : r.error;
      if (!r.ok) input.value = get(settings, path);
    };
    const reset = el('button', {
      class: 'small',
      title: `Па змаўчанні: ${def}`,
      onclick: async () => {
        const r = await request('settings.reset', { path });
        err.textContent = r.ok ? '' : r.error;
      },
    }, '↺');
    box.append(el('div', { class: 'row' }, el('label', {}, title), input, reset), err);
  }
  box.append(el('div', { class: 'muted' }, 'Змены захоўваюцца адразу. Астатнія налады — config.json (гл. README).'));
}

// ---------- Узнагароды ----------
function renderRewards() {
  const box = $('rewards');
  box.replaceChildren();
  const info = adm.rewards ?? {};
  const mode = settings.rewardMode ?? 'auto';
  box.append(
    el('div', { class: 'row' },
      el('span', {}, `Занята ўзнагарод на канале: `, el('b', {}, info.used === undefined ? '—' : `${info.used} з ${info.limit ?? 50}`)),
    ),
  );
  if (info.text) box.append(el('div', { class: info.ok === false ? 'error' : 'muted' }, info.text));
  const modeSel = el('select', {
    onchange: async (e) => {
      const r = await request('settings.set', { patch: { rewardMode: e.target.value } });
      if (!r.ok) alert(r.error);
    },
  });
  modeSel.append(new Option('праграма стварае ўзнагароды сама', 'auto', false, mode === 'auto'));
  modeSel.append(new Option('ручная сувязь: назва → дзеянне', 'manual', false, mode === 'manual'));
  box.append(el('div', { class: 'row' }, el('label', {}, 'Рэжым'), modeSel));

  if (mode === 'auto') {
    const table = el('table', {}, el('tr', {}, el('th', {}, 'Укл.'), el('th', {}, 'Назва (бачаць гледачы)'), el('th', {}, 'Кошт')));
    for (const [id, rw] of Object.entries(settings.rewards ?? {})) {
      const save = async (patch, input) => {
        const r = await request('settings.set', { patch: { rewards: { [id]: patch } } });
        if (!r.ok) {
          alert(r.error);
          renderRewards();
        }
      };
      const on = el('input', { type: 'checkbox', checked: rw.enabled, onchange: (e) => save({ enabled: e.target.checked }) });
      const title = el('input', { value: rw.title, maxlength: 45, onchange: (e) => save({ title: e.target.value.trim() }) });
      const cost = el('input', { type: 'number', min: 1, value: rw.cost, onchange: (e) => save({ cost: Math.max(1, Math.round(Number(e.target.value))) }) });
      table.append(el('tr', { title: `${rw.action}${rw.followersOnly ? ' — толькі фалоўерам' : ''}` }, el('td', {}, on), el('td', {}, title), el('td', {}, cost)));
    }
    box.append(table);
    const err = el('div', { class: 'error' });
    box.append(
      el('div', { class: 'row' },
        el('button', {
          class: 'primary',
          onclick: async () => {
            err.textContent = 'абнаўляю…';
            const r = await request('rewards.sync');
            err.textContent = r.ok ? r.data ?? 'гатова' : r.error;
          },
        }, 'Абнавіць у Twitch'),
      ),
      err,
    );
  } else {
    // Ручная связь: автор сам завёл награды в Twitch; название награды → действие.
    const links = settings.rewardLinks ?? {};
    const table = el('table', {}, el('tr', {}, el('th', {}, 'Назва ўзнагароды ў Twitch'), el('th', {}, 'Дзеянне'), el('th', {})));
    const actionSelect = (value) => {
      const s = el('select');
      for (const a of catalog.actions ?? []) s.append(new Option(a.title, a.id, false, a.id === value));
      return s;
    };
    for (const [title, action] of Object.entries(links)) {
      const sel = actionSelect(action);
      sel.onchange = () => request('settings.set', { patch: { rewardLinks: { [title]: sel.value } } });
      table.append(el('tr', {}, el('td', {}, title), el('td', {}, sel), el('td', {}, el('button', { class: 'small', onclick: () => request('settings.reset', { path: `rewardLinks.${title}` }) }, '✕'))));
    }
    const newTitle = el('input', { placeholder: 'Назва, як у Twitch', maxlength: 45 });
    const newAction = actionSelect();
    table.append(el('tr', {}, el('td', {}, newTitle), el('td', {}, newAction), el('td', {}, el('button', {
      class: 'small',
      onclick: async () => {
        const t = newTitle.value.trim();
        if (!t || t.includes('.')) return alert('Назва не можа быць пустой і з кропкай');
        const r = await request('settings.set', { patch: { rewardLinks: { [t]: newAction.value } } });
        if (!r.ok) alert(r.error);
      },
    }, '+'))));
    box.append(table, el('div', { class: 'muted' }, 'Узнагароды заводзіце ў Twitch самі (панэль аўтара → «Баллы канала»). Праграма толькі выконвае дзеянне; адзначыць выкананай не можа.'));
  }
}

// ---------- Праверка (как тестовая панель) ----------
function renderTest() {
  const box = $('test');
  box.replaceChildren();
  const name = el('input', { placeholder: 'Нік гледача', maxlength: 25 });
  const text = el('input', { placeholder: 'Тэкст паведамлення', maxlength: 500 });
  const t = (action, extra = {}) => {
    if (!name.value.trim()) return name.focus();
    send({ type: 'test', action, name: name.value.trim(), ...extra });
  };
  const act = el('select');
  for (const a of catalog.actions ?? []) act.append(new Option(a.title, a.id));
  const traits = (catalog.traits ?? []).filter((x) => x.admin);
  const traitSel = el('select');
  for (const tr of traits) traitSel.append(new Option(tr.title, tr.id));
  const valueBox = el('span');
  let value = '';
  const renderValue = () => {
    const tr = traits.find((x) => x.id === traitSel.value);
    value = tr?.type === 'bool' ? false : '';
    valueBox.replaceChildren(tr ? traitInput(catalog, tr, null, (v) => (value = v)) : '');
    const first = valueBox.querySelector('select');
    if (first) value = first.value;
  };
  traitSel.onchange = renderValue;
  renderValue();
  const channel = el('input', { placeholder: 'Канал-рэйдэр', maxlength: 25 });
  const count = el('input', { type: 'number', min: 1, value: 5 });
  box.append(
    el('div', { class: 'row' }, name),
    el('div', { class: 'row' },
      el('button', { onclick: () => t('join') }, 'Дадаць'),
      el('button', { onclick: () => t('leave') }, 'Прыбраць'),
      el('button', { onclick: () => t('resetFirstWord'), title: 'Каб праверыць «першае слова» яшчэ раз' }, 'Скінуць «першае слова»'),
    ),
    el('div', { class: 'row' }, text, el('button', { onclick: () => t('message', { text: text.value }) }, 'Паведамленне')),
    el('div', { class: 'row' }, act, el('button', { onclick: () => t('act', { act: act.value }) }, 'Дзеянне')),
    el('div', { class: 'row' }, traitSel, valueBox, el('button', { onclick: () => t('trait', { trait: traitSel.value, value: String(value) }) }, 'Змяніць')),
    el('div', { class: 'row' }, channel, count, el('button', {
      onclick: () => {
        if (!channel.value.trim()) return channel.focus();
        send({ type: 'test', action: 'raid', channel: channel.value.trim(), count: Number(count.value) });
      },
    }, 'Рэйд')),
    el('div', { class: 'muted' }, 'Тэставыя гледачы — з прыстаўкай test: у id; у Twitch іх няма.'),
  );
}

// ---------- Стан ----------
function renderStatus() {
  $('status').replaceChildren(
    ...(adm.status ?? []).map((s) =>
      el('div', { class: 'status-line' }, el('span', { class: `dot ${s.ok === false ? 'bad' : s.ok === 'warn' ? 'warn' : 'ok'}` }), el('span', {}, el('b', {}, s.title), ': ', s.text)),
    ),
  );
}

// ---------- Twitch ----------
function renderTwitch() {
  const box = $('twitch');
  box.replaceChildren();
  const tw = adm.twitch;
  if (!tw) return box.append(el('div', { class: 'muted' }, 'Модуль Twitch не загружаны.'));
  const err = el('div', { class: 'error' });
  const run = async (cmd, args) => {
    err.textContent = '';
    const r = await request(cmd, args);
    if (!r.ok) err.textContent = r.error;
  };
  box.append(el('div', { class: 'status-line' }, el('span', { class: `dot ${tw.connected ? 'ok' : tw.clientId ? 'warn' : 'bad'}` }), el('span', {}, tw.text)));
  const clientId = el('input', { placeholder: tw.clientId ? 'Client ID захаваны — увядзіце новы, каб замяніць' : 'Client ID з dev.twitch.tv/console', autocomplete: 'off' });
  box.append(el('div', { class: 'row' }, clientId, el('button', { onclick: () => run('twitch.setClientId', { clientId: clientId.value.trim() }) }, 'Захаваць')));
  if (tw.device) {
    box.append(
      el('div', { class: 'row' }, 'Адкрыйце ', el('a', { href: tw.device.uri, target: '_blank', style: 'color: var(--accent)' }, tw.device.uri), ' ад акаўнта стрымера і ўвядзіце код:'),
      el('div', { class: 'row' }, el('code', { style: 'font-size: 22px; letter-spacing: 2px' }, tw.device.code)),
      el('div', { class: 'row' }, el('button', { onclick: () => run('twitch.cancel') }, 'Скасаваць')),
    );
  } else if (tw.clientId && !tw.user) {
    box.append(el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => run('twitch.login') }, 'Увайсці ў Twitch')));
  }
  if (tw.user) box.append(el('div', { class: 'row' }, 'Канал: ', el('b', {}, tw.user), el('button', { onclick: () => run('twitch.logout') }, 'Выйсці')));
  if (tw.scopes) box.append(el('div', { class: 'muted' }, `Правы: ${tw.scopes.join(', ')}`));
  for (const w of tw.warnings ?? []) box.append(el('div', { class: 'error' }, w));
  box.append(err);
}

// ---------- Журнал ----------
function logLine(line) {
  const box = $('log');
  const d = new Date(line.time);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.append(el('div', { class: line.level === 'error' ? 'err' : '' }, `${t} ${line.text}`));
  while (box.childElementCount > 300) box.firstChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}

// ---------- подключение ----------
const { request, send } = adminConnection(
  (msg) => {
    if (msg.type === 'state') {
      catalog = msg.catalog ?? catalog;
      if (adm) renderTest();
    } else if (msg.type === 'admin-state') {
      adm = msg;
      settings = msg.settings;
      $('log').replaceChildren();
      (msg.log ?? []).forEach(logLine);
      renderStatus();
      renderTwitch();
      renderSettings();
      renderRewards();
      renderTest();
    } else if (!adm) {
      return;
    } else if (msg.type === 'settings') {
      settings = msg.settings;
      renderSettings();
      renderRewards();
    } else if (msg.type === 'status') {
      adm.status = msg.status;
      renderStatus();
    } else if (msg.type === 'twitch') {
      adm.twitch = msg.twitch;
      renderTwitch();
    } else if (msg.type === 'rewards') {
      adm.rewards = msg.rewards;
      renderRewards();
    } else if (msg.type === 'log') {
      logLine(msg.line);
    }
  },
  (online) => {
    $('conn').textContent = online ? 'падлучана' : 'няма злучэння з праграмай';
    $('conn').className = online ? '' : 'off';
  },
);

rememberOpen(document.querySelectorAll('details'), 'stream-chars-admin-open');
$('open-viewers').onclick = () => openWindow('/admin/viewers', 'sc-viewers', $('window-hint'));
$('open-weights').onclick = () => openWindow('/admin/weights', 'sc-weights', $('window-hint'));
