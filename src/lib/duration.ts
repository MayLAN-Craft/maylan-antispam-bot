const UNITS: Record<string, number> = {
  s: 1, с: 1,
  m: 60, м: 60,
  h: 3600, ч: 3600,
  d: 86400, д: 86400,
  w: 604800, н: 604800,
};

/** Telegram считает ограничения короче 30 секунд или длиннее 366 дней бессрочными. */
export const MIN_DURATION = 30;
export const MAX_DURATION = 366 * 86400;

/**
 * Разбирает длительность: `30s`, `10m`, `2h`, `1d`, `1w`, `1h30m`, по-русски `10м`, `2ч`, `1д`.
 * Число без единицы считается минутами. Возвращает секунды или null, если это не длительность.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) * 60;
  if (!/^(\d+[smhdwсмчдн])+$/u.test(text)) return null;
  let total = 0;
  for (const [, num, unit] of text.matchAll(/(\d+)([smhdwсмчдн])/gu)) {
    total += Number(num) * UNITS[unit];
  }
  return total > 0 ? total : null;
}

/** «1 д 2 ч», «10 мин», «навсегда». */
export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds > MAX_DURATION) return "навсегда";
  const parts: string[] = [];
  let rest = Math.round(seconds);
  const steps: [number, string][] = [
    [604800, "нед"],
    [86400, "д"],
    [3600, "ч"],
    [60, "мин"],
    [1, "сек"],
  ];
  for (const [size, label] of steps) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${label}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

/** until_date для Telegram API. undefined — навсегда. */
export function untilDate(seconds: number | undefined, now = Date.now()): number | undefined {
  if (!seconds || seconds > MAX_DURATION) return undefined;
  return Math.floor(now / 1000) + Math.max(MIN_DURATION, seconds);
}
