// Twitch: вход (Device Code Flow), токены, запросы Helix, список чата, цвет ника, фолловеры.
// Про героев не знает: сообщает события, программа (server.js, actions.js) решает, что с ними делать.
//   'join' { id, login, name }   — зритель появился в списке чата
//   'leave' { id, login, name }  — его нет N опросов подряд
//   'color' { id, color }        — цвет ника (выбранный в чате или из стандартной палитры по нику)
//   'connected' (user), 'status' — для админки
// Без Client ID (или без входа) ничего не делает — программа работает без Twitch.
// Секреты (токены, код устройства) в журнал не попадают (log.secret).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { readEnvFile, setEnvValue } from './envfile.js';
import { writeJsonAtomic, readJson } from './files.js';
import { defaultNameColor } from '../public/js/color.js';

export const SCOPES = [
  'moderator:read:chatters',
  'user:read:chat',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'moderator:read:followers',
  'channel:read:subscriptions',
];
const ID_URL = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const ENV_KEY = 'TWITCH_CLIENT_ID';

// Ошибка запроса. kind: network (нет сети), server (5xx), rate (429), auth (401 после обновления), http (прочее).
export class TwitchError extends Error {
  constructor(message, { status = 0, kind = 'http', body } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
  // Сбой, из-за которого опрос пропускается и в уходы не считается.
  get temporary() {
    return this.kind === 'network' || this.kind === 'server' || this.kind === 'rate';
  }
}

export class Twitch extends EventEmitter {
  #o;
  #tokens = null;
  #user = null;
  #device = null;
  #loginRun = 0;
  #refreshing = null;
  #present = new Map(); // user_id → { id, login, name, missing }
  #followChecked = new Set();
  #pollTimer = null;
  #validateTimer = null;
  #pausedUntil = 0;
  #text = '';
  #warnings = [];
  #lastPoll = null;

  // envFile — .env.local; tokensFile — data/twitch-tokens.json; settings — src/settings.js;
  // fetch, now, setTimeout, clearTimeout, sleep — подменяются в проверке.
  constructor(opts) {
    super();
    this.#o = {
      fetch: globalThis.fetch,
      now: Date.now,
      setTimeout,
      clearTimeout,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...opts,
    };
    this.#text = this.clientId ? 'не ўвайшлі' : 'Client ID не ўведзены';
  }

  get #cfg() {
    return { pollSeconds: 60, leaveAfterPolls: 3, ignore: [], ...this.#o.settings.get().twitch };
  }

