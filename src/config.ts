function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

export const config = {
  get botToken() {
    return required("BOT_TOKEN");
  },
  get webhookSecret() {
    return process.env.WEBHOOK_SECRET || undefined;
  },
  get redis(): { url: string; token: string } | undefined {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    return url && token ? { url, token } : undefined;
  },
};

/** Апдейты, которые нужны боту. */
export const ALLOWED_UPDATES = ["message", "callback_query", "chat_member"] as const;

/** Загружает .env при локальном запуске (Node >= 20.12). */
export function loadDotEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // файла нет — используем переменные окружения как есть
  }
}
