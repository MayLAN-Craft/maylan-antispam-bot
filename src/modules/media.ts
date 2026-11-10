import { Composer, InlineKeyboard } from "grammy";
import { getSettings, type Settings } from "../settings.js";
import { getStore, keys } from "../store.js";
import { isAnonymousAdminMessage, isSenderAdmin } from "../lib/admins.js";
import { displayName, escapeHtml, mention, topicLink } from "../lib/format.js";
import { formatDuration } from "../lib/duration.js";
import { say, safeDelete, topicOf } from "../lib/reply.js";
import { mediaKindOf, overLimit, precheck, topicTypeOf } from "./mediaRules.js";
import { getMediaBan, setMediaBan } from "./mediaBan.js";
import { logAction } from "./log.js";

export const media = new Composer();

const HINT_COOLDOWN = 60;
const HINT_LIFETIME = 15;
const STRIKE_COOLDOWN = 60;

function memesRef(chat: { id: number; username?: string }, s: Settings): string {
  return s.memesThread ? `<a href="${topicLink(chat, s.memesThread)}">«Мемы»</a>` : "«Мемы»";
}

media.on("message", async (ctx, next) => {
  const msg = ctx.msg;
  const kind = mediaKindOf(msg);
  if (!kind || ctx.chat.type === "private") return next();
  // сообщения от имени группы (анонимные админы) и автопересылки из привязанного канала не трогаем
  if (isAnonymousAdminMessage(ctx) || msg.is_automatic_forward) return next();

  const sender = msg.sender_chat ?? msg.from;
  const senderId = sender.id;
  const senderName = msg.sender_chat ? displayName(msg.sender_chat as { title: string }) : displayName(msg.from);
  const chatId = ctx.chat.id;
  const settings = await getSettings(chatId);
  const topic = topicTypeOf(topicOf(ctx), settings);

  // в теме мемов ничего не проверяем — даже не спрашиваем список админов
  if (topic === "memes") return next();

  const store = getStore();
  const banUntil = await getMediaBan(chatId, senderId);
  const decision = precheck({
    topic,
    kind,
    isAdmin: !msg.sender_chat && (await isSenderAdmin(ctx)),
    mediaBanned: banUntil !== null,
    settings,
  });

  if (decision.action === "allow") return next();

  let hint: string;
  let strike = false;
  if (decision.action === "delete") {
    if (decision.reason === "banned") {
      const left = banUntil ? formatDuration((banUntil - Date.now()) / 1000) : "бессрочно";
      hint = `у вас ограничение на медиа (осталось: ${left}). Картинки и гифки можно только в ${memesRef(ctx.chat, settings)}.`;
    } else {
      hint = `гифкам и стикерам место в ${memesRef(ctx.chat, settings)}, здесь — только скриншоты и клипы.`;
    }
  } else {
    const count = await store.hit(keys.mediaWindow(chatId, senderId, decision.zone), decision.limit.window);
    if (!overLimit(count, decision.limit)) return next();
    strike = true;
    const limitText = `${decision.limit.count} за ${formatDuration(decision.limit.window)}`;
    hint =
      decision.zone === "screens"
        ? `в этой теме не больше ${limitText}. Подождите немного или киньте остальное в ${memesRef(ctx.chat, settings)}.`
        : `здесь не больше ${limitText} картинок и гифок. Остальное — в ${memesRef(ctx.chat, settings)}.`;
  }

  await safeDelete(ctx, msg.message_id);

  if (await store.setNX(keys.hintCooldown(chatId, senderId), 1, HINT_COOLDOWN)) {
    await say(ctx, `${mention(senderId, senderName)}, ${hint}`, { deleteAfterSec: HINT_LIFETIME });
  }

  if (!strike) return;
  // одна «серия» (например, альбом) = один страйк
  if (!(await store.setNX(keys.strikeCooldown(chatId, senderId), 1, STRIKE_COOLDOWN))) return;
  const strikes = await store.hit(keys.strikes(chatId, senderId), settings.strikes.window);
  if (strikes < settings.strikes.count) return;

  await store.del(keys.strikes(chatId, senderId));
  await setMediaBan(chatId, senderId, settings.strikes.banDuration);
  const duration = formatDuration(settings.strikes.banDuration);
  await say(
    ctx,
    `🖼 ${mention(senderId, senderName)} получает ограничение на медиа на ${duration} за повторный спам картинками. ` +
      `В ${memesRef(ctx.chat, settings)} по-прежнему можно.`,
    { deleteAfterSec: 120, keyboard: new InlineKeyboard().text("Снять", `undo:mban:${senderId}`) },
  );
  await logAction(
    ctx.api,
    ctx.chat,
    `🖼 Авто медиа-бан: ${mention(senderId, senderName)} на ${duration} (${escapeHtml(String(settings.strikes.count))} нарушения лимита)`,
  );
});
