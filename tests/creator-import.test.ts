import { describe, expect, it } from "vitest";

import {
  MAX_CREATOR_IMPORT_LINES,
  parseCreatorLines,
} from "@/components/video-hub/helpers";

describe("parseCreatorLines", () => {
  it("支持链接前后的博主昵称", () => {
    const parsed = parseCreatorLines([
      "摄影博主 https://www.douyin.com/user/MS4wLjABAAAAexample",
      "https://space.bilibili.com/123456\t科普作者",
    ].join("\n"));

    expect(parsed.entries).toEqual([
      {
        platform: "douyin",
        profileUrl: "https://www.douyin.com/user/MS4wLjABAAAAexample",
        name: "摄影博主",
        nameSource: "manual",
      },
      {
        platform: "bilibili",
        profileUrl: "https://space.bilibili.com/123456",
        name: "科普作者",
        nameSource: "manual",
      },
    ]);
    expect(parsed.invalidLines).toEqual([]);
  });

  it("记录同一主页的重复行", () => {
    const parsed = parseCreatorLines([
      "https://space.bilibili.com/123456",
      "https://space.bilibili.com/123456",
    ].join("\n"));

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.duplicateLines).toEqual([2]);
  });

  it("报告无法识别的行", () => {
    const parsed = parseCreatorLines("not-a-profile\nhttps://example.com/user/1");

    expect(parsed.entries).toEqual([]);
    expect(parsed.invalidLines).toEqual([1, 2]);
  });

  it("不把同平台视频链接当作博主主页", () => {
    const parsed = parseCreatorLines([
      "https://www.bilibili.com/video/BV1abcdefghi",
      "https://www.douyin.com/video/1234567890123456789",
    ].join("\n"));

    expect(parsed.entries).toEqual([]);
    expect(parsed.invalidLines).toEqual([1, 2]);
  });

  it("超过单次行数上限时停止继续解析", () => {
    const lines = Array.from(
      { length: MAX_CREATOR_IMPORT_LINES + 1 },
      (_, index) => `https://space.bilibili.com/${index + 1}`,
    );
    const parsed = parseCreatorLines(lines.join("\n"));

    expect(parsed.entries).toHaveLength(MAX_CREATOR_IMPORT_LINES);
    expect(parsed.limitExceeded).toBe(true);
  });
});
