import { describe, expect, it, vi } from "vitest";

import { migrateFeedState, readFeedState, recoverFeedState } from "@/lib/feed-storage";

const creator = {
  id: "creator-1",
  platform: "bilibili" as const,
  profileUrl: "https://space.bilibili.com/123456",
  name: "哔站博主",
  enabled: true,
};

function video(id: string, bvid: string) {
  return {
    id,
    platform: "bilibili" as const,
    videoUrl: `https://www.bilibili.com/video/${bvid}`,
    creatorId: creator.id,
    title: bvid,
    source: "feed-sync" as const,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("feed storage migration", () => {
  it("migrates a v1 fallback creator to v2 without changing its meaning", () => {
    const migrated = migrateFeedState({ version: 1, creators: [creator], videos: [] });

    expect(migrated).toEqual({
      version: 2,
      creators: [{ ...creator, nameSource: "fallback" }],
      videos: [],
    });
  });

  it("repairs old duplicate feed-sync ids using the platform video ids", () => {
    const recovered = recoverFeedState({
      version: 2,
      creators: [{ ...creator, nameSource: "fallback" }],
      videos: [
        video("legacy-collision", "BV1abcdefghi"),
        video("legacy-collision", "BV1klmnopqrs"),
      ],
    });

    expect(recovered?.state.videos.map((item) => item.id)).toEqual([
      "sync-bilibili-BV1abcdefghi",
      "sync-bilibili-BV1klmnopqrs",
    ]);
    expect(recovered?.repaired).toBe(2);
  });

  it("rejects a backup containing an orphan video instead of silently dropping it", () => {
    const state = {
      version: 2,
      creators: [{ ...creator, nameSource: "fallback" }],
      videos: [{ ...video("video-1", "BV1abcdefghi"), creatorId: "missing" }],
    };

    expect(migrateFeedState(state)).toBeNull();
    expect(recoverFeedState(state)?.state.videos).toEqual([]);
  });

  it("rejects a creator profile hosted on the wrong platform", () => {
    expect(migrateFeedState({
      version: 2,
      creators: [{ ...creator, profileUrl: "https://www.douyin.com/user/example" }],
      videos: [],
    })).toBeNull();
  });

  it("rejects a same-platform video URL when a creator profile is required", () => {
    expect(migrateFeedState({
      version: 2,
      creators: [{ ...creator, profileUrl: "https://www.bilibili.com/video/BV1abcdefghi" }],
      videos: [],
    })).toBeNull();
  });

  it("validates in-memory state without serializing the whole database to a Blob", () => {
    const originalBlob = globalThis.Blob;
    Object.defineProperty(globalThis, "Blob", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("Blob serialization should not run");
        }
      },
    });
    try {
      expect(migrateFeedState({
        version: 2,
        creators: [{ ...creator, nameSource: "fallback" }],
        videos: [],
      })?.creators).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, "Blob", { configurable: true, value: originalBlob });
    }
  });

  it("marks a valid v1 IndexedDB record for one-time v2 rewrite", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const record = { version: 1, creators: [creator], videos: [], revision: 4 };
    const database = {
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const request: {
              result?: unknown;
              onsuccess: ((event: Event) => void) | null;
            } = { result: record, onsuccess: null };
            queueMicrotask(() => request.onsuccess?.({} as Event));
            return request;
          },
        }),
      }),
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const indexedDb = {
      open: () => {
        const request: {
          result: IDBDatabase;
          onsuccess: ((event: Event) => void) | null;
          onerror: ((event: Event) => void) | null;
          onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null;
        } = { result: database, onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(() => request.onsuccess?.({} as Event));
        return request;
      },
    } as unknown as IDBFactory;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb });
    try {
      await expect(readFeedState()).resolves.toMatchObject({ revision: 4, needsRewrite: true });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });
});
