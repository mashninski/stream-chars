// Награды за баллы канала.
// Режим auto: программа сама создаёт и обновляет свои награды по списку из настроек (rewards:
// название, цена, вкл/выкл, описание), хранит их id в data/twitch-rewards.json, не превышает лимит
// Twitch (50 наград на канал), отмечает срабатывания выполненными (FULFILLED). Баллы не возвращаются.
// Не получилось создать (канал не компаньон и не партнёр, 403) — режим manual: награды заводит автор,
// в админке связь «название награды → действие» (rewardLinks); отметить выполненными такие награды
// программа не может (Twitch разрешает это только создавшему приложению).
// Цену, название, описание и вкл/выкл можно менять и в админке, и в самом Twitch: при синхронизации
// то, что в Twitch отличается от последнего отправленного программой (pushed), значит, поменяли руками
// в Twitch — это забирается в настройки, а не затирается.
import { EventEmitter } from 'node:events';
import { readJson, writeJsonAtomic } from './files.js';

export const REWARD_LIMIT = 50;

export class Rewards extends EventEmitter {
  #o;
  #ids = {}; // ключ награды в настройках → id в Twitch
  #pushed = {}; // ключ → { title, cost, prompt, enabled } — что программа последний раз отправила в Twitch
  #used = undefined;
  #text = '';
  #ok = true;
  #handled = new Set();
  #syncing = null;

  // deps: twitch, settings, store, viewers, actions, log, file, isFollower(id) → Promise<bool|null>
  constructor(deps) {
    super();
    this.#o = deps;
    try {
      const saved = readJson(deps.file);
      this.#ids = saved?.ids ?? {};
      this.#pushed = saved?.pushed ?? {};
    } catch (err) {
      deps.log.error(`[узнагароды] ${err.message}`);
    }
  }

  status() {
    return { used: this.#used, limit: REWARD_LIMIT, own: Object.keys(this.#ids).length, text: this.#text, ok: this.#ok };
  }

  #set(text, ok = true) {
    this.#text = text;
    this.#ok = ok;
    this.emit('status', this.status());
  }

  #save() {
    writeJsonAtomic(this.#o.file, { ids: this.#ids, pushed: this.#pushed });
  }

