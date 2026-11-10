// Прогон апдейтов через настоящего бота с подменённым Telegram API и хранилищем в памяти.
import { beforeEach, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { Message, Update, User } from "grammy/types";
import { MemoryStore, setStore } from "../src/store.js";

process.env.BOT_TOKEN = "1:test";
const { createBot } = await import("../src/bot.js");

const CHAT = { id: -1001234567890, type: "supergroup" as const, title: "Minecraft", is_forum: true as const };
const ADMIN: User = { id: 1, is_bot: false, first_name: "Admin" };
const PLAYER: User = { id: 2, is_bot: false, first_name: "Steve", username: "steve" };
const MEMES = 10;
const SCREENS = 20;

interface Call {
  method: string;
  payload: Record<string, any>;
}

let bot: Bot;
let calls: Call[];
let updateId = 0;
let messageId = 100;

function setup() {
  setStore(new MemoryStore());
  calls = [];
  bot = createBot();
  bot.botInfo = {
    id: 999,
    is_bot: true,
    first_name: "Mod",
    username: "mod_bot",
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  } as never;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    let result: unknown = true;
    if (method === "getChatAdministrators") {
      result = [{ status: "creator", user: ADMIN, is_anonymous: false }];
    } else if (method === "sendMessage") {
      result = { message_id: ++messageId, date: 0, chat: CHAT, text: "" };
    } else if (method === "getChat") {
      result = { ...CHAT, permissions: { can_send_messages: true } };
    }
    return { ok: true, result } as never;
  });
}

async function send(from: User, extra: Partial<Message>, thread?: number) {
  const msg = {
    message_id: ++messageId,
    date: Math.floor(Date.now() / 1000),
    chat: CHAT,
    from,
    ...(thread ? { is_topic_message: true, message_thread_id: thread } : {}),
    ...extra,
  } as Message;
  await bot.handleUpdate({ update_id: ++updateId, message: msg } as Update);
  return msg;
}

const photo = { photo: [{ file_id: "p", file_unique_id: "p", width: 1, height: 1 }] };
const gif = { animation: { file_id: "g", file_unique_id: "g", width: 1, height: 1, duration: 1 } } as Partial<Message>;
const command = (text: string) => {
  const name = text.split(" ")[0];
  return { text, entities: [{ type: "bot_command" as const, offset: 0, length: name.length }] };
};
const deleted = () => calls.filter((c) => c.method === "deleteMessage").map((c) => c.payload.message_id);
const sentTexts = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

async function configureTopics() {
  await send(ADMIN, command("/setmemes"), MEMES);
  await send(ADMIN, command("/setscreens"), SCREENS);
  calls = [];
}

describe("bot", () => {
  beforeEach(setup);

  it("/setmemes outside a topic explains what to do", async () => {
    await send(ADMIN, command("/setmemes"));
    expect(sentTexts().some((t) => t.includes("внутри темы"))).toBe(true);
  });

  it("non-admins cannot change settings", async () => {
    await send(PLAYER, command("/setmemes"), MEMES);
    expect(sentTexts().some((t) => t.includes("только для админов"))).toBe(true);
  });

  it("memes topic: unlimited media", async () => {
    await configureTopics();
    for (let i = 0; i < 6; i++) await send(PLAYER, i % 2 ? gif : photo, MEMES);
    expect(deleted()).toEqual([]);
  });

  it("general topic: 4th picture is deleted with a hint linking to memes", async () => {
    await configureTopics();
    const sent: Message[] = [];
    for (let i = 0; i < 4; i++) sent.push(await send(PLAYER, photo));
    expect(deleted()).toEqual([sent[3].message_id]);
    const hint = sentTexts().find((t) => t.includes("Мемы"));
    expect(hint).toContain(`https://t.me/c/1234567890/${MEMES}`);
  });

  it("screens topic: gifs deleted, photos allowed up to the higher limit", async () => {
    await configureTopics();
    const g = await send(PLAYER, gif, SCREENS);
    expect(deleted()).toEqual([g.message_id]);
    calls = [];
    for (let i = 0; i < 5; i++) await send(PLAYER, { ...photo, media_group_id: "album1" }, SCREENS);
    expect(deleted()).toEqual([]);
  });

  it("admins are not limited", async () => {
    await configureTopics();
    for (let i = 0; i < 5; i++) await send(ADMIN, photo);
    expect(deleted()).toEqual([]);
  });

  it("/mute by reply restricts the user with until_date", async () => {
    const target = await send(PLAYER, { text: "привет" });
    calls = [];
    await send(ADMIN, { ...command("/mute 10m спам"), reply_to_message: target as never });
    const restrict = calls.find((c) => c.method === "restrictChatMember");
    expect(restrict?.payload.user_id).toBe(PLAYER.id);
    expect(restrict?.payload.permissions.can_send_messages).toBe(false);
    const until = restrict?.payload.until_date - Math.floor(Date.now() / 1000);
    expect(until).toBeGreaterThanOrEqual(599);
    expect(until).toBeLessThanOrEqual(601);
  });

  it("/mute @username works once the bot has seen the user", async () => {
    await send(PLAYER, { text: "привет" });
    calls = [];
    await send(ADMIN, command("/mute @steve 1h"));
    expect(calls.find((c) => c.method === "restrictChatMember")?.payload.user_id).toBe(PLAYER.id);
  });

  it("refuses to punish admins", async () => {
    const target = await send(ADMIN, { text: "я админ" });
    calls = [];
    await send(ADMIN, { ...command("/ban"), reply_to_message: target as never });
    expect(calls.some((c) => c.method === "banChatMember")).toBe(false);
    expect(sentTexts().some((t) => t.includes("администратору"))).toBe(true);
  });

  it("3 warns → mute", async () => {
    const target = await send(PLAYER, { text: "плохое сообщение" });
    for (let i = 0; i < 3; i++) await send(ADMIN, { ...command("/warn"), reply_to_message: target as never });
    expect(calls.filter((c) => c.method === "restrictChatMember")).toHaveLength(1);
    expect(sentTexts().some((t) => t.includes("3/3"))).toBe(true);
  });

  it("/mediaban blocks media everywhere except memes", async () => {
    await configureTopics();
    const target = await send(PLAYER, { text: "hi" });
    await send(ADMIN, { ...command("/mediaban 1h"), reply_to_message: target as never });
    calls = [];
    const p1 = await send(PLAYER, photo, SCREENS);
    await send(PLAYER, photo, MEMES);
    expect(deleted()).toEqual([p1.message_id]);
  });

  it("antiflood mutes after too many messages", async () => {
    for (let i = 0; i < 9; i++) await send(PLAYER, { text: `msg ${i}` });
    const mutes = calls.filter((c) => c.method === "restrictChatMember");
    expect(mutes).toHaveLength(1);
    expect(mutes[0].payload.user_id).toBe(PLAYER.id);
  });

  it("repeated media spam triggers an automatic media ban", async () => {
    await configureTopics();
    // три «серии» спама с перерывами — три страйка; время подменяем, чтобы истекали окна и кулдауны
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    try {
      for (let series = 0; series < 3; series++) {
        for (let i = 0; i < 4; i++) await send(PLAYER, photo);
        offset += 6 * 60 * 1000; // через 6 минут окно лимита и кулдауны истекли
      }
    } finally {
      Date.now = realNow;
    }
    expect(sentTexts().some((t) => t.includes("ограничение на медиа"))).toBe(true);
  });
});
