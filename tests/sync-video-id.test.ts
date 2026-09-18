import { describe, expect, it } from "vitest";

import { createVideoId } from "@/lib/sync-video-id";

describe("createVideoId", () => {
  it("returns the same stable id for the same canonical URL", () => {
    const url = "https://www.bilibili.com/video/BV1abcdefghi";

    expect(createVideoId("bilibili", url)).toBe(createVideoId("bilibili", url));
  });

  it("does not collide when similar URLs only differ near the end", () => {
    const first = "https://www.bilibili.com/video/BV1abcdefghi?p=10001";
    const second = "https://www.bilibili.com/video/BV1abcdefghi?p=10002";

    expect(createVideoId("bilibili", first)).not.toBe(createVideoId("bilibili", second));
  });
});