  // Описание награды для Twitch (Create/Update Custom Rewards).
  #body(r) {
    return {
      title: String(r.title).slice(0, 45),
      cost: Math.max(1, Math.round(r.cost)),
      prompt: String(r.prompt ?? '').slice(0, 200),
      is_enabled: !!r.enabled,
      should_redemptions_skip_request_queue: false,
    };
  }

  // Создать недостающие и обновить свои награды по настройкам. Один запуск за раз.
  sync() {
    if (!this.#syncing) this.#syncing = this.#doSync().finally(() => (this.#syncing = null));
    return this.#syncing;
  }

  async #doSync() {
    const { twitch, settings, log } = this.#o;
    if (!twitch.connected) return { ok: false, error: 'спачатку ўвайдзіце ў Twitch' };
    if (settings.get().rewardMode !== 'auto') return { ok: false, error: 'рэжым «ручная сувязь» — праграма ўзнагароды не стварае' };
    const bid = twitch.user.id;
    let all;
    let own;
    try {
      all = (await twitch.helix('GET', '/channel_points/custom_rewards', { query: { broadcaster_id: bid } })).data?.data ?? [];
      own = (await twitch.helix('GET', '/channel_points/custom_rewards', { query: { broadcaster_id: bid, only_manageable_rewards: 'true' } })).data?.data ?? [];
    } catch (err) {
      return this.#fail(err);
    }
    this.#used = all.length;
    // Награды, удалённые руками в Twitch, забываем.
    const ownIds = new Set(own.map((r) => r.id));
    for (const [key, id] of Object.entries(this.#ids)) if (!ownIds.has(id)) delete this.#ids[key];
    this.#adoptTwitchEdits(own);
    const config = settings.get().rewards ?? {};
    const notes = [];
    let created = 0;
    let updated = 0;
    for (const [key, r] of Object.entries(config)) {
      const id = this.#ids[key];
      try {
        if (id) {
          await twitch.helix('PATCH', '/channel_points/custom_rewards', { query: { broadcaster_id: bid, id }, body: this.#body(r) });
          this.#remember(key, r);
          updated++;
        } else if (r.enabled) {
          if (this.#used >= REWARD_LIMIT) {
            notes.push(`«${r.title}» не створана: на канале ўжо ${REWARD_LIMIT} узнагарод`);
            continue;
          }
          const res = await twitch.helix('POST', '/channel_points/custom_rewards', { query: { broadcaster_id: bid }, body: this.#body(r) });
          this.#ids[key] = res.data.data[0].id;
          this.#remember(key, r);
          this.#used++;
          created++;
        }
      } catch (err) {
        if (err.status === 403) return this.#fail(err);
        const dup = /DUPLICATE/i.test(err.body?.message ?? err.message);
        notes.push(`«${r.title}»: ${dup ? 'узнагарода з такой назвай ужо ёсць на канале' : err.message}`);
      }
    }
    // Свои награды, которых больше нет в настройках, — выключить (не удалять: вдруг вернутся).
    for (const [key, id] of Object.entries(this.#ids)) {
      if (config[key]) continue;
      try {
        await twitch.helix('PATCH', '/channel_points/custom_rewards', { query: { broadcaster_id: bid, id }, body: { is_enabled: false } });
      } catch {}
    }
    this.#save();
    const text = `створана ${created}, абноўлена ${updated}; занята ${this.#used} з ${REWARD_LIMIT}${notes.length ? `. ${notes.join('; ')}` : ''}`;
    log.info(`[узнагароды] ${text}`);
    this.#set(text, !notes.length);
    return { ok: true, data: text };
  }

  #remember(key, r) {
    const b = this.#body(r);
    this.#pushed[key] = { title: b.title, cost: b.cost, prompt: b.prompt, enabled: b.is_enabled };
  }

  // Своя награда в Twitch не такая, какой программа её отправила, — её поменяли в Twitch руками:
  // новое значение — в настройки (админка покажет), чтобы следующая синхронизация его не затёрла.
  #adoptTwitchEdits(own) {
    const { settings, log } = this.#o;
    const byId = new Map(own.map((r) => [r.id, r]));
    const config = settings.get().rewards ?? {};
    const patch = {};
    for (const [key, id] of Object.entries(this.#ids)) {
      const tw = byId.get(id);
      const last = this.#pushed[key];
      if (!tw || !last || !config[key]) continue;
      const changed = {};
      if (tw.cost !== last.cost) changed.cost = tw.cost;
      if (tw.title !== last.title) changed.title = tw.title;
      if ((tw.prompt ?? '') !== last.prompt) changed.prompt = tw.prompt ?? '';
      if (tw.is_enabled !== last.enabled) changed.enabled = tw.is_enabled;
      if (Object.keys(changed).length) patch[key] = changed;
    }
    if (!Object.keys(patch).length) return;
    const res = settings.set({ rewards: patch });
    for (const [key, changed] of Object.entries(patch)) {
      const what = Object.entries(changed).map(([k, v]) => `${k} → ${v}`).join(', ');
      if (res.ok) log.info(`[узнагароды] «${config[key].title}» зменена ў Twitch: ${what} — узята ў налады`);
      else log.error(`[узнагароды] «${config[key].title}» зменена ў Twitch (${what}), але ў налады не ўзята: ${res.error}`);
    }
  }

  // 403 при создании — канал не компаньон/партнёр: запасной режим.
  #fail(err) {
    const { log, settings } = this.#o;
    if (err.status === 403) {
      const text = 'Twitch не дае ствараць узнагароды (канал не кампаньён або партнёр?). Уключаны рэжым «ручная сувязь»: заводзьце ўзнагароды самі і звяжыце назву з дзеяннем.';
      log.error(`[узнагароды] ${text}`);
      settings.set({ rewardMode: 'manual' });
      this.#set(text, false);
      return { ok: false, error: text };
    }
    const text = `не атрымалася абнавіць узнагароды: ${err.message}`;
    log.error(`[узнагароды] ${text}`);
    this.#set(text, false);
    return { ok: false, error: text };
  }

  // Какое действие у награды: своя (по id) — из настроек; чужая — ручная связь по названию.
  #match(reward) {
    const config = this.#o.settings.get();
    const key = Object.keys(this.#ids).find((k) => this.#ids[k] === reward.id);
    if (key && config.rewards?.[key]) return { own: true, ...config.rewards[key] };
    const title = String(reward.title ?? '').trim().toLowerCase();
    const link = Object.entries(config.rewardLinks ?? {}).find(([t]) => t.trim().toLowerCase() === title);
    if (link) return { own: false, action: link[1], followersOnly: false, title: reward.title };
    return null;
  }

  // Срабатывание награды (EventSub channel.channel_points_custom_reward_redemption.add).
  async handle(ev) {
    const { store, viewers, actions, log, twitch } = this.#o;
    if (this.#handled.has(ev.id)) return { ok: false, text: 'ужо было' };
    this.#handled.add(ev.id);
    const m = this.#match(ev.reward ?? {});
    if (!m) return { ok: false, text: 'не наша ўзнагарода' };
    // Зритель ещё без героя (не был в списке чата) — герой назначается сейчас, действие ждёт появления.
    if (!store.get(ev.user_id)) store.heroFor({ id: ev.user_id, name: ev.user_name }, viewers.takenColors());
    let result;
    if (m.followersOnly) {
      let follower = store.get(ev.user_id).flags.follower;
      if (!follower && (await this.#o.isFollower(ev.user_id))) {
        actions.onFollow(ev.user_id);
        follower = true;
      }
      if (!follower) result = { ok: false, text: 'не фалоўер — узнагарода толькі для фалоўераў, нічога не зроблена' };
    }
    result ??= actions.perform(ev.user_id, m.action, {}, { wait: true });
    log.info(`[узнагарода] ${ev.user_name}: «${ev.reward?.title}» → ${result.text}`);
    // Отмечаем выполненной всегда: баллы не возвращаются. Чужую награду Twitch отметить не даст.
    if (m.own && twitch.connected) {
      try {
        await twitch.helix('PATCH', '/channel_points/custom_rewards/redemptions', {
          query: { broadcaster_id: twitch.user.id, reward_id: ev.reward.id, id: ev.id },
          body: { status: 'FULFILLED' },
        });
      } catch (err) {
        log.error(`[узнагарода] не адзначана выкананай: ${err.message}`);
      }
    }
    return result;
  }
}
