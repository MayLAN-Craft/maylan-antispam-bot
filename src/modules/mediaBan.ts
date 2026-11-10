import { getStore, keys } from "../store.js";
import { MAX_DURATION } from "../lib/duration.js";

/** Медиа-бан хранится как ключ со сроком жизни; значение — время окончания (0 — бессрочно). */
export async function setMediaBan(chatId: number, userId: number, seconds?: number) {
  const forever = !seconds || seconds > MAX_DURATION;
  const until = forever ? 0 : Date.now() + seconds * 1000;
  await getStore().set(keys.mediaBan(chatId, userId), until, forever ? undefined : seconds);
}

export async function clearMediaBan(chatId: number, userId: number) {
  await getStore().del(keys.mediaBan(chatId, userId));
}

/** Возвращает время окончания бана (0 — бессрочно) или null, если бана нет. */
export async function getMediaBan(chatId: number, userId: number): Promise<number | null> {
  return getStore().get<number>(keys.mediaBan(chatId, userId));
}
