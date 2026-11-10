import type { Context } from "grammy";
import type { Message, MessageEntity } from "grammy/types";
import { parseDuration } from "./duration.js";
import { getStore, keys } from "../store.js";
import { displayName } from "./format.js";

export interface Target {
  id: number;
  name: string;
}

export interface ParsedArgs {
  /** Явная цель из аргументов: @username или числовой ID */
  targetToken?: string;
  /** Длительность в секундах */
  duration?: number;
  reason?: string;
}

/**
 * Разбирает аргументы команды вида `[@user|id] [время] [причина]`.
 * Если цель указана ответом на сообщение, первым аргументом цель не ожидается.
 */
export function parseArgs(text: string, opts: { hasReplyTarget: boolean; withDuration: boolean }): ParsedArgs {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const result: ParsedArgs = {};
  if (!opts.hasReplyTarget && tokens.length > 0 && /^(@\w{3,}|-?\d{5,})$/.test(tokens[0])) {
    result.targetToken = tokens.shift();
  }
  if (opts.withDuration && tokens.length > 0) {
    const d = parseDuration(tokens[0]);
    if (d !== null) {
      result.duration = d;
      tokens.shift();
    }
  }
  if (tokens.length > 0) result.reason = tokens.join(" ");
  return result;
}

/** Настоящий ответ на сообщение (а не служебная привязка к корню темы форума). */
export function realReply(msg: Message): Message | undefined {
  const reply = msg.reply_to_message;
  if (!reply || reply.forum_topic_created) return undefined;
  if (msg.is_topic_message && reply.message_id === msg.message_thread_id) return undefined;
  return reply;
}

/** Запоминаем username → id, т.к. Bot API не умеет искать пользователя по username. */
// чтобы не писать в хранилище на каждое сообщение, помним, кого уже записали (в пределах этого экземпляра)
const seen = new WeakMap<object, Set<string>>();
export async function rememberUser(chatId: number, user: { id: number; username?: string; first_name: string; last_name?: string }) {
  if (!user.username) return;
  const store = getStore();
  const tag = `${chatId}:${user.id}:${user.username}:${user.first_name}:${user.last_name ?? ""}`;
  let known = seen.get(store);
  if (!known) seen.set(store, (known = new Set()));
  if (known.has(tag)) return;
  if (known.size > 10_000) known.clear();
  known.add(tag);
  await store.set(keys.username(chatId, user.username), user.id, 60 * 86400);
  await store.set(keys.userName(chatId, user.id), displayName(user), 60 * 86400);
}

function textMention(msg: Message): MessageEntity.TextMentionMessageEntity | undefined {
  return msg.entities?.find((e): e is MessageEntity.TextMentionMessageEntity => e.type === "text_mention");
}

export type TargetResult = { target: Target; args: ParsedArgs } | { error: string };

export async function resolveTarget(ctx: Context, withDuration: boolean): Promise<TargetResult> {
  const msg = ctx.msg!;
  const chatId = ctx.chat!.id;
  const argText = typeof ctx.match === "string" ? ctx.match : "";
  const reply = realReply(msg);

  if (reply) {
    const args = parseArgs(argText, { hasReplyTarget: true, withDuration });
    if (reply.sender_chat) return { error: "Нельзя применить к сообщению от имени канала или группы." };
    if (!reply.from) return { error: "Не удалось определить автора сообщения." };
    return { target: { id: reply.from.id, name: displayName(reply.from) }, args };
  }

  const mentioned = textMention(msg);
  if (mentioned) {
    // упоминание без username: в тексте это имя, отрезаем его из аргументов
    const rest = argText.replace(msg.text!.slice(mentioned.offset, mentioned.offset + mentioned.length), "");
    const args = parseArgs(rest, { hasReplyTarget: true, withDuration });
    return { target: { id: mentioned.user.id, name: displayName(mentioned.user) }, args };
  }

  const args = parseArgs(argText, { hasReplyTarget: false, withDuration });
  if (!args.targetToken) {
    return { error: "Ответьте на сообщение нарушителя или укажите @username / ID." };
  }
  const store = getStore();
  let id: number | null;
  if (args.targetToken.startsWith("@")) {
    id = await store.get<number>(keys.username(chatId, args.targetToken.slice(1)));
    if (!id) {
      return {
        error: `Не знаю, кто такой ${args.targetToken}: бот ещё не видел его сообщений. Ответьте на его сообщение или укажите числовой ID.`,
      };
    }
  } else {
    id = Number(args.targetToken);
  }
  const name = (await store.get<string>(keys.userName(chatId, id))) ?? args.targetToken;
  return { target: { id, name }, args };
}
