// События EventSub → герои. Здесь решается, что делает каждое событие Twitch:
// - сообщение: цвет ника, месяцы подписки (значок subscriber → крылья; значка нет — крылья прячутся),
//   потом «первое слово» или triggers.message с облаком (actions.message); автора ещё нет в списке чата —
//   герой выходит сразу (twitch.seen); на экран не влез (очередь) — только признаки;
// - рейд → рейдеры на парашютах; фолловер → убор; подписка/продление → месяцы → крылья;
// - награда за баллы → rewards.handle. Стример и боты (twitch.ignore) — без реакции.
import { defaultNameColor } from '../public/js/color.js';

// Месяцы подписки из значков сообщения: { active, months }. Значок subscriber: info — число месяцев.
export function subscriberBadge(badges) {
  const b = (badges ?? []).find((x) => x.set_id === 'subscriber' || x.set_id === 'founder');
  if (!b) return { active: false, months: 0 };
  const months = Number(b.info) || Number(b.id) || 1;
  return { active: true, months };
}

export function wireTwitchEvents({ eventsub, twitch, store, viewers, actions, rewards, settings, log }) {
  const ignored = (id, login) => {
    if (id === twitch.user?.id) return true;
    const ignore = (settings.get().twitch?.ignore ?? []).map((s) => s.toLowerCase());
    return ignore.includes(String(login ?? '').toLowerCase());
  };

  eventsub.on('channel.chat.message', (ev) => {
    const id = ev.chatter_user_id;
    if (ignored(id, ev.chatter_user_login)) return;
    twitch.seen({ id, login: ev.chatter_user_login, name: ev.chatter_user_name });
    const entry = store.get(id);
    if (!entry) return;
    actions.setChatColor(id, ev.color || defaultNameColor(ev.chatter_user_login));
    const sub = subscriberBadge(ev.badges);
    if (sub.active !== entry.flags.subActive || (sub.active && sub.months > entry.flags.subMonths)) {
      actions.onSubscription(id, sub.months, sub.active);
    }
    if (!actions.message(id, ev.message?.text ?? '')) log.info(`[чат] ${ev.chatter_user_name} не на экране — абноўлены толькі прыкметы`);
  });

  eventsub.on('channel.raid', (ev) => {
    const n = viewers.raid(ev.from_broadcaster_user_name, Number(ev.viewers));
    log.info(`[рэйд] ${ev.from_broadcaster_user_name}: ${ev.viewers} гледачоў, спускаецца ${n}`);
  });

  eventsub.on('channel.follow', (ev) => {
    if (ignored(ev.user_id, ev.user_login)) return;
    if (store.get(ev.user_id)) actions.onFollow(ev.user_id);
    else log.info(`[фалоўер] ${ev.user_name}: героя пакуль няма — убор з'явіцца, калі прыйдзе ў чат`);
  });

  eventsub.on('channel.subscribe', (ev) => {
    const entry = store.get(ev.user_id);
    if (entry) actions.onSubscription(ev.user_id, Math.max(1, entry.flags.subMonths), true);
  });

  eventsub.on('channel.subscription.message', (ev) => {
    if (store.get(ev.user_id)) actions.onSubscription(ev.user_id, Number(ev.cumulative_months) || 1, true);
  });

  eventsub.on('channel.channel_points_custom_reward_redemption.add', (ev) => {
    rewards.handle(ev).catch((err) => log.error(`[узнагарода] ${err.message}`));
  });
}
