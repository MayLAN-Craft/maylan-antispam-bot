import type { Chat, User } from "grammy/types";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function displayName(user: Pick<User, "first_name" | "last_name"> | Pick<Chat.ChannelChat, "title">): string {
  if ("title" in user) return user.title;
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "без имени";
}

export function mention(id: number, name: string): string {
  return `<a href="tg://user?id=${id}">${escapeHtml(name)}</a>`;
}

/** Ссылка на тему форума. */
export function topicLink(chat: { id: number; username?: string }, threadId: number): string {
  if (chat.username) return `https://t.me/${chat.username}/${threadId}`;
  const internal = String(chat.id).replace(/^-100/, "");
  return `https://t.me/c/${internal}/${threadId}`;
}
