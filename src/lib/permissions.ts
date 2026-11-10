import type { ChatPermissions } from "grammy/types";

const ALL_KEYS = [
  "can_send_messages",
  "can_send_audios",
  "can_send_documents",
  "can_send_photos",
  "can_send_videos",
  "can_send_video_notes",
  "can_send_voice_notes",
  "can_send_polls",
  "can_send_other_messages",
  "can_add_web_page_previews",
  "can_invite_users",
  "can_change_info",
  "can_pin_messages",
  "can_manage_topics",
] as const;

const SEND_KEYS = ALL_KEYS.filter((k) => k.startsWith("can_send") || k === "can_add_web_page_previews");

function build(keysList: readonly string[], value: boolean): ChatPermissions {
  return Object.fromEntries(keysList.map((k) => [k, value])) as ChatPermissions;
}

/** Мут: ничего нельзя отправлять. */
export const MUTED: ChatPermissions = build(ALL_KEYS, false);
/** Снятие ограничений: пользователь снова обычный участник (общие права чата продолжают действовать). */
export const UNRESTRICTED: ChatPermissions = build(ALL_KEYS, true);
/** Режим «только чтение» для всего чата. */
export const READ_ONLY: ChatPermissions = build(SEND_KEYS, false);
