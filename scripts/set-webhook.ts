// Регистрирует webhook на Vercel и меню команд: npm run set-webhook
import { Api } from "grammy";
import { ALLOWED_UPDATES, config, loadDotEnv } from "../src/config.js";
import { COMMANDS } from "../src/bot.js";

loadDotEnv();

const url = process.argv[2] ?? process.env.WEBHOOK_URL;
if (!url) {
  console.error("Укажите адрес: npm run set-webhook -- https://<проект>.vercel.app/api/bot  (или WEBHOOK_URL в .env)");
  process.exit(1);
}
if (!config.webhookSecret) {
  console.error("Задайте WEBHOOK_SECRET в .env — тот же, что в настройках проекта на Vercel.");
  process.exit(1);
}

const api = new Api(config.botToken);

await api.setWebhook(url, {
  secret_token: config.webhookSecret,
  allowed_updates: [...ALLOWED_UPDATES],
  drop_pending_updates: true,
});
await api.setMyCommands(COMMANDS.everyone, { scope: { type: "all_group_chats" } });
await api.setMyCommands(COMMANDS.admins, { scope: { type: "all_chat_administrators" } });

const info = await api.getWebhookInfo();
console.log("Webhook установлен:", info.url);
if (info.last_error_message) console.log("Последняя ошибка Telegram:", info.last_error_message);
