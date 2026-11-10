import { Composer, type ChatTypeContext, type CommandContext, type Context } from "grammy";
import { getSettings, updateSettings, type Settings } from "../settings.js";
import { formatDuration, parseDuration } from "../lib/duration.js";
import { escapeHtml, topicLink } from "../lib/format.js";
import { requireAdmin } from "../lib/guard.js";
import { realReply } from "../lib/target.js";
import { say, safeDelete, topicOf } from "../lib/reply.js";

export const settingsCommands = new Composer();
const group = settingsCommands.chatType(["group", "supergroup"]);

const usage = (ctx: Context, text: string) => say(ctx, text, { deleteAfterSec: 30 });

/** Разбирает «<число> <время>», например «3 5m». */
function parseCountWindow(text: string): { count: number; window: number } | null {
  const [countStr, windowStr] = text.trim().split(/\s+/);
  const count = Number(countStr);
  const window = windowStr ? parseDuration(windowStr) : null;
  if (!Number.isInteger(count) || count < 1 || !window) return null;
  return { count, window };
}

function describe(chat: { id: number; username?: string }, s: Settings): string {
  const topic = (id?: number) => (id ? `<a href="${topicLink(chat, id)}">тема #${id}</a>` : "не задана");
  const lim = (l: { count: number; window: number }) => `${l.count} за ${formatDuration(l.window)}`;
  return [
    "<b>Настройки бота</b>",
    "",
    `Мемы: ${topic(s.memesThread)} — медиа без ограничений`,
    `Скриншоты и клипы: ${topic(s.screensThread)} — фото/видео ${lim(s.screensLimit)}, гифки и стикеры запрещены`,
    `Остальные темы: медиа ${lim(s.mediaLimit)}`,
    `Авто медиа-бан: после ${s.strikes.count} нарушений за ${formatDuration(s.strikes.window)} — на ${formatDuration(s.strikes.banDuration)}`,
    `Антифлуд: ${s.flood.enabled ? `вкл, больше ${lim(s.flood)} → мут на ${formatDuration(s.flood.muteDuration)}` : "выкл"}`,
    `Варны: ${s.warns.limit} → ${s.warns.action === "ban" ? "бан" : "мут"} на ${formatDuration(s.warns.duration)}`,
    `Лог-чат: ${s.logChatId ? `<code>${s.logChatId}</code>` : "не задан"}`,
    `Правила: ${s.rules ? "заданы" : "не заданы"}`,
  ].join("\n");
}

/** Обвязка: проверка прав, удаление команды. */
type GroupCommandContext = CommandContext<ChatTypeContext<Context, "group" | "supergroup">>;

function adminCommand(name: string, handler: (ctx: GroupCommandContext) => Promise<unknown>) {
  group.command(name, async (ctx) => {
    if (!(await requireAdmin(ctx, "changeInfo"))) return;
    await safeDelete(ctx, ctx.msg.message_id);
    await handler(ctx);
  });
}

// ---------- темы ----------

adminCommand("setmemes", async (ctx) => {
  const thread = topicOf(ctx);
  if (!thread) return usage(ctx, "Отправьте /setmemes внутри темы с мемами.");
  await updateSettings(ctx.chat.id, (s) => {
    s.memesThread = thread;
    if (s.screensThread === thread) s.screensThread = undefined;
  });
  await say(ctx, "✅ Эта тема — мемы. Здесь картинки, гифки и стикеры без ограничений.", { deleteAfterSec: 30 });
});

adminCommand("setscreens", async (ctx) => {
  const thread = topicOf(ctx);
  if (!thread) return usage(ctx, "Отправьте /setscreens внутри темы со скриншотами и клипами.");
  const s = await updateSettings(ctx.chat.id, (s) => {
    s.screensThread = thread;
    if (s.memesThread === thread) s.memesThread = undefined;
  });
  await say(
    ctx,
    `✅ Эта тема — скриншоты и клипы: до ${s.screensLimit.count} фото/видео за ${formatDuration(s.screensLimit.window)} на человека, гифки и стикеры удаляются.`,
    { deleteAfterSec: 30 },
  );
});

adminCommand("unsettopic", async (ctx) => {
  const thread = topicOf(ctx);
  if (!thread) return usage(ctx, "Отправьте /unsettopic внутри темы, которую нужно сделать обычной.");
  await updateSettings(ctx.chat.id, (s) => {
    if (s.memesThread === thread) s.memesThread = undefined;
    if (s.screensThread === thread) s.screensThread = undefined;
  });
  await say(ctx, "✅ Теперь это обычная тема.", { deleteAfterSec: 30 });
});

// ---------- лимиты ----------

adminCommand("setmedialimit", async (ctx) => {
  const v = parseCountWindow(ctx.match);
  if (!v) return usage(ctx, "Пример: <code>/setmedialimit 3 5m</code> — не больше 3 медиа за 5 минут в обычных темах.");
  await updateSettings(ctx.chat.id, (s) => void (s.mediaLimit = v));
  await say(ctx, `✅ В обычных темах: до ${v.count} медиа за ${formatDuration(v.window)}.`, { deleteAfterSec: 30 });
});

adminCommand("setscreenlimit", async (ctx) => {
  const v = parseCountWindow(ctx.match);
  if (!v) return usage(ctx, "Пример: <code>/setscreenlimit 20 5m</code> — до 20 скринов/клипов за 5 минут.");
  await updateSettings(ctx.chat.id, (s) => void (s.screensLimit = v));
  await say(ctx, `✅ В теме скриншотов: до ${v.count} фото/видео за ${formatDuration(v.window)}.`, { deleteAfterSec: 30 });
});