  get clientId() {
    return readEnvFile(this.#o.envFile)[ENV_KEY] || '';
  }

  get user() {
    return this.#user;
  }

  get connected() {
    return !!this.#user;
  }

  // Для админки. Секретов здесь нет.
  status() {
    return {
      clientId: !!this.clientId,
      connected: this.connected,
      user: this.#user?.login ?? null,
      device: this.#device ? { code: this.#device.code, uri: this.#device.uri } : null,
      scopes: this.#tokens?.scope ?? null,
      text: this.#text,
      warnings: [...this.#warnings],
      present: this.#present.size,
      lastPoll: this.#lastPoll,
    };
  }

  #setText(text, warnings) {
    this.#text = text;
    if (warnings) this.#warnings = warnings;
    this.emit('status', this.status());
  }

  // ---------- Client ID и токены ----------

  setClientId(id) {
    const clean = String(id ?? '').trim();
    if (!/^[a-z0-9]{20,40}$/i.test(clean)) return { ok: false, error: 'Client ID — 20–40 лацінскіх літар і лічбаў (dev.twitch.tv/console → ваша праграма)' };
    const changed = clean !== this.clientId;
    setEnvValue(this.#o.envFile, ENV_KEY, clean);
    this.#o.log.info('[twitch] Client ID захаваны ў .env.local');
    // Токены выданы другому приложению — входить заново.
    if (changed && this.#tokens) this.logout('Client ID зменены — трэба ўвайсці зноў');
    else this.#setText(this.#user ? this.#text : 'не ўвайшлі');
    return { ok: true };
  }

  #saveTokens(t) {
    this.#tokens = { access_token: t.access_token, refresh_token: t.refresh_token, scope: t.scope ?? this.#tokens?.scope ?? [], obtainedAt: this.#o.now() };
    this.#o.log.secret(t.access_token);
    this.#o.log.secret(t.refresh_token);
    writeJsonAtomic(this.#o.tokensFile, this.#tokens);
  }

  #loadTokens() {
    try {
      const t = readJson(this.#o.tokensFile);
      if (t?.access_token && t?.refresh_token) {
        this.#tokens = t;
        this.#o.log.secret(t.access_token);
        this.#o.log.secret(t.refresh_token);
        return true;
      }
    } catch (err) {
      this.#o.log.error(`[twitch] twitch-tokens.json не чытаецца: ${err.message}`);
    }
    return false;
  }

  // ---------- запросы ----------

  async #fetch(url, init) {
    let res;
    try {
      res = await this.#o.fetch(url, init);
    } catch (err) {
      throw new TwitchError(`няма сувязі з Twitch (${err.message})`, { kind: 'network' });
    }
    let body = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {}
    return { res, body };
  }

  async #idPost(path, params) {
    const { res, body } = await this.#fetch(`${ID_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    return { status: res.status, body };
  }

  // Обновить токен. Refresh token одноразовый — новый сохраняется сразу. Один запрос на всех.
  async #refresh() {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = (async () => {
      const { status, body } = await this.#idPost('token', {
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.#tokens?.refresh_token ?? '',
      });
      if (status === 200 && body?.access_token) {
        this.#saveTokens(body);
        this.#o.log.info('[twitch] токен абноўлены');
        return true;
      }
      if (status >= 500) throw new TwitchError('Twitch не адказаў на абнаўленне токена', { status, kind: 'server' });
      // Refresh не принят (истёк 30 дней, отозван) — входить заново.
      this.logout('уваход састарэў — увайдзіце зноў');
      throw new TwitchError('трэба ўвайсці ў Twitch зноў', { status, kind: 'auth' });
    })();
    try {
      return await this.#refreshing;
    } finally {
      this.#refreshing = null;
    }
  }

  // Запрос Helix. 401 — обновить токен и повторить один раз. 429 — пауза до сброса лимита.
  async helix(method, path, { query, body } = {}, retry = true) {
    if (!this.#tokens) throw new TwitchError('не ўвайшлі ў Twitch', { kind: 'auth' });
    const now = this.#o.now();
    if (now < this.#pausedUntil) throw new TwitchError('ліміт запытаў Twitch — чакаю', { status: 429, kind: 'rate' });
    const qs = query ? `?${query instanceof URLSearchParams ? query : new URLSearchParams(query)}` : '';
    const { res, body: data } = await this.#fetch(`${HELIX}${path}${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#tokens.access_token}`,
        'Client-Id': this.clientId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry) {
      await this.#refresh();
      return this.helix(method, path, { query, body }, false);
    }
    if (res.status === 429) {
      const reset = Number(res.headers.get?.('ratelimit-reset'));
      this.#pausedUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : now + 60000;
      throw new TwitchError('ліміт запытаў Twitch', { status: 429, kind: 'rate' });
    }
    if (res.status >= 500) throw new TwitchError(`Twitch: памылка сервера ${res.status}`, { status: res.status, kind: 'server' });
    if (res.status === 401) throw new TwitchError('Twitch не прымае токен', { status: 401, kind: 'auth' });
    if (res.status >= 400) throw new TwitchError(`Twitch ${res.status}: ${data?.message ?? ''}`, { status: res.status, kind: 'http', body: data });
    return { status: res.status, data, headers: res.headers };
  }

  // ---------- вход ----------

  // Device Code Flow: код и адрес — в админке и журнале; автор вводит код на twitch.tv/activate.
  async login() {
    if (!this.clientId) return { ok: false, error: 'спачатку ўвядзіце Client ID' };
    const run = ++this.#loginRun;
    const { status, body } = await this.#idPost('device', { client_id: this.clientId, scopes: SCOPES.join(' ') }).catch((err) => ({ status: 0, body: { message: err.message } }));
    if (status !== 200 || !body?.device_code) {
      const text = `не атрымалася пачаць уваход: ${body?.message ?? status}`;
      this.#setText(text);
      return { ok: false, error: text };
    }
    this.#o.log.secret(body.device_code);
    this.#device = { code: body.user_code, uri: body.verification_uri, expiresAt: this.#o.now() + body.expires_in * 1000, interval: body.interval ?? 5 };
    this.#o.log.info(`[twitch] уваход: адкрыйце ${body.verification_uri} і ўвядзіце код ${body.user_code}`);
    this.#setText(`чакаю код на ${body.verification_uri}`);
    this.#pollDevice(run, body.device_code);
    return { ok: true };
  }

  async #pollDevice(run, deviceCode) {
    while (run === this.#loginRun && this.#device) {
      await this.#o.sleep(this.#device.interval * 1000);
      if (run !== this.#loginRun || !this.#device) return;
      if (this.#o.now() > this.#device.expiresAt) {
        this.#device = null;
        this.#o.log.info('[twitch] код уваходу састарэў');
        this.#setText('код састарэў — націсніце «Увайсці» яшчэ раз');
        return;
      }
      let r;
      try {
        r = await this.#idPost('token', {
          client_id: this.clientId,
          scopes: SCOPES.join(' '),
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
      } catch {
        continue; // сеть моргнула — пробуем в следующий раз
      }
      if (r.status === 200 && r.body?.access_token) {
        this.#device = null;
        this.#saveTokens(r.body);
        this.#o.log.info('[twitch] уваход удалы');
        await this.#connect();
        return;
      }
      const msg = String(r.body?.message ?? '');
      if (msg === 'authorization_pending') continue;
      if (msg === 'slow_down') {
        this.#device.interval += 5;
        continue;
      }
      // Истёк, отклонён, неверный код.
      this.#device = null;
      this.#o.log.info(`[twitch] уваход не ўдаўся: ${msg || r.status}`);
      this.#setText(`уваход не ўдаўся (${msg || r.status}) — націсніце «Увайсці» яшчэ раз`);
      return;
    }
  }

  cancel() {
    this.#loginRun++;
    this.#device = null;
    this.#setText(this.#user ? this.#text : 'не ўвайшлі');
    return { ok: true };
  }

  // Выйти: удалить свой файл токенов, остановить опросы; зрители из чата уходят.
  logout(reason = 'выйшлі') {
    this.#loginRun++;
    this.#device = null;
    this.#stopTimers();
    this.#tokens = null;
    this.#user = null;
    try {
      fs.rmSync(this.#o.tokensFile, { force: true });
    } catch {}
    for (const u of this.#present.values()) this.emit('leave', u);
    this.#present.clear();
    this.#followChecked.clear();
    this.#o.log.info(`[twitch] ${reason}`);
    this.#setText(reason, []);
    this.emit('disconnected');
    return { ok: true };
  }

  // При запуске программы: есть токены — подключиться.
  async start() {
    if (!this.clientId) {
      this.#setText('Client ID не ўведзены');
      return;
    }
    if (!this.#loadTokens()) {
      this.#setText('не ўвайшлі');
      return;
    }
    await this.#connect().catch((err) => this.#setText(`не падлучана: ${err.message}`));
  }

  // Проверка токена (Twitch требует раз в час), стример, опрос чата.
  async #connect() {
    const ok = await this.validate();
    if (!ok) return;
    const { data } = await this.helix('GET', '/users');
    const u = data?.data?.[0];
    if (!u) throw new TwitchError('Twitch не аддаў звесткі пра канал');
    this.#user = { id: u.id, login: u.login, name: u.display_name };
    this.#o.log.info(`[twitch] падлучана: канал ${u.display_name}`);
    this.#setText(`падлучана: ${u.display_name}`);
    this.emit('connected', this.#user);
    this.#stopTimers();
    this.#validateTimer = this.#o.setTimeout(() => this.#hourly(), 3600 * 1000);
    await this.pollChatters();
  }

  async #hourly() {
    await this.validate().catch(() => {});
    if (this.#tokens) this.#validateTimer = this.#o.setTimeout(() => this.#hourly(), 3600 * 1000);
  }

  // GET /oauth2/validate: токен жив? Каких прав не хватает? true — можно работать.
  async validate() {
    if (!this.#tokens) return false;
    const call = () => this.#fetch(`${ID_URL}/validate`, { headers: { Authorization: `OAuth ${this.#tokens.access_token}` } });
    let { res, body } = await call();
    if (res.status === 401) {
      await this.#refresh();
      ({ res, body } = await call());
    }
    if (res.status !== 200) {
      if (res.status >= 500) return true; // Twitch болеет — не выгоняем
      this.logout('токен не прыняты — увайдзіце зноў');
      return false;
    }
    const scopes = body?.scopes ?? [];
    this.#tokens.scope = scopes;
    const missing = SCOPES.filter((s) => !scopes.includes(s));
    this.#warnings = missing.length ? [`не хапае правоў: ${missing.join(', ')} — выйдзіце і ўвайдзіце зноў`] : [];
    return true;
  }

  #stopTimers() {
    if (this.#pollTimer) this.#o.clearTimeout(this.#pollTimer);
    if (this.#validateTimer) this.#o.clearTimeout(this.#validateTimer);
    this.#pollTimer = this.#validateTimer = null;
  }

  // ---------- список чата ----------

  // Все страницы Get Chatters. Стример и боты из twitch.ignore — не зрители.
  async #chatters() {
    const out = [];
    let after = '';
    for (let page = 0; page < 100; page++) {
      const q = new URLSearchParams({ broadcaster_id: this.#user.id, moderator_id: this.#user.id, first: '1000' });
      if (after) q.set('after', after);
      const { data } = await this.helix('GET', '/chat/chatters', { query: q });
      out.push(...(data?.data ?? []));
      after = data?.pagination?.cursor ?? '';
      if (!after) break;
    }
    const ignore = new Set(this.#cfg.ignore.map((s) => s.toLowerCase()));
    return out.filter((c) => c.user_id !== this.#user.id && !ignore.has(String(c.user_login).toLowerCase()));
  }

  // Один опрос: появившиеся — 'join', пропавшие на leaveAfterPolls опросов подряд — 'leave'.
  // Сбой сети, 5xx, 429 — опрос пропущен и в уходы не считается. Следующий — через pollSeconds.
  async pollChatters() {
    if (!this.#user) return null;
    let list;
    try {
      list = await this.#chatters();
    } catch (err) {
      if (err.temporary) this.#o.log.info(`[twitch] апытанне чата прапушчана: ${err.message}`);
      else {
        this.#o.log.error(`[twitch] спіс чата: ${err.message}`);
        if (err.status === 403) this.#warnings = ['няма права чытаць спіс чата (moderator:read:chatters) — выйдзіце і ўвайдзіце зноў'];
      }
      this.#schedulePoll();
      this.emit('status', this.status());
      return null;
    }
    const seen = new Set();
    const joined = [];
    const left = [];
    for (const c of list) {
      seen.add(c.user_id);
      const known = this.#present.get(c.user_id);
      if (known) {
        known.missing = 0;
        known.name = c.user_name;
        continue;
      }
      const u = { id: c.user_id, login: c.user_login, name: c.user_name, missing: 0 };
      this.#present.set(u.id, u);
      joined.push(u);
    }
    for (const u of [...this.#present.values()]) {
      if (seen.has(u.id)) continue;
      if (++u.missing >= this.#cfg.leaveAfterPolls) {
        this.#present.delete(u.id);
        left.push(u);
      }
    }
    for (const u of joined) this.emit('join', { id: u.id, login: u.login, name: u.name });
    for (const u of left) this.emit('leave', { id: u.id, login: u.login, name: u.name });
    this.#lastPoll = { time: this.#o.now(), total: list.length };
    if (this.#user) this.#setText(`падлучана: ${this.#user.name}, у чаце ${this.#present.size}`);
    if (joined.length) await this.fetchColors(joined).catch((err) => this.#o.log.info(`[twitch] колеры нікаў: ${err.message}`));
    this.#schedulePoll();
    return { joined, left };
  }

  #schedulePoll() {
    if (this.#pollTimer) this.#o.clearTimeout(this.#pollTimer);
    if (!this.#user) return;
    this.#pollTimer = this.#o.setTimeout(() => this.pollChatters(), this.#cfg.pollSeconds * 1000);
  }

  // Цвет ника пачками до 100. Не выбирал — цвет из стандартной палитры по нику.
  async fetchColors(users) {
    for (let i = 0; i < users.length; i += 100) {
      const batch = users.slice(i, i + 100);
      const q = new URLSearchParams();
      for (const u of batch) q.append('user_id', u.id);
      const { data } = await this.helix('GET', '/chat/color', { query: q });
      const byId = new Map((data?.data ?? []).map((c) => [c.user_id, c.color]));
      for (const u of batch) this.emit('color', { id: u.id, color: byId.get(u.id) || defaultNameColor(u.login) });
    }
  }

  // Фолловер ли зритель — один раз за запуск программы. null — не удалось спросить.
  async isFollower(userId) {
    if (!this.#user || this.#followChecked.has(userId)) return null;
    this.#followChecked.add(userId);
    try {
      const { data } = await this.helix('GET', '/channels/followers', { query: { broadcaster_id: this.#user.id, user_id: userId } });
      return (data?.data ?? []).some((f) => f.user_id === userId);
    } catch (err) {
      this.#followChecked.delete(userId);
      this.#o.log.info(`[twitch] ці фалоўер ${userId}: ${err.message}`);
      return null;
    }
  }

  // Кто сейчас в чате (для EventSub и админки).
  present(id) {
    return this.#present.has(id);
  }
}
