import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let POST: typeof import("@/app/api/metadata/route").POST;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/metadata/route"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function metadataRequest(url: string) {
  return new Request("http://127.0.0.1:3000/api/metadata", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
}

function htmlResponse(html: string) {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("metadata route", () => {
  it("rejects a platform homepage before making an outbound request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(metadataRequest("https://www.bilibili.com/"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("视频详情链接") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the canonical detail URL after resolving a supported short link", async () => {
    const canonicalUrl = "https://www.bilibili.com/video/BV1abcDEF12";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: canonicalUrl },
      }))
      .mockResolvedValueOnce(htmlResponse('<meta property="og:title" content="测试视频"><meta property="og:image" content="https://i.example/cover.jpg">'));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(metadataRequest("https://b23.tv/Abc_123"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      title: "测试视频",
      coverUrl: "https://i.example/cover.jpg",
      url: canonicalUrl,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a short link that does not resolve to a video detail page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(htmlResponse("<title>短链接页面</title>")));

    const response = await POST(metadataRequest("https://b23.tv/Abc_123"));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("没有跳转") });
  });
});
