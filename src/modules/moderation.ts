import { Composer, InlineKeyboard, type Api, type Context } from "grammy";
import type { ChatPermissions } from "grammy/types";
import { getSettings } from "../settings.js";
import { getStore, keys } from "../store.js";
import { escapeHtml, mention, displayName } from "../lib/format.js";
import { formatDuration, untilDate } from "../lib/duration.js";
import { MUTED, READ_ONLY, UNRESTRICTED } from "../lib/permissions.js";
import { describeError, requireAdmin, withTarget } from "../lib/guard.js";
import { isSenderAdmin } from "../lib/admins.js";
import { realReply } from "../lib/target.js";
import { say, safeDelete } from "../lib/reply.js";
import { clearMediaBan, setMediaBan } from "./mediaBan.js";
import { logAction } from "./log.js";

export const moderation = new Composer();
const group = moderation.chatType(["group", "supergroup"]);

const WARNS_TTL = 90 * 86400;
const undoButton = (kind: string, userId: number) => new InlineKeyboard().text("Снять", `undo:${kind}:${userId}`);
const reasonLine = (reason?: string) => (reason ? `\nПричина: ${escapeHtml(reason)}` : "");
const forTime = (duration?: number) => (duration ? `на ${formatDuration(duration)}` : "навсегда");
/** Кто выполнил действие — только для мод-лога, в группе админ не упоминается. */
const byAdmin = (ctx: Context) => {
  if (ctx.msg?.sender_chat) {
    const sig = ctx.msg.author_signature;
    return ` (анонимный админ${sig ? ` «${escapeHtml(sig)}»` : ""})`;
  }
  return ctx.from ? ` (админ ${mention(ctx.from.id, displayName(ctx.from))})` : "";
};

/** Права по умолчанию для /ro off, если резервной копии нет: всё, кроме управления группой. */
const MEMBER_DEFAULTS: ChatPermissions = {
  ...UNRESTRICTED,
  can_change_info: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

// ---------- действия, общие для команд и кнопки «Снять» ----------

async function unmute(api: Api, chatId: number, userId: number) {
  await api.restrictChatMember(chatId, userId, UNRESTRICTED);
}

async function unban(api: Api, chatId: number, userId: number) {
  await api.unbanChatMember(chatId, userId, { only_if_banned: true });
}

async function changeWarns(chatId: number, userId: number, delta: number): Promise<number> {
  const store = getStore();
  const current = (await store.get<number>(keys.warns(chatId, userId))) ?? 0;
  const next = Math.max(0, current + delta);
  if (next === 0) await store.del(keys.warns(chatId, userId));
  else await store.set(keys.warns(chatId, userId), next, WARNS_TTL);
  return next;
}

// ---------- мут / бан / кик ----------

group.command("mute", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: true }, async (t, { duration, reason }) => {
    await ctx.api.restrictChatMember(ctx.chat.id, t.id, MUTED, { until_date: untilDate(duration) });
    const who = mention(t.id, t.name);
    await say(ctx, `🔇 ${who} замучен ${forTime(duration)}.${reasonLine(reason)}`, {
      keyboard: undoButton("mute", t.id),
    });
    await logAction(ctx.api, ctx.chat, `🔇 Мут: ${who}, ${forTime(duration)}${byAdmin(ctx)}${reasonLine(reason)}`);
  }),
);

group.command("unmute", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false }, async (t) => {
    await unmute(ctx.api, ctx.chat.id, t.id);
    await say(ctx, `🔊 С ${mention(t.id, t.name)} снят мут.`);
    await logAction(ctx.api, ctx.chat, `🔊 Размут: ${mention(t.id, t.name)}${byAdmin(ctx)}`);
  }),
);

group.command("ban", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: true }, async (t, { duration, reason }) => {
    await ctx.api.banChatMember(ctx.chat.id, t.id, { until_date: untilDate(duration) });
    const who = mention(t.id, t.name);
    await say(ctx, `⛔ ${who} забанен ${forTime(duration)}.${reasonLine(reason)}`, {
      keyboard: undoButton("ban", t.id),
    });
    await logAction(ctx.api, ctx.chat, `⛔ Бан: ${who}, ${forTime(duration)}${byAdmin(ctx)}${reasonLine(reason)}`);
  }),
);

group.command("unban", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false }, async (t) => {
    await unban(ctx.api, ctx.chat.id, t.id);
    await say(ctx, `✅ ${mention(t.id, t.name)} разбанен — вернуться можно по новой заявке.`);
    await logAction(ctx.api, ctx.chat, `✅ Разбан: ${mention(t.id, t.name)}${byAdmin(ctx)}`);
  }),
);

