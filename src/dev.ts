// Локальный запуск через long polling: npm run dev
import { loadDotEnv, ALLOWED_UPDATES } from "./config.js";

loadDotEnv();

const { createBot } = await import("./bot.js");
const bot = createBot();

// polling и webhook одновременно не работают — снимаем webhook
await bot.api.deleteWebhook();

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

await bot.start({
  allowed_updates: [...ALLOWED_UPDATES],
  onStart: (me) => console.log(`Бот @${me.username} запущен (polling). Ctrl+C — остановить.`),
});
