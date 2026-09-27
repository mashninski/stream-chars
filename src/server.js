// Локальная программа: отдаёт оверлей и тестовую панель, по WebSocket шлёт события.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Viewers } from './viewers.js';
import { Catalog } from './characters.js';
import { ViewerStore } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
const port = config.port;
const catalog = new Catalog(path.join(root, 'characters'));
const store = new ViewerStore(path.join(root, 'data', 'viewers.json'), catalog);

const pages = {
  '/overlay': 'overlay.html',
  '/test': 'test.html',
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

// Лист персонажа: /characters/<імя>/sheet.png. Имя в адресе закодировано (кириллица),
// отдаём только sheet.png персонажей из загруженного каталога — другой путь не собрать.
async function sendSheet(res, encodedName) {
  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    return notFound(res);
  }
  const character = catalog.get(name);
  if (!character) return notFound(res);
  try {
    const body = await fs.readFile(character.sheetFile);
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
    res.writeHead(302, { Location: '/test' });
    return res.end();
  }
  if (pages[url.pathname]) return sendFile(res, pages[url.pathname]);
  if (url.pathname.startsWith('/js/')) return sendFile(res, url.pathname.slice(1));
  const sheet = url.pathname.match(/^\/characters\/([^/]+)\/sheet\.png$/);
  if (sheet) return sendSheet(res, sheet[1]);
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

const viewers = new Viewers(store, {
  maxOnScreen: config.maxOnScreen,
  entrances: config.entrances,
  raid: config.raid,
  characters: () => catalog.names(),
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

viewers.on('join', (viewer, entrance) => {
  // Рейдеров много и с одним ником — в терминал одной строкой на весь рейд (см. 'raid' ниже).
  if (!viewer.raider) console.log(`[join] ${viewer.name} (${viewer.character ?? 'без персанажа'}, з'яўленне: ${entrance})`);
  broadcast({ type: 'join', viewer, entrance });
});
viewers.on('leave', (viewer) => {
  if (!viewer.raider) console.log(`[leave] ${viewer.name}`);
  broadcast({ type: 'leave', id: viewer.id });
});
viewers.on('queue', (queue) => {
  console.log(`[чарга] ${queue.length ? queue.map((v) => v.name).join(', ') : 'пустая'}`);
  broadcast({ type: 'queue', queue });
});
viewers.on('character', (viewer) => {
  console.log(`[перс] ${viewer.name} → ${viewer.character}`);
  broadcast({ type: 'character', id: viewer.id, character: viewer.character });
});
viewers.on('unknownCharacter', (viewer, characterName) => {
  console.log(`[перс] ${viewer.name}: персанажа «${characterName}» няма. Ёсць: ${catalog.names().join(', ')}`);
});
viewers.on('act', (viewer, action, params) => {
  console.log(`[act] ${viewer.name}: ${action}${params.text ? ` «${params.text}»` : ''}`);
  broadcast({ type: 'act', id: viewer.id, action, ...params });
});

// Сообщение в чате (сейчас — из тестовой панели): действие из "triggers.message" + облако с текстом.
function chatMessage(id, text) {
  return viewers.act(id, config.triggers?.message, { text });
}

// Команды тестовой панели. Ник → id в нижнем регистре, как login в Twitch.
function handleTest(msg) {
  if (msg.action === 'raid') {
    const channel = String(msg.channel ?? '').trim().slice(0, 25);
    const n = viewers.raid(channel, Number(msg.count));
    if (n) console.log(`[рэйд] ${channel}: ${msg.count} гледачоў, спускаецца ${n}, сыдуць праз ${viewers.raidStaySeconds} с`);
    else console.log('[рэйд] трэба канал і лік больш за 0');
    return;
  }
  const name = String(msg.name ?? '').trim().slice(0, 25);
  if (!name) return;
  const id = name.toLowerCase();
  if (msg.action === 'join' && !viewers.join({ id, name })) console.log(`[test] ${name} ужо на экране або ў чарзе`);
  if (msg.action === 'leave' && !viewers.leave(id)) console.log(`[test] ${name} няма на экране`);
  if (msg.action === 'message') {
    const text = String(msg.text ?? '').slice(0, 500) || 'тэставае паведамленне';
    if (!chatMessage(id, text)) console.log(`[test] ${name} няма на экране`);
  }
  if (msg.action === 'character') viewers.choose({ id, name }, String(msg.character ?? ''));
}

wss.on('connection', (ws) => {
  console.log(`[ws] падлучыўся кліент, усяго ${wss.clients.size}`);
  // Новому клиенту (или перезагруженному оверлею) — настройки, каталог персонажей и текущий список.
  ws.send(JSON.stringify({ type: 'state', config: { ...config.overlay, bubble: config.bubble }, characters: catalog.toClient(), viewers: viewers.list(), queue: viewers.queue() }));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'test') handleTest(msg);
  });
  ws.on('close', () => console.log(`[ws] кліент адлучыўся, засталося ${wss.clients.size}`));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port} заняты. Магчыма, праграма ўжо запушчана ў іншым акне — зачыніце яго або змяніце "port" у config.json.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

// Только localhost: оверлей нужен OBS на этом же компьютере, в сеть программа не смотрит.
server.listen(port, '127.0.0.1', () => {
  console.log('Праграма запушчана.');
  console.log(`  Аверлэй для OBS:  http://localhost:${port}/overlay`);
  console.log(`  Тэставая панэль:  http://localhost:${port}/test`);
  console.log('Спыніць: Ctrl+C у гэтым акне.');
});
