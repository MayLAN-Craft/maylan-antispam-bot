import { Composer } from "grammy";
import { getSettings } from "../settings.js";
import { getAdmins } from "../lib/admins.js";
import { displayName, escapeHtml, mention } from "../lib/format.js";
import { realReply } from "../lib/target.js";
import { say, safeDelete } from "../lib/reply.js";
import { getStore } from "../store.js";
import { logAction } from "./log.js";

export const reports = new Composer();
const group = reports.chatType(["group", "supergroup"]);

const REPORT_COOLDOWN = 60;

group.command("report", async (ctx) => {
  const reply = realReply(ctx.msg);
  await safeDelete(ctx, ctx.msg.message_id);
  if (!reply) {
    await say(ctx, "Ответьте командой /report на сообщение, о котором нужно сообщить админам.", { deleteAfterSec: 15 });
    return;
  }
  // не больше одной жалобы в минуту от человека
  const reporter = ctx.from;
  if (!(await getStore().setNX(`rep:${ctx.chat.id}:${reporter.id}`, 1, REPORT_COOLDOWN))) {
    await say(ctx, "Жалоба уже отправлена, подождите немного.", { deleteAfterSec: 10 });
    return;
  }
  const admins = (await getAdmins(ctx.api, ctx.chat.id)).filter((a) => !a.isBot && !a.isAnonymous);
  // невидимые упоминания: админы получат уведомление, а чат не засоряется списком имён
  const pings = admins.map((a) => `<a href="tg://user?id=${a.id}">​</a>`).join("");
  const author = reply.from ? mention(reply.from.id, displayName(reply.from)) : "сообщение";
  await ctx.api.sendMessage(ctx.chat.id, `🚨 Жалоба на ${author} отправлена администраторам.${pings}`, {
    parse_mode: "HTML",
    reply_parameters: { message_id: reply.message_id, allow_sending_without_reply: true },
    message_thread_id: ctx.msg.is_topic_message ? ctx.msg.message_thread_id : undefined,
  });
  const link = ctx.chat.username
    ? `https://t.me/${ctx.chat.username}/${reply.message_id}`
    : `https://t.me/c/${String(ctx.chat.id).replace(/^-100/, "")}/${reply.message_id}`;
  await logAction(
    ctx.api,
    ctx.chat,
    `🚨 Жалоба от ${mention(reporter.id, displayName(reporter))} на ${author}: <a href="${link}">сообщение</a>`,
  );
});

group.command("rules", async (ctx) => {
  const { rules } = await getSettings(ctx.chat.id);
  await safeDelete(ctx, ctx.msg.message_id);
  await say(ctx, rules ? `📜 <b>Правила</b>\n\n${escapeHtml(rules)}` : "Правила пока не заданы.", {
    deleteAfterSec: 120,
  });
});

const HELP_USER = [
  "<b>Команды для всех</b>",
  "/rules — правила группы",
  "/report — ответом на сообщение: пожаловаться админам",
  "/id — показать ID",
];

const HELP_ADMIN = [
  "",
  "<b>Модерация</b> (ответом на сообщение или с @username / ID)",
  "/mute [время] [причина] — мут; без времени — навсегда",
  "/unmute — снять мут",
  "/ban [время] [причина], /unban, /kick",
  "/warn [причина], /unwarn, /warns",
  "/mediaban [время] — запретить медиа вне мемов, /mediaunban",
  "/del — удалить сообщение, /purge — удалить всё начиная с сообщения",
  "/ro — режим «только чтение» для всех, /ro off — выключить",
  "Время: 30s, 10m, 2h, 1d, 1w, 1h30m (или 10м, 2ч, 1д)",
  "",
  "<b>Настройки</b>",
  "/setmemes — в теме мемов: медиа без ограничений",
  "/setscreens — в теме скриншотов: фото/видео с лимитом, без гифок и стикеров",
  "/unsettopic — сделать тему обычной",
  "/setmedialimit 3 5m, /setscreenlimit 20 5m",
  "/setstrikes 3 1h 1h — авто медиа-бан за повторный спам",
  "/setflood 7 10s 10m, /antiflood on|off",
  "/setwarnlimit 3 mute 1d",
  "/setlog &lt;ID&gt; | off, /setrules &lt;текст&gt;, /settings",
];

reports.command(["help", "start"], async (ctx) => {
  const inGroup = ctx.chat.type !== "private";
  if (inGroup) await safeDelete(ctx, ctx.msg?.message_id);
  const text = [...HELP_USER, ...HELP_ADMIN].join("\n");
  await say(ctx, inGroup ? text : `Я бот-модератор. Добавьте меня в группу админом.\n\n${text}`, {
    deleteAfterSec: inGroup ? 120 : undefined,
  });
});
