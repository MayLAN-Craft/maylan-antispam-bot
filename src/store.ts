import { Redis } from "@upstash/redis";
import { config } from "./config.js";

/** Минимальное key-value хранилище, которого хватает боту. */
export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  /** Записывает ключ, только если его нет. Возвращает true, если записал. */
  setNX(key: string, value: unknown, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Добавляет событие в скользящее окно и возвращает число событий в нём (включая это). */
  hit(key: string, windowSec: number, now?: number): Promise<number>;
}

export class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async get<T>(key: string) {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async set(key: string, value: unknown, ttlSec?: number) {
    if (ttlSec) await this.redis.set(key, value, { ex: Math.max(1, Math.ceil(ttlSec)) });
    else await this.redis.set(key, value);
  }

  async setNX(key: string, value: unknown, ttlSec: number) {
    const res = await this.redis.set(key, value, { nx: true, ex: Math.max(1, Math.ceil(ttlSec)) });
    return res === "OK";
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async hit(key: string, windowSec: number, now = Date.now()) {
    const windowMs = windowSec * 1000;
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    const p = this.redis.pipeline();
    p.zremrangebyscore(key, 0, now - windowMs);
    p.zadd(key, { score: now, member });
    p.zcard(key);
    p.pexpire(key, windowMs);
    const res = await p.exec();
    return Number(res[2]);
  }
}

export class MemoryStore implements Store {
  private data = new Map<string, { value: unknown; expires?: number }>();
  private windows = new Map<string, number[]>();

  constructor(private clock: () => number = () => Date.now()) {}

  private alive(key: string) {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expires !== undefined && entry.expires <= this.clock()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async get<T>(key: string) {
    const entry = this.alive(key);
    return entry ? (structuredClone(entry.value) as T) : null;
  }

  async set(key: string, value: unknown, ttlSec?: number) {
    this.data.set(key, {
      value: structuredClone(value),
      expires: ttlSec ? this.clock() + ttlSec * 1000 : undefined,
    });
  }

  async setNX(key: string, value: unknown, ttlSec: number) {
    if (this.alive(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }

  async del(key: string) {
    this.data.delete(key);
    this.windows.delete(key);
  }

  async hit(key: string, windowSec: number, now = this.clock()) {
    const from = now - windowSec * 1000;
    const list = (this.windows.get(key) ?? []).filter((t) => t > from);
    list.push(now);
    this.windows.set(key, list);
    return list.length;
  }
}

let instance: Store | undefined;

export function getStore(): Store {
  if (instance) return instance;
  const redis = config.redis;
  if (redis) {
    instance = new RedisStore(new Redis({ url: redis.url, token: redis.token }));
  } else {
    console.warn("Upstash Redis не настроен — используется хранилище в памяти (данные не сохранятся).");
    instance = new MemoryStore();
  }
  return instance;
}

/** Для тестов. */
export function setStore(store: Store) {
  instance = store;
}

/** Все ключи бота в одном месте. */
export const keys = {
  settings: (chat: number) => `s:${chat}`,
  admins: (chat: number) => `adm:${chat}`,
  username: (chat: number, username: string) => `u:${chat}:${username.toLowerCase()}`,
  userName: (chat: number, user: number) => `un:${chat}:${user}`,
  warns: (chat: number, user: number) => `w:${chat}:${user}`,
  mediaBan: (chat: number, user: number) => `mb:${chat}:${user}`,
  mediaWindow: (chat: number, user: number, zone: string) => `mw:${chat}:${user}:${zone}`,
  strikes: (chat: number, user: number) => `st:${chat}:${user}`,
  strikeCooldown: (chat: number, user: number) => `stc:${chat}:${user}`,
  hintCooldown: (chat: number, user: number) => `hc:${chat}:${user}`,
  flood: (chat: number, user: number) => `f:${chat}:${user}`,
  floodPunished: (chat: number, user: number) => `fp:${chat}:${user}`,
  mediaGroup: (chat: number, group: string, what: string) => `mg:${chat}:${group}:${what}`,
  roBackup: (chat: number) => `ro:${chat}`,
};
