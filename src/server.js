// Локальная программа: отдаёт оверлей и тестовую панель, по WebSocket шлёт события.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Viewers } from './viewers.js';
import { Catalog } from './catalog.js';
import { Heroes, loadTraits } from './heroes.js';
import { ViewerStore } from './store.js';
import { root, readEnv } from './env.js';
import { log } from './log.js';
import { readJson } from './files.js';
import { Settings } from './settings.js';
import { watchStop, clearStopFile } from './lifecycle.js';
import { Scenes } from './scenes.js';
import { Actions } from './actions.js';
import { Admin } from './admin.js';

const env = readEnv();
if (env.portGiven && !env.port) {
  log.error('Порт — цэлы лік больш за 0.');
  process.exit(1);
}
log.init({ dir: path.join(env.dataDir, 'logs') });
const publicDir = path.join(root, 'public');
const settings = new Settings(readJson(path.join(root, 'config.json')), path.join(env.dataDir, 'settings.json'), log);
// Порт — единственная настройка, которая требует перезапуска.
const port = env.port ?? settings.get().port;
const heroesDir = path.join(root, 'heroes');
const catalog = new Catalog(heroesDir);
const heroes = new Heroes({ traits: loadTraits(path.join(heroesDir, 'traits.json'), log), catalog, settings });
const store = new ViewerStore(path.join(env.dataDir, 'viewers.json'), heroes);
const scenes = await new Scenes(catalog, heroes).load(path.join(root, 'public', 'js', 'scenes'));

const pages = {
  '/overlay': 'overlay.html',
  '/test': 'test.html',
  '/admin': 'admin.html',
  '/admin/viewers': 'viewers.html',
  '/admin/weights': 'weights.html',
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Отдаём только файлы из public/: путь вне папки — 404.
async function sendFile(res, file) {
  const full = path.resolve(publicDir, file);
  if (!full.startsWith(publicDir + path.sep)) return notFound(res);
  try {
    const body = await fs.readFile(full);
    res.writeHead(200, {
      'Content-Type': types[path.extname(full)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    notFound(res);
  }
}

// Картинки каталога героев: /heroes/<категория>/<id>/<файл>.png. Отдаём только файлы из загруженного
// каталога (catalog.file) — другой путь не собрать.
async function sendCatalogFile(res, url) {
  const file = catalog.file(url);
  if (!file) return notFound(res);
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Не знойдзена');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/admin' });
    return res.end();
  }
  if (pages[url.pathname]) return sendFile(res, pages[url.pathname]);
  if (url.pathname.startsWith('/js/')) return sendFile(res, url.pathname.slice(1));
  if (url.pathname === '/admin.css') return sendFile(res, 'admin.css');
  if (url.pathname.startsWith('/heroes/')) return sendCatalogFile(res, url.pathname);
  notFound(res);
});

// Подключаться может только страница с этого же компьютера и порта:
// чужой сайт в браузере не сможет слать команды тестовой панели.
const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin }) => !origin || allowedOrigins.has(origin),
});

const viewers = new Viewers(store, heroes, {
  config: () => settings.get(),
});
const actions = new Actions({ viewers, store, heroes, scenes, settings });
const startedAt = Date.now();
const admin = new Admin({ settings, store, viewers, heroes, scenes, actions, log });
const clientsOf = (role) => [...wss.clients].filter((c) => c.role === role && c.readyState === c.OPEN);
admin.status('program', () => {
  const min = Math.floor((Date.now() - startedAt) / 60000);
  return { title: 'Праграма', text: `працуе ${min < 60 ? `${min} хв` : `${Math.floor(min / 60)} г ${min % 60} хв`}, порт ${port}`, ok: true };
});
admin.status('overlay', () => {
  const n = clientsOf('overlay').length;
  return { title: 'Аверлэй (OBS)', text: n ? `падлучаных: ${n}` : 'не падлучаны — дадайце аверлэй у сцэну', ok: n > 0 };
});
admin.status('viewers', () => ({ title: 'Гледачы', text: `на экране ${viewers.list().filter((v) => !v.raider).length}, у чарзе ${viewers.queue().length}, усяго герояў ${store.all().length}`, ok: true }));

