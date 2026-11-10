import type { Api } from "grammy";
import { getSettings } from "../settings.js";
import { escapeHtml } from "../lib/format.js";

/** Пишет запись о действии в лог-чат, если он настроен. */
export async function logAction(api: Api, chat: { id: number; title?: string }, html: string) {
  const { logChatId } = await getSettings(chat.id);
  if (!logChatId) return;
  try {
    const header = chat.title ? `<b>${escapeHtml(chat.title)}</b>\n` : "";
    await api.sendMessage(logChatId, header + html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.error("Не удалось записать в лог-чат:", err);
  }
}
