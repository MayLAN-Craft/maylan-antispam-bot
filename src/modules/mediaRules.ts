import type { Message } from "grammy/types";
import type { Limit, Settings } from "../settings.js";

/** «screen» — фото/видео, «meme» — гифки и стикеры. */
export type MediaKind = "screen" | "meme";
export type TopicType = "memes" | "screens" | "other";

export function mediaKindOf(msg: Message): MediaKind | null {
  if (msg.animation || msg.sticker) return "meme";
  if (msg.photo || msg.video || msg.video_note) return "screen";
  // картинка/гифка, отправленная файлом
  const mime = msg.document?.mime_type;
  if (mime?.startsWith("image/gif")) return "meme";
  if (mime?.startsWith("image/") || mime?.startsWith("video/")) return "screen";
  return null;
}

export function topicTypeOf(threadId: number | undefined, s: Settings): TopicType {
  if (threadId !== undefined && threadId === s.memesThread) return "memes";
  if (threadId !== undefined && threadId === s.screensThread) return "screens";
  return "other";
}

export type Precheck =
  | { action: "allow" }
  | { action: "delete"; reason: "banned" | "wrong_kind" }
  | { action: "count"; zone: "screens" | "other"; limit: Limit };

/** Решение, которое можно принять без счётчиков. */
export function precheck(input: {
  topic: TopicType;
  kind: MediaKind;
  isAdmin: boolean;
  mediaBanned: boolean;
  settings: Settings;
}): Precheck {
  const { topic, kind, settings } = input;
  if (input.isAdmin || topic === "memes") return { action: "allow" };
  if (input.mediaBanned) return { action: "delete", reason: "banned" };
  if (topic === "screens") {
    if (kind === "meme") return { action: "delete", reason: "wrong_kind" };
    return { action: "count", zone: "screens", limit: settings.screensLimit };
  }
  return { action: "count", zone: "other", limit: settings.mediaLimit };
}

export function overLimit(count: number, limit: Limit): boolean {
  return count > limit.count;
}