function sendTo(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcastAdmin(msg) {
  const data = JSON.stringify(msg);
  for (const c of clientsOf('admin')) c.send(data);
}
// Строка окна «Персанажы» поменялась.
function adminViewer(id) {
  const row = admin.row(id);
  if (row) broadcastAdmin({ type: 'viewer', row });
}
log.on('line', (line) => broadcastAdmin({ type: 'log', line }));

// Что нужно оверлею из настроек: полоса, облако, реакции, правила сцен и список сцен с весами случаев.
function overlayConfig() {
  const c = settings.get();
  return { ...c.overlay, bubble: c.bubble, reactions: c.reactions, scenes: c.scenes, sceneList: scenes.toClient() };
}

// Настройки поменялись (админка) — оверлеям новые значения, очередь — по новому лимиту.
settings.on('change', () => {
  broadcast({ type: 'config', config: overlayConfig() });
  broadcastAdmin({ type: 'settings', settings: settings.get() });
  viewers.refresh();
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

viewers.on('join', (viewer, entrance) => {
  // Рейдеров много и с одним ником — в журнал одной строкой на весь рейд (см. handleTest).
  if (!viewer.raider) log.info(`[join] ${viewer.name} (${viewer.traits.class ?? 'без класа'}, з'яўленне: ${entrance})`);
  broadcast({ type: 'join', viewer, entrance });
  if (!viewer.raider) adminViewer(viewer.id);
});
viewers.on('leave', (viewer) => {
  if (!viewer.raider) log.info(`[leave] ${viewer.name}`);
  broadcast({ type: 'leave', id: viewer.id });
  if (!viewer.raider) adminViewer(viewer.id);
});
viewers.on('queue', (queue) => {
  log.info(`[чарга] ${queue.length ? queue.map((v) => v.name).join(', ') : 'пустая'}`);
  broadcast({ type: 'queue', queue });
  for (const v of queue) adminViewer(v.id);
});
viewers.on('traits', (viewer) => {
  broadcast({ type: 'traits', id: viewer.id, traits: viewer.traits });
  adminViewer(viewer.id);
});
viewers.on('act', (viewer, action, params) => {
  log.info(`[act] ${viewer.name}: ${action}${params.text ? ` «${params.text}»` : ''}`);
  broadcast({ type: 'act', id: viewer.id, action, ...params });
});

// Команды тестовой панели. Тестовый зритель: id «test:<нік у ніжнім рэгістры>».
function handleTest(msg) {
  if (msg.action === 'raid') {
    const channel = String(msg.channel ?? '').trim().slice(0, 25);
    const n = viewers.raid(channel, Number(msg.count));
    if (n) log.info(`[рэйд] ${channel}: ${msg.count} гледачоў, спускаецца ${n}, сыдуць праз ${viewers.raidStaySeconds} с`);
    else log.info('[рэйд] трэба канал і лік больш за 0');
    return;
  }
  const name = String(msg.name ?? '').trim().slice(0, 25);
  if (!name) return;
  const id = `test:${name.toLowerCase()}`;
  if (msg.action === 'join' && !viewers.join({ id, name })) log.info(`[test] ${name} ужо на экране або ў чарзе`);
  if (msg.action === 'leave' && !viewers.leave(id)) log.info(`[test] ${name} няма на экране`);
  if (msg.action === 'message') {
    const text = String(msg.text ?? '').slice(0, 500) || 'тэставае паведамленне';
    if (!actions.message(id, text)) log.info(`[test] ${name} няма на экране`);
  }
  // Любое действие: сцена, спецдействие по весам, смена признака за «баллы», реакция.
  if (msg.action === 'act') {
    const res = actions.perform(id, String(msg.act ?? ''), {}, { wait: true });
    log.info(`[test] ${name}: ${res.text}`);
  }
  // Сбросить «первое слово» — чтобы проверить сцену ещё раз.
  if (msg.action === 'resetFirstWord' && store.get(id)) {
    store.setFlags(id, { firstWord: false });
    viewers.setTrait(id, 'nameShown', false);
    log.info(`[test] ${name}: «першае слова» скінута`);
  }
  if (msg.action === 'trait') {
    const trait = heroes.trait(String(msg.trait ?? ''));
    let value = msg.value === '' ? null : msg.value;
    if (trait?.type === 'bool') value = value === true || value === 'true';
    if (!store.get(id)) log.info(`[test] ${name} яшчэ не з'яўляўся — героя няма`);
    else if (!actions.setTrait(id, trait?.id, value)) log.info(`[test] ${name}: «${msg.trait}» = «${msg.value}» — няма такога значэння`);
    else log.info(`[прыкмета] ${name}: ${trait.title.toLowerCase()} → ${value}`);
  }
}

// Что нужно клиентам о каталоге: сетка тела, предметы, реестр признаков, действия.
function catalogForClient() {
  return { ...catalog.toClient(), traits: heroes.toClient(), actions: actions.list() };
}

// Роль клиента — из адреса: /ws?role=overlay|test|admin. Админке — ещё состояние и живой журнал.
const ROLES = new Set(['overlay', 'test', 'admin']);
wss.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://localhost').searchParams.get('role');
  ws.role = ROLES.has(role) ? role : 'overlay';
  log.info(`[ws] падлучыўся кліент (${ws.role}), усяго ${wss.clients.size}`);
  // Новому клиенту (или перезагруженному оверлею) — настройки, каталог героев и текущий список.
  sendTo(ws, { type: 'state', config: overlayConfig(), catalog: catalogForClient(), viewers: viewers.list(), queue: viewers.queue() });
  if (ws.role === 'admin') sendTo(ws, { type: 'admin-state', ...admin.state() });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    // Команды меняют данные — только от тестовой панели и админки, не от оверлея.
    if (msg.type === 'test' && ws.role !== 'overlay') handleTest(msg);
    if (msg.type === 'admin' && ws.role === 'admin') {
      const reply = await admin.handle(msg);
      sendTo(ws, { type: 'admin-reply', id: msg.id, ...reply });
      if (reply.ok) broadcastAdmin({ type: 'status', status: admin.statusLines() });
    }
  });
  ws.on('close', () => log.info(`[ws] кліент адлучыўся, засталося ${wss.clients.size}`));
});

