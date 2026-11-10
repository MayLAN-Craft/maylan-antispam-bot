import type { Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { defer } from "./defer.js";

/** ID темы, в которой находится сообщение (undefined — General или обычная группа). */
export function topicOf(ctx: Context): number | undefined {
  const msg = ctx.msg;
  return msg?.is_topic_message ? msg.message_thread_id : undefined;
}

/** Отправляет сообщение в ту же тему, при необходимости удаляет его через `deleteAfterSec`. */
export async function say(
  ctx: Context,
  html: string,
  opts: { deleteAfterSec?: number; keyboard?: InlineKeyboardMarkup } = {},
) {
  const chatId = ctx.chat!.id;
  const sent = await ctx.api.sendMessage(chatId, html, {
    parse_mode: "HTML",
    message_thread_id: topicOf(ctx),
    link_preview_options: { is_disabled: true },
    reply_markup: opts.keyboard,
  });
  if (opts.deleteAfterSec) {
    defer(opts.deleteAfterSec * 1000, () => ctx.api.deleteMessage(chatId, sent.message_id));
  }
  return sent;
}

export async function safeDelete(ctx: Context, messageId?: number) {
  if (!ctx.chat || !messageId) return;
  try {
    await ctx.api.deleteMessage(ctx.chat.id, messageId);
  } catch {
    // уже удалено или нет прав
  }
}
