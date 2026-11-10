import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { config } from "./config.js";
import { invalidateAdmins } from "./lib/admins.js";
import { rememberUser } from "./lib/target.js";
import { flood } from "./modules/flood.js";
import { media } from "./modules/media.js";
import { moderation } from "./modules/moderation.js";
import { settingsCommands } from "./modules/settingsCommands.js";
import { reports } from "./modules/reports.js";

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  // на serverless долго ждать нельзя — повторяем только короткие паузы flood-лимита Telegram
  bot.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 5 }));

  // запоминаем username → id, чтобы команды работали с @username
  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type !== "private" && ctx.from && !ctx.msg.sender_chat) {
      await rememberUser(ctx.chat.id, ctx.from).catch(() => {});
    }
    await next();
  });

  // назначили/сняли админа — сбрасываем кэш списка админов
  bot.on("chat_member", async (ctx) => {
    const { old_chat_member: before, new_chat_member: after } = ctx.chatMember;
    const isAdmin = (s: string) => s === "administrator" || s === "creator";
    if (isAdmin(before.status) || isAdmin(after.status)) await invalidateAdmins(ctx.chat.id);
  });

  bot.use(flood);
  bot.use(media);
  bot.use(reports);
  bot.use(settingsCommands);
  bot.use(moderation);

  bot.catch((err) => {
    console.error(`Ошибка при обработке апдейта ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}

/** Меню команд для подсказок в Telegram. */
export const COMMANDS = {
  everyone: [
    { command: "rules", description: "Правила группы" },
    { command: "report", description: "Пожаловаться на сообщение (ответом)" },
    { command: "help", description: "Список команд" },
  ],
  admins: [
    { command: "mute", description: "Мут: [время] [причина]" },
    { command: "unmute", description: "Снять мут" },
    { command: "ban", description: "Бан: [время] [причина]" },
    { command: "unban", description: "Разбан" },
    { command: "kick", description: "Исключить" },
    { command: "warn", description: "Предупреждение" },
    { command: "unwarn", description: "Снять предупреждение" },
    { command: "warns", description: "Сколько предупреждений" },
    { command: "mediaban", description: "Запрет медиа вне мемов: [время]" },
    { command: "mediaunban", description: "Снять запрет медиа" },
    { command: "del", description: "Удалить сообщение (ответом)" },
    { command: "purge", description: "Удалить всё начиная с сообщения" },
    { command: "ro", description: "Режим «только чтение» (off — выключить)" },
    { command: "setmemes", description: "Эта тема — мемы" },
    { command: "setscreens", description: "Эта тема — скриншоты и клипы" },
    { command: "unsettopic", description: "Сделать тему обычной" },
    { command: "settings", description: "Показать настройки" },
    { command: "rules", description: "Правила группы" },
    { command: "help", description: "Список команд" },
  ],
};
