// EventSub через WebSocket (wss://eventsub.wss.twitch.tv/ws): события чата, рейда, фолловеров, подписок
// и наград за баллы. Про героев не знает — отдаёт события: emit(<тип подписки>, event).
// - welcome → подписки (Twitch даёт на это 10 с);
// - тишина дольше keepalive_timeout_seconds (+ запас) — соединение считается потерянным:
//   новое соединение и новые подписки;
// - session_reconnect — новое соединение по reconnect_url, подписки переезжают сами; старое
//   закрывается после welcome на новом;
// - revocation — строка в журнал и в админку;
// - одно и то же сообщение дважды (message_id) — второе пропускается.
import { EventEmitter } from 'node:events';
import WebSocketImpl from 'ws';

export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

// Что слушаем. condition(uid) — условие подписки для канала стримера.
export const SUBSCRIPTIONS = [
  { type: 'channel.chat.message', version: '1', condition: (uid) => ({ broadcaster_user_id: uid, user_id: uid }) },
  { type: 'channel.raid', version: '1', condition: (uid) => ({ to_broadcaster_user_id: uid }) },
  { type: 'channel.follow', version: '2', condition: (uid) => ({ broadcaster_user_id: uid, moderator_user_id: uid }) },
  { type: 'channel.subscribe', version: '1', condition: (uid) => ({ broadcaster_user_id: uid }) },
  { type: 'channel.subscription.message', version: '1', condition: (uid) => ({ broadcaster_user_id: uid }) },
  { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: (uid) => ({ broadcaster_user_id: uid }) },
];

export class EventSub extends EventEmitter {
  #o;
  #ws = null;
  #session = null;
  #watchdog = null;
  #keepaliveMs = 10000;
  #seen = new Set();
  #seenOrder = [];
  #stopped = true;
  #retry = 0;
  #retryTimer = null;
  #subscribed = [];
  #failed = [];
  #revoked = [];
  #generation = 0;

  // twitch — src/twitch.js (helix, user); WebSocket, url, setTimeout, clearTimeout — подменяются в проверке.
  constructor(opts) {
    super();
    this.#o = { WebSocket: WebSocketImpl, url: EVENTSUB_URL, setTimeout, clearTimeout, graceMs: 5000, ...opts };
  }