adminCommand("setstrikes", async (ctx) => {
  const [count, window, ban] = ctx.match.trim().split(/\s+/);
  const v = parseCountWindow(`${count ?? ""} ${window ?? ""}`);
  const banDuration = ban ? parseDuration(ban) : null;
  if (!v || !banDuration) {
    return usage(ctx, "Пример: <code>/setstrikes 3 1h 1h</code> — после 3 нарушений лимита за час медиа-бан на час.");
  }
  await updateSettings(ctx.chat.id, (s) => void (s.strikes = { ...v, banDuration }));
  await say(
    ctx,
    `✅ Авто медиа-бан: ${v.count} нарушений за ${formatDuration(v.window)} → бан на ${formatDuration(banDuration)}.`,
    { deleteAfterSec: 30 },
  );
});

adminCommand("setflood", async (ctx) => {
  const [count, window, mute] = ctx.match.trim().split(/\s+/);
  const v = parseCountWindow(`${count ?? ""} ${window ?? ""}`);
  const muteDuration = mute ? parseDuration(mute) : undefined;
  if (!v || muteDuration === null) {
    return usage(ctx, "Пример: <code>/setflood 7 10s 10m</code> — больше 7 сообщений за 10 секунд → мут на 10 минут.");
  }
  const s = await updateSettings(ctx.chat.id, (s) => {
    s.flood = { ...s.flood, ...v, enabled: true, muteDuration: muteDuration ?? s.flood.muteDuration };
  });
  await say(
    ctx,
    `✅ Антифлуд: больше ${s.flood.count} сообщений за ${formatDuration(s.flood.window)} → мут на ${formatDuration(s.flood.muteDuration)}.`,
    { deleteAfterSec: 30 },
  );
});

adminCommand("antiflood", async (ctx) => {
  const arg = ctx.match.trim().toLowerCase();
  if (!["on", "off", "вкл", "выкл"].includes(arg)) return usage(ctx, "Пример: <code>/antiflood on</code> или <code>/antiflood off</code>");
  const enabled = arg === "on" || arg === "вкл";
  await updateSettings(ctx.chat.id, (s) => void (s.flood.enabled = enabled));
  await say(ctx, `✅ Антифлуд ${enabled ? "включён" : "выключен"}.`, { deleteAfterSec: 30 });
});

adminCommand("setwarnlimit", async (ctx) => {
  const [countStr, actionStr, durStr] = ctx.match.trim().toLowerCase().split(/\s+/);
  const limit = Number(countStr);
  const action = actionStr === "ban" || actionStr === "бан" ? "ban" : actionStr === "mute" || actionStr === "мут" ? "mute" : null;
  const duration = durStr ? parseDuration(durStr) : undefined;
  if (!Number.isInteger(limit) || limit < 1 || !action || duration === null) {
    return usage(ctx, "Пример: <code>/setwarnlimit 3 mute 1d</code> или <code>/setwarnlimit 3 ban 7d</code>");
  }
  const s = await updateSettings(ctx.chat.id, (s) => {
    s.warns = { limit, action, duration: duration ?? s.warns.duration };
  });
  await say(
    ctx,
    `✅ После ${limit} предупреждений — ${action === "ban" ? "бан" : "мут"} на ${formatDuration(s.warns.duration)}.`,
    { deleteAfterSec: 30 },
  );
});

// ---------- лог, правила ----------

adminCommand("setlog", async (ctx) => {
  const arg = ctx.match.trim().toLowerCase();
  if (arg === "off" || arg === "выкл") {
    await updateSettings(ctx.chat.id, (s) => void (s.logChatId = undefined));
    return say(ctx, "✅ Лог выключен.", { deleteAfterSec: 30 });
  }
  const id = Number(arg);
  if (!/^-?\d+$/.test(arg)) {
    return usage(
      ctx,
      "Добавьте бота в лог-чат (группу или канал), узнайте его ID командой /id там и отправьте здесь <code>/setlog -100…</code>. Выключить: <code>/setlog off</code>",
    );
  }
  try {
    await ctx.api.sendMessage(id, "✅ Этот чат подключён как лог модерации.");
  } catch {
    return usage(ctx, "Не могу написать в этот чат. Бот добавлен туда и может отправлять сообщения?");
  }
  await updateSettings(ctx.chat.id, (s) => void (s.logChatId = id));
  await say(ctx, "✅ Лог-чат подключён.", { deleteAfterSec: 30 });
});

adminCommand("setrules", async (ctx) => {
  const text = ctx.match.trim();
  if (!text) return usage(ctx, "Пример: <code>/setrules 1. Не спамить. 2. Мемы — в тему мемов.</code>");
  await updateSettings(ctx.chat.id, (s) => void (s.rules = text));
  await say(ctx, "✅ Правила сохранены. Посмотреть: /rules", { deleteAfterSec: 30 });
});

adminCommand("settings", async (ctx) => {
  await say(ctx, describe(ctx.chat, await getSettings(ctx.chat.id)), { deleteAfterSec: 120 });
});

// ---------- /id — работает везде, нужен для /setlog ----------

settingsCommands.command("id", async (ctx) => {
  const lines = [`ID чата: <code>${ctx.chat.id}</code>`];
  const thread = topicOf(ctx);
  if (thread) lines.push(`ID темы: <code>${thread}</code>`);
  const reply = ctx.msg && realReply(ctx.msg);
  if (reply?.from) lines.push(`ID пользователя: <code>${reply.from.id}</code> (${escapeHtml(reply.from.first_name)})`);
  else if (ctx.from) lines.push(`Ваш ID: <code>${ctx.from.id}</code>`);
  await say(ctx, lines.join("\n"), { deleteAfterSec: ctx.chat.type === "private" ? undefined : 60 });
});
