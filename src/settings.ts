import { getStore, keys } from "./store.js";

export interface Limit {
  /** Сколько штук разрешено */
  count: number;
  /** За сколько секунд */
  window: number;
}

export interface Settings {
  /** ID темы «мемы» (message_thread_id) */
  memesThread?: number;
  /** ID темы «скриншоты и клипы» */
  screensThread?: number;
  /** Лимит медиа в обычных темах */
  mediaLimit: Limit;
  /** Лимит фото/видео в теме скриншотов */
  screensLimit: Limit;
  /** Повторные нарушения медиа-лимита → медиа-бан */
  strikes: Limit & { banDuration: number };
  flood: Limit & { enabled: boolean; muteDuration: number };
  warns: { limit: number; action: "mute" | "ban"; duration: number };
  logChatId?: number;
  rules?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  mediaLimit: { count: 3, window: 5 * 60 },
  screensLimit: { count: 20, window: 5 * 60 },
  strikes: { count: 3, window: 60 * 60, banDuration: 60 * 60 },
  flood: { enabled: true, count: 7, window: 10, muteDuration: 10 * 60 },
  warns: { limit: 3, action: "mute", duration: 24 * 60 * 60 },
};

function merge(saved: Partial<Settings> | null): Settings {
  const d = structuredClone(DEFAULT_SETTINGS);
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    mediaLimit: { ...d.mediaLimit, ...saved.mediaLimit },
    screensLimit: { ...d.screensLimit, ...saved.screensLimit },
    strikes: { ...d.strikes, ...saved.strikes },
    flood: { ...d.flood, ...saved.flood },
    warns: { ...d.warns, ...saved.warns },
  };
}

export async function getSettings(chatId: number): Promise<Settings> {
  return merge(await getStore().get<Partial<Settings>>(keys.settings(chatId)));
}

export async function updateSettings(chatId: number, patch: (s: Settings) => void): Promise<Settings> {
  const s = await getSettings(chatId);
  patch(s);
  await getStore().set(keys.settings(chatId), s);
  return s;
}
