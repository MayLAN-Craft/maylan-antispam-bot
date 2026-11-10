import { waitUntil } from "@vercel/functions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Выполняет действие с задержкой. На Vercel функция не завершится, пока задача не выполнится
 * (waitUntil), локально — обычный таймер.
 */
export function defer(ms: number, task: () => Promise<unknown>) {
  const promise = sleep(ms)
    .then(task)
    .catch(() => {});
  try {
    waitUntil(promise);
  } catch {
    // не на Vercel
  }
}