// Состояние в админке — раз в 10 с (время работы, подключения).
setInterval(() => broadcastAdmin({ type: 'status', status: admin.statusLines() }), 10000).unref();

// WebSocketServer повторяет ошибки HTTP-сервера; разбираем их один раз — ниже, у server.
wss.on('error', () => {});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Второй экземпляр (скрипт OBS запустил, а программа уже работает) — тихо выходим.
    log.info(`Порт ${port} заняты — праграма ўжо працуе (або порт заняты іншай праграмай). Гэты запуск спыняецца.`);
    process.exit(0);
  }
  log.error(err);
  process.exit(1);
});

// Остановка: Ctrl+C, закрылся OBS (--parent-pid), файл-сигнал stop.
function shutdown(reason) {
  log.info(`Праграма спыняецца: ${reason}.`);
  for (const client of wss.clients) client.terminate();
  server.close();
  // Не ждём долгих соединений: всё важное уже записано на диск.
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Только localhost: оверлей нужен OBS на этом же компьютере, в сеть программа не смотрит.
server.listen(port, '127.0.0.1', () => {
  // Порт наш — прошлая программа уже вышла; её файл-сигнал stop ничей.
  clearStopFile(env.dataDir);
  watchStop({ dataDir: env.dataDir, parentPid: env.parentPid, onStop: shutdown });
  log.info('Праграма запушчана.');
  log.info(`  Аверлэй для OBS:  http://localhost:${port}/overlay`);
  log.info(`  Адмін-панэль:     http://localhost:${port}/admin`);
  log.info(`  Тэставая панэль:  http://localhost:${port}/test`);
  log.info(`  Папка даных:      ${env.dataDir}`);
  if (env.parentPid) log.info(`  Спыніцца разам з працэсам ${env.parentPid}.`);
  else log.info('Спыніць: Ctrl+C у гэтым акне.');
});
