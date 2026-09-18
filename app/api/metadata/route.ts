import { NextResponse } from "next/server";
import { LocalApiRequestError, readLocalJsonRequest } from "@/lib/local-api-request";

export const runtime = "nodejs";

const ALLOWED_HOSTS = [
  "douyin.com",
  "iesdouyin.com",
  "bilibili.com",
  "b23.tv",
];
const MAX_REDIRECTS = 2;
const MAX_HTML_BYTES = 1_500_000;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;

function isAllowedHost(hostname: string) {
  return ALLOWED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

function isSafeTarget(value: string | URL) {
  const url = typeof value === "string" ? new URL(value) : value;
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    !url.port &&
    isAllowedHost(url.hostname)
  );
}

function isDirectVideoTarget(url: URL) {
  if (url.hostname === "b23.tv" || url.hostname.endsWith(".b23.tv")) return false;
  if (url.hostname === "v.douyin.com") return false;
  if (url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com")) {
    return /^\/video\/BV[0-9A-Za-z]{8,20}(?:\/|$)/i.test(url.pathname);
  }
  return /^\/video\/\d{10,}(?:\/|$)/.test(url.pathname);
}

function isSupportedInputTarget(url: URL) {
  if (isDirectVideoTarget(url)) return true;
  const isShortHost = url.hostname === "b23.tv"
    || url.hostname.endsWith(".b23.tv")
    || url.hostname === "v.douyin.com";
  return isShortHost && /^\/[0-9A-Za-z_-]+\/?$/.test(url.pathname);
}

function readMeta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyPattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const reversePattern = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    "i",
  );
  return propertyPattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1] ?? "";
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function readLimitedText(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    throw new Error("页面响应过大");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw new Error("页面响应过大");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    const parsed = await readLocalJsonRequest(request, MAX_REQUEST_BODY_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LocalApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  if (typeof body.url !== "string" || body.url.length > 2048) {
    return NextResponse.json({ error: "请提供有效的视频链接" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(body.url.trim());
  } catch {
    return NextResponse.json({ error: "链接格式不正确" }, { status: 400 });
  }

  if (!isSafeTarget(target) || !isSupportedInputTarget(target)) {
    return NextResponse.json(
      { error: "目前只支持抖音和哔哩哔哩的视频详情链接" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      response = await fetch(target.toString(), {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "JustFollowFeed/0.1 (public metadata only)",
        },
        signal: controller.signal,
        cache: "no-store",
        redirect: "manual",
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("页面跳转次数过多");
      }
      target = new URL(location, target);
      if (!isSafeTarget(target)) throw new Error("页面跳转到了不支持的地址");
    }

    if (!response?.ok) {
      return NextResponse.json(
        { error: `页面暂时无法读取（${response?.status ?? 502}）` },
        { status: 502 },
      );
    }

    if (!isDirectVideoTarget(target)) {
      return NextResponse.json(
        { error: "短链接没有跳转到可识别的视频详情页" },
        { status: 422 },
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return NextResponse.json({ error: "页面不是可读取的公开网页" }, { status: 422 });
    }

    const html = await readLimitedText(response);
    const title = decodeEntities(
      readMeta(html, "og:title") || readMeta(html, "twitter:title") ||
        (/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? ""),
    ).trim();
    const coverUrl = decodeEntities(
      readMeta(html, "og:image") || readMeta(html, "twitter:image"),
    ).trim();
    const description = decodeEntities(readMeta(html, "og:description")).trim();

    if (!title && !coverUrl) {
      return NextResponse.json(
        { error: "页面没有公开的标题或封面信息，请手动填写" },
        { status: 422 },
      );
    }

    return NextResponse.json({ title, coverUrl, description, url: target.toString() });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "读取超时，请手动填写视频信息"
      : error instanceof Error && error.message === "页面响应过大"
        ? "页面响应过大，请手动填写视频信息"
        : error instanceof Error && error.message.includes("跳转")
          ? error.message
          : "页面暂时无法读取，请手动填写视频信息";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