group.command("kick", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false }, async (t, { reason }) => {
    await ctx.api.banChatMember(ctx.chat.id, t.id);
    await ctx.api.unbanChatMember(ctx.chat.id, t.id, { only_if_banned: true });
    await say(ctx, `👢 ${mention(t.id, t.name)} исключён из группы.${reasonLine(reason)}`);
    await logAction(ctx.api, ctx.chat, `👢 Кик: ${mention(t.id, t.name)}${byAdmin(ctx)}${reasonLine(reason)}`);
  }),
);

// ---------- предупреждения ----------

group.command("warn", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false }, async (t, { reason }) => {
    const { limit, action, duration } = (await getSettings(ctx.chat.id)).warns;
    const count = await changeWarns(ctx.chat.id, t.id, +1);
    const who = mention(t.id, t.name);

    if (count < limit) {
      await say(ctx, `⚠️ ${who} получает предупреждение (${count}/${limit}).${reasonLine(reason)}`, {
        keyboard: undoButton("warn", t.id),
      });
      await logAction(ctx.api, ctx.chat, `⚠️ Варн ${count}/${limit}: ${who}${byAdmin(ctx)}${reasonLine(reason)}`);
      return;
    }

    await getStore().del(keys.warns(ctx.chat.id, t.id));
    if (action === "ban") {
      await ctx.api.banChatMember(ctx.chat.id, t.id, { until_date: untilDate(duration) });
    } else {
      await ctx.api.restrictChatMember(ctx.chat.id, t.id, MUTED, { until_date: untilDate(duration) });
    }
    const verb = action === "ban" ? "⛔ забанен" : "🔇 замучен";
    await say(ctx, `⚠️ ${who} набрал ${limit}/${limit} предупреждений и ${verb} ${forTime(duration)}.${reasonLine(reason)}`, {
      keyboard: undoButton(action, t.id),
    });
    await logAction(
      ctx.api,
      ctx.chat,
      `⚠️ Лимит варнов: ${who} ${verb} ${forTime(duration)}${byAdmin(ctx)}${reasonLine(reason)}`,
    );
  }),
);

group.command("unwarn", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false, allowAdminTarget: true }, async (t) => {
    const { limit } = (await getSettings(ctx.chat.id)).warns;
    const count = await changeWarns(ctx.chat.id, t.id, -1);
    await say(ctx, `↩️ С ${mention(t.id, t.name)} снято предупреждение (${count}/${limit}).`);
    await logAction(ctx.api, ctx.chat, `↩️ Снят варн: ${mention(t.id, t.name)}${byAdmin(ctx)}`);
  }),
);

group.command("warns", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false, allowAdminTarget: true }, async (t) => {
    const { limit } = (await getSettings(ctx.chat.id)).warns;
    const count = (await getStore().get<number>(keys.warns(ctx.chat.id, t.id))) ?? 0;
    await say(ctx, `У ${mention(t.id, t.name)} предупреждений: ${count}/${limit}.`, { deleteAfterSec: 60 });
  }),
);

// ---------- медиа-бан ----------

group.command("mediaban", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: true }, async (t, { duration, reason }) => {
    await setMediaBan(ctx.chat.id, t.id, duration);
    const who = mention(t.id, t.name);
    const time = duration ? `на ${formatDuration(duration)}` : "бессрочно";
    await say(
      ctx,
      `🖼 ${who} не может отправлять картинки, гифки и видео вне темы мемов ${time}.${reasonLine(reason)}`,
      { keyboard: undoButton("mban", t.id) },
    );
    await logAction(ctx.api, ctx.chat, `🖼 Медиа-бан: ${who}, ${time}${byAdmin(ctx)}${reasonLine(reason)}`);
  }),
);

group.command("mediaunban", (ctx) =>
  withTarget(ctx, { right: "restrict", withDuration: false }, async (t) => {
    await clearMediaBan(ctx.chat.id, t.id);
    await say(ctx, `🖼 С ${mention(t.id, t.name)} снято ограничение на медиа.`);
    await logAction(ctx.api, ctx.chat, `🖼 Снят медиа-бан: ${mention(t.id, t.name)}${byAdmin(ctx)}`);
  }),
);

// ---------- удаление сообщений ----------

group.command("del", async (ctx) => {
  if (!(await requireAdmin(ctx, "delete"))) return;
  const reply = realReply(ctx.msg);
  await safeDelete(ctx, ctx.msg.message_id);
  if (!reply) {
    await say(ctx, "Ответьте командой /del на сообщение, которое нужно удалить.", { deleteAfterSec: 10 });
    return;
  }
  await safeDelete(ctx, reply.message_id);
});

const PURGE_MAX = 1000;

