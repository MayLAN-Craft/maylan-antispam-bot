import type { Api, Context } from "grammy";
import type { ChatMember } from "grammy/types";
import { getStore, keys } from "../store.js";

export interface AdminInfo {
  id: number;
  name: string;
  isBot: boolean;
  isAnonymous: boolean;
  isCreator: boolean;
  canRestrict: boolean;
  canDelete: boolean;
  canChangeInfo: boolean;
}

export type AdminRight = "restrict" | "delete" | "changeInfo";

const CACHE_TTL = 5 * 60;

function toInfo(m: ChatMember): AdminInfo | null {
  if (m.status === "creator") {
    return {
      id: m.user.id,
      name: m.user.first_name,
      isBot: m.user.is_bot,
      isAnonymous: m.is_anonymous,
      isCreator: true,
      canRestrict: true,
      canDelete: true,
      canChangeInfo: true,
    };
  }
  if (m.status === "administrator") {
    return {
      id: m.user.id,
      name: m.user.first_name,
      isBot: m.user.is_bot,
      isAnonymous: m.is_anonymous,
      isCreator: false,
      canRestrict: m.can_restrict_members,
      canDelete: m.can_delete_messages,
      canChangeInfo: m.can_change_info,
    };
  }
  return null;
}

export async function getAdmins(api: Api, chatId: number): Promise<AdminInfo[]> {
  const store = getStore();
  const cached = await store.get<AdminInfo[]>(keys.admins(chatId));
  if (cached) return cached;
  const members = await api.getChatAdministrators(chatId);
  const admins = members.map(toInfo).filter((a): a is AdminInfo => a !== null);
  await store.set(keys.admins(chatId), admins, CACHE_TTL);
  return admins;
}

export async function invalidateAdmins(chatId: number) {
  await getStore().del(keys.admins(chatId));
}

export function hasRight(admin: AdminInfo, right?: AdminRight): boolean {
  if (!right || admin.isCreator) return true;
  if (right === "restrict") return admin.canRestrict;
  if (right === "delete") return admin.canDelete;
  return admin.canChangeInfo;
}

/** Сообщение отправлено анонимным админом от имени группы. */
export function isAnonymousAdminMessage(ctx: Context): boolean {
  const sc = ctx.msg?.sender_chat;
  return !!sc && sc.id === ctx.chat?.id;
}

export async function isAdmin(ctx: Context, userId: number, right?: AdminRight): Promise<boolean> {
  if (!ctx.chat) return false;
  const admins = await getAdmins(ctx.api, ctx.chat.id);
  const admin = admins.find((a) => a.id === userId);
  return !!admin && hasRight(admin, right);
}

/** Является ли автор текущего сообщения/колбэка админом (с нужным правом). */
export async function isSenderAdmin(ctx: Context, right?: AdminRight): Promise<boolean> {
  // анонимный админ: права проверить нельзя, Telegram уже подтвердил, что это админ
  if (isAnonymousAdminMessage(ctx)) return true;
  if (!ctx.from) return false;
  return isAdmin(ctx, ctx.from.id, right);
}
