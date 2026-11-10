import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration, untilDate } from "../src/lib/duration.js";
import { parseArgs } from "../src/lib/target.js";
import { MemoryStore } from "../src/store.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { mediaKindOf, overLimit, precheck, topicTypeOf } from "../src/modules/mediaRules.js";
import type { Message } from "grammy/types";

describe("parseDuration", () => {
  it.each([
    ["30s", 30],
    ["10m", 600],
    ["2h", 7200],
    ["1d", 86400],
    ["1w", 604800],
    ["1h30m", 5400],
    ["10м", 600],
    ["2ч", 7200],
    ["1д", 86400],
    ["15", 900],
  ])("%s → %i", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(["", "abc", "10x", "m10", "причина"])("%s → null", (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe("formatDuration / untilDate", () => {
  it("formats", () => {
    expect(formatDuration(600)).toBe("10 мин");
    expect(formatDuration(5400)).toBe("1 ч 30 мин");
    expect(formatDuration(90000)).toBe("1 д 1 ч");
    expect(formatDuration(undefined)).toBe("навсегда");
  });

  it("clamps short durations to 30s and treats huge ones as forever", () => {
    expect(untilDate(10, 1_000_000)).toBe(1000 + 30);
    expect(untilDate(600, 1_000_000)).toBe(1000 + 600);
    expect(untilDate(400 * 86400)).toBeUndefined();
    expect(untilDate(undefined)).toBeUndefined();
  });
});

describe("parseArgs", () => {
  it("reply target: duration and reason", () => {
    expect(parseArgs("10m спам", { hasReplyTarget: true, withDuration: true })).toEqual({
      duration: 600,
      reason: "спам",
    });
  });

  it("reply target: reason only", () => {
    expect(parseArgs("просто так", { hasReplyTarget: true, withDuration: true })).toEqual({ reason: "просто так" });
  });

  it("explicit @username target", () => {
    expect(parseArgs("@steve 1h гриферство", { hasReplyTarget: false, withDuration: true })).toEqual({
      targetToken: "@steve",
      duration: 3600,
      reason: "гриферство",
    });
  });

  it("explicit numeric target, no duration parsing for /warn", () => {
    expect(parseArgs("123456789 10m", { hasReplyTarget: false, withDuration: false })).toEqual({
      targetToken: "123456789",
      reason: "10m",
    });
  });
});

describe("MemoryStore", () => {
  it("sliding window counts only recent hits", async () => {
    let now = 0;
    const store = new MemoryStore(() => now);
    expect(await store.hit("k", 10)).toBe(1);
    now = 5000;
    expect(await store.hit("k", 10)).toBe(2);
    now = 12000; // первое событие (t=0) вышло из окна
    expect(await store.hit("k", 10)).toBe(2);
  });

  it("setNX respects TTL", async () => {
    let now = 0;
    const store = new MemoryStore(() => now);
    expect(await store.setNX("k", 1, 60)).toBe(true);
    expect(await store.setNX("k", 1, 60)).toBe(false);
    now = 61_000;
    expect(await store.setNX("k", 1, 60)).toBe(true);
  });
});

describe("media rules", () => {
  const settings = { ...DEFAULT_SETTINGS, memesThread: 10, screensThread: 20 };
  const msg = (m: Partial<Message>) => m as Message;

  it("classifies media kinds", () => {
    expect(mediaKindOf(msg({ photo: [] }))).toBe("screen");
    expect(mediaKindOf(msg({ video: {} as never }))).toBe("screen");
    expect(mediaKindOf(msg({ animation: {} as never }))).toBe("meme");
    expect(mediaKindOf(msg({ sticker: {} as never }))).toBe("meme");
    expect(mediaKindOf(msg({ document: { mime_type: "image/png" } as never }))).toBe("screen");
    expect(mediaKindOf(msg({ document: { mime_type: "image/gif" } as never }))).toBe("meme");
    expect(mediaKindOf(msg({ text: "hi" }))).toBeNull();
  });

  it("classifies topics", () => {
    expect(topicTypeOf(10, settings)).toBe("memes");
    expect(topicTypeOf(20, settings)).toBe("screens");
    expect(topicTypeOf(undefined, settings)).toBe("other");
    expect(topicTypeOf(30, settings)).toBe("other");
  });

  const base = { isAdmin: false, mediaBanned: false, settings };

  it("memes topic allows everything, even for media-banned users", () => {
    expect(precheck({ ...base, topic: "memes", kind: "meme", mediaBanned: true })).toEqual({ action: "allow" });
  });

  it("admins are never limited", () => {
    expect(precheck({ ...base, topic: "other", kind: "meme", isAdmin: true })).toEqual({ action: "allow" });
  });

  it("media-banned users lose media outside memes", () => {
    expect(precheck({ ...base, topic: "screens", kind: "screen", mediaBanned: true })).toEqual({
      action: "delete",
      reason: "banned",
    });
  });

  it("screens topic: no gifs/stickers, photos counted against screens limit", () => {
    expect(precheck({ ...base, topic: "screens", kind: "meme" })).toEqual({ action: "delete", reason: "wrong_kind" });
    expect(precheck({ ...base, topic: "screens", kind: "screen" })).toEqual({
      action: "count",
      zone: "screens",
      limit: settings.screensLimit,
    });
  });

  it("other topics: everything counted against the general limit", () => {
    for (const kind of ["meme", "screen"] as const) {
      expect(precheck({ ...base, topic: "other", kind })).toEqual({
        action: "count",
        zone: "other",
        limit: settings.mediaLimit,
      });
    }
  });

  it("overLimit", () => {
    expect(overLimit(3, { count: 3, window: 60 })).toBe(false);
    expect(overLimit(4, { count: 3, window: 60 })).toBe(true);
  });
});
