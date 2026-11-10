import { GrammyError, type Context } from "grammy";
import { isAdmin, isSenderAdmin, type AdminRight } from "./admins.js";
import { escapeHtml } from "./format.js";
import { resolveTarget, type ParsedArgs, type Target } from "./target.js";
import { say, safeDelete } from "./reply.js";

const RIGHT_NAMES: Record<AdminRight, string> = {
  restrict: "блокировка пользователей",
  delete: "удаление сообщений",
  changeInfo: "изменение профиля группы",
};

export function describeError(err: unknown): string {
  if (err instanceof GrammyError) {
    const d = err.description.replace(/^Bad Request: /, "");
    if (/not enough rights|CHAT_ADMIN_REQUIRED|have no rights/i.test(d)) {
      return "у бота не хватает прав администратора";
    }
    if (/user is an administrator/i.test(d)) return "это администратор";
    return d;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Проверяет, что команду вызвал админ с нужным правом. Иначе удаляет команду и коротко отвечает. */
export async function requireAdmin(ctx: Context, right?: AdminRight): Promise<boolean> {
  if (await isSenderAdmin(ctx, right)) return true;
  await safeDelete(ctx, ctx.msg?.message_id);
  const extra = right ? ` с правом «${RIGHT_NAMES[right]}»` : "";
  await say(ctx, `Эта команда только для админов${extra}.`, { deleteAfterSec: 10 });
  return false;
}

/** Общая обвязка для команд, применяемых к пользователю. */
export async function withTarget(
  ctx: Context,
  opts: { right: AdminRight; withDuration: boolean; allowAdminTarget?: boolean },
  action: (target: Target, args: ParsedArgs) => Promise<void>,
) {
  if (!(await requireAdmin(ctx, opts.right))) return;
  try {
    const res = await resolveTarget(ctx, opts.withDuration);
    if ("error" in res) {
      await say(ctx, res.error, { deleteAfterSec: 20 });
      return;
    }
    const { target, args } = res;
    if (target.id === ctx.me.id) {
      await say(ctx, "Себя я наказывать не буду 🙂", { deleteAfterSec: 10 });
      return;
    }
    if (!opts.allowAdminTarget && (await isAdmin(ctx, target.id))) {
      await say(ctx, "Нельзя применить к администратору.", { deleteAfterSec: 10 });
      return;
    }
    await action(target, args);
  } catch (err) {
    console.error(err);
    await say(ctx, `Не получилось: ${escapeHtml(describeError(err))}.`, { deleteAfterSec: 20 });
  } finally {
    await safeDelete(ctx, ctx.msg?.message_id);
  }
}