  status() {
    return {
      connected: !!this.#session,
      subscribed: [...this.#subscribed],
      failed: [...this.#failed],
      revoked: [...this.#revoked],
    };
  }

  start() {
    this.#stopped = false;
    this.#retry = 0;
    this.#open(this.#o.url, false);
  }

  stop() {
    this.#stopped = true;
    this.#generation++;
    this.#clearWatchdog();
    if (this.#retryTimer) this.#o.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#ws?.close();
    this.#ws = null;
    this.#session = null;
    this.emit('status', this.status());
  }

  #clearWatchdog() {
    if (this.#watchdog) this.#o.clearTimeout(this.#watchdog);
    this.#watchdog = null;
  }

  // Любое сообщение продлевает жизнь соединения; тишина дольше keepalive + запас — переподключение.
  #kick() {
    this.#clearWatchdog();
    this.#watchdog = this.#o.setTimeout(() => {
      this.#o.log.info('[eventsub] цішыня даўжэй за keepalive — перападлучэнне');
      this.#reconnectFresh();
    }, this.#keepaliveMs + this.#o.graceMs);
  }

  // Новое соединение с нуля (подписки заново).
  #reconnectFresh() {
    if (this.#stopped) return;
    this.#generation++;
    this.#clearWatchdog();
    const old = this.#ws;
    this.#ws = null;
    this.#session = null;
    try {
      old?.close();
    } catch {}
    const delay = Math.min(60000, 1000 * 2 ** this.#retry++);
    this.#retryTimer = this.#o.setTimeout(() => this.#open(this.#o.url, false), this.#retry === 1 ? 0 : delay);
  }

  #open(url, isReconnect) {
    if (this.#stopped) return;
    const gen = isReconnect ? this.#generation : ++this.#generation;
    let ws;
    try {
      ws = new this.#o.WebSocket(url);
    } catch (err) {
      this.#o.log.error(`[eventsub] не падлучыцца: ${err.message}`);
      return this.#reconnectFresh();
    }
    const previous = this.#ws;
    if (!isReconnect) this.#ws = ws;
    ws.on('message', (data) => this.#message(ws, gen, previous, isReconnect, data));
    ws.on('error', (err) => this.#o.log.info(`[eventsub] памылка злучэння: ${err.message}`));
    ws.on('close', () => {
      // Закрылось текущее соединение само — переподключиться.
      if (ws === this.#ws && !this.#stopped) {
        this.#o.log.info('[eventsub] злучэнне закрылася — перападлучэнне');
        this.#reconnectFresh();
      }
    });
  }

  async #message(ws, gen, previous, isReconnect, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const type = msg?.metadata?.message_type;
    const id = msg?.metadata?.message_id;
    if (type === 'session_welcome') {
      const s = msg.payload.session;
      this.#keepaliveMs = (s.keepalive_timeout_seconds ?? 10) * 1000;
      this.#session = s.id;
      this.#retry = 0;
      if (isReconnect) {
        // Подписки переехали сами; старое соединение больше не нужно.
        this.#ws = ws;
        try {
          previous?.close();
        } catch {}
        this.#o.log.info('[eventsub] перападлучэнне па reconnect_url — падпіскі захаваліся');
      } else {
        this.#o.log.info('[eventsub] падлучана');
        await this.#subscribeAll(gen);
      }
      this.#kick();
      this.emit('status', this.status());
      return;
    }
    if (ws !== this.#ws) return; // старое соединение, пока не пришёл welcome нового
    this.#kick();
    if (id) {
      if (this.#seen.has(id)) return;
      this.#seen.add(id);
      this.#seenOrder.push(id);
      if (this.#seenOrder.length > 500) this.#seen.delete(this.#seenOrder.shift());
    }
    if (type === 'session_keepalive') return;
    if (type === 'session_reconnect') {
      const url = msg.payload.session.reconnect_url;
      this.#o.log.info('[eventsub] Twitch просіць перападлучыцца');
      this.#open(url, true);
      return;
    }
    if (type === 'revocation') {
      const sub = msg.payload.subscription;
      const text = `${sub.type}: ${sub.status}`;
      this.#revoked.push(text);
      this.#subscribed = this.#subscribed.filter((t) => t !== sub.type);
      this.#o.log.error(`[eventsub] падпіска адклікана — ${text}`);
      this.emit('revoked', sub);
      this.emit('status', this.status());
      return;
    }
    if (type === 'notification') {
      try {
        this.emit(msg.metadata.subscription_type, msg.payload.event, msg.payload.subscription);
      } catch (err) {
        this.#o.log.error(`[eventsub] ${msg.metadata.subscription_type}: ${err.message}`);
      }
    }
  }

  async #subscribeAll(gen) {
    const uid = this.#o.twitch.user?.id;
    this.#subscribed = [];
    this.#failed = [];
    if (!uid) return;
    for (const sub of SUBSCRIPTIONS) {
      if (gen !== this.#generation) return; // соединение уже сменилось
      try {
        await this.#o.twitch.helix('POST', '/eventsub/subscriptions', {
          body: { type: sub.type, version: sub.version, condition: sub.condition(uid), transport: { method: 'websocket', session_id: this.#session } },
        });
        this.#subscribed.push(sub.type);
      } catch (err) {
        this.#failed.push(`${sub.type}: ${err.message}`);
        this.#o.log.error(`[eventsub] падпіска ${sub.type} не атрымалася: ${err.message}`);
      }
    }
    this.#o.log.info(`[eventsub] падпіскі: ${this.#subscribed.length} з ${SUBSCRIPTIONS.length}`);
  }
}
