import { webhookCallback } from "grammy";
import { createBot } from "../src/bot.js";
import { config } from "../src/config.js";

const bot = createBot();

const handle = webhookCallback(bot, "std/http", {
  secretToken: config.webhookSecret,
  // Telegram повторит апдейт, если не получит ответ; даём обработчику до 50 секунд
  timeoutMilliseconds: 50_000,
  onTimeout: "return",
});

export async function POST(request: Request): Promise<Response> {
  // отсекаем чужие запросы сразу, до обращения к Telegram API
  const secret = config.webhookSecret;
  if (secret && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  return handle(request);
}

export function GET(): Response {
  return new Response("ok");
}
