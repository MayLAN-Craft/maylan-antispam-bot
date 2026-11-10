import { Composer, InlineKeyboard } from "grammy";
import { getSettings } from "../settings.js";
import { getStore, keys } from "../store.js";
import { isSenderAdmin } from "../lib/admins.js";
import { displayName, mention } from "../lib/format.js";
import { formatDuration, untilDate } from "../lib/duration.js";
import { MUTED } from "../lib/permissions.js";
import { say, safeDelete } from "../lib/reply.js";
import { logAction } from "./log.js";

export const flood = new Composer();

flood.on("message", async (ctx, next) => {
  const msg = ctx.msg;
  if (ctx.chat.type === "private" || msg.sender_chat || msg.from.is_bot) return next();
  const settings = await getSettings(ctx.chat.id);
  if (!settings.flood.enabled) return next();

  const store = getStore();
  const chatId = ctx.chat.id;
  const userId = msg.from.id;

  // альбом считается одним сообщением
  if (msg.media_group_id && !(await store.setNX(keys.mediaGroup(chatId, msg.media_group_id, "flood"), 1, 60))) {
    return next();
  }

  const count = await store.hit(keys.flood(chatId, userId), settings.flood.window);
  if (count <= settings.flood.count) return next();
  if (await isSenderAdmin(ctx)) return next();

  await safeDelete(ctx, msg.message_id);
  // наказываем один раз за всплеск
  if (!(await store.setNX(keys.floodPunished(chatId, userId), 1, settings.flood.window))) return;

  const duration = settings.flood.muteDuration;
  try {
    await ctx.api.restrictChatMember(chatId, userId, MUTED, { until_date: untilDate(duration) });
  } catch (err) {
    console.error("Не удалось замутить флудера:", err);
    return;
  }
  const who = mention(userId, displayName(msg.from));
  await say(ctx, `🔇 ${who} замучен на ${formatDuration(duration)} за флуд.`, {
    deleteAfterSec: 120,
    keyboard: new InlineKeyboard().text("Снять", `undo:mute:${userId}`),
  });
  await logAction(ctx.api, ctx.chat, `🔇 Авто-мут за флуд: ${who} на ${formatDuration(duration)}`);
});