group.command("purge", async (ctx) => {
  if (!(await requireAdmin(ctx, "delete"))) return;
  const reply = realReply(ctx.msg);
  if (!reply) {
    await safeDelete(ctx, ctx.msg.message_id);
    await say(ctx, "Ответьте командой /purge на сообщение, начиная с которого нужно всё удалить.", {
      deleteAfterSec: 10,
    });
    return;
  }
  // В группе с темами ID сообщений общие для всех тем, поэтому удаляются сообщения из диапазона во всех темах.
  const from = Math.max(reply.message_id, ctx.msg.message_id - PURGE_MAX);
  const ids: number[] = [];
  for (let id = from; id <= ctx.msg.message_id; id++) ids.push(id);
  try {
    for (let i = 0; i < ids.length; i += 100) {
      await ctx.api.deleteMessages(ctx.chat.id, ids.slice(i, i + 100));
    }
    await say(ctx, "🧹 Готово.", { deleteAfterSec: 5 });
    await logAction(ctx.api, ctx.chat, `🧹 Очистка: до ${ids.length - 1} сообщений${byAdmin(ctx)}`);
  } catch (err) {
    await say(ctx, `Не получилось: ${escapeHtml(describeError(err))}.`, { deleteAfterSec: 20 });
  }
});

// ---------- режим «только чтение» ----------

group.command("ro", async (ctx) => {
  if (!(await requireAdmin(ctx, "restrict"))) return;
  await safeDelete(ctx, ctx.msg.message_id);
  const arg = ctx.match.trim().toLowerCase();
  const store = getStore();
  try {
    if (arg === "off" || arg === "выкл") {
      const backup = await store.get<ChatPermissions>(keys.roBackup(ctx.chat.id));
      await ctx.api.setChatPermissions(ctx.chat.id, backup ?? MEMBER_DEFAULTS);
      await store.del(keys.roBackup(ctx.chat.id));
      await say(ctx, "🔓 Режим «только чтение» выключен, писать снова можно.");
      await logAction(ctx.api, ctx.chat, `🔓 Режим «только чтение» выключен${byAdmin(ctx)}`);
      return;
    }
    const chat = await ctx.api.getChat(ctx.chat.id);
    if (chat.permissions && !(await store.get(keys.roBackup(ctx.chat.id)))) {
      await store.set(keys.roBackup(ctx.chat.id), chat.permissions);
    }
    await ctx.api.setChatPermissions(ctx.chat.id, READ_ONLY);
    await say(ctx, "🔒 Включён режим «только чтение»: писать могут только админы. Выключить: <code>/ro off</code>");
    await logAction(ctx.api, ctx.chat, `🔒 Режим «только чтение» включён${byAdmin(ctx)}`);
  } catch (err) {
    await say(ctx, `Не получилось: ${escapeHtml(describeError(err))}.`, { deleteAfterSec: 20 });
  }
});

// ---------- кнопка «Снять» ----------

const UNDO_LABELS = { mute: "мут", ban: "бан", mban: "медиа-бан", warn: "варн" } as const;
type UndoKind = keyof typeof UNDO_LABELS;

moderation.callbackQuery(/^undo:(mute|ban|mban|warn):(\d+)$/, async (ctx) => {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") return ctx.answerCallbackQuery();
  if (!(await isSenderAdmin(ctx, "restrict"))) {
    return ctx.answerCallbackQuery({ text: "Только для админов.", show_alert: true });
  }
  const kind = ctx.match[1] as UndoKind;
  const userId = Number(ctx.match[2]);
  try {
    if (kind === "mute") await unmute(ctx.api, chat.id, userId);
    else if (kind === "ban") await unban(ctx.api, chat.id, userId);
    else if (kind === "mban") await clearMediaBan(chat.id, userId);
    else await changeWarns(chat.id, userId, -1);
  } catch (err) {
    return ctx.answerCallbackQuery({ text: `Не получилось: ${describeError(err)}`, show_alert: true });
  }
  await ctx.answerCallbackQuery({ text: "Готово" });

  const admin = displayName(ctx.from);
  const message = ctx.callbackQuery.message;
  if (message && "text" in message && message.text) {
    // дописываем строку, сохраняя форматирование исходного текста; кнопка исчезает.
    // Кто отменил — пишем только в мод-лог.
    await ctx.editMessageText(`${message.text}\n\n✅ Отменено`, { entities: message.entities }).catch(() => {});
  }
  await logAction(
    ctx.api,
    chat,
    `✅ Отменён ${UNDO_LABELS[kind]} для ${mention(userId, String(userId))} (админ ${mention(ctx.from.id, admin)})`,
  );
});
