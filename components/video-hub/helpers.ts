import { parsePublishedAt } from "@/lib/feed-logic";
import { isPlatformProfileUrl, MAX_FEED_CREATORS } from "@/lib/feed-storage";
import type { Platform } from "@/lib/feed-types";

export type CreatorDraft = {
  platform: Platform;
  profileUrl: string;
  name: string;
  nameSource: "manual" | "fallback";
};

export const MAX_CREATOR_IMPORT_LINES = MAX_FEED_CREATORS;

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const COUNT_FORMATTER = new Intl.NumberFormat("zh-CN");

export function platformLabel(platform: Platform) {
  return platform === "douyin" ? "抖音" : "哔站";
}

export function platformClass(platform: Platform) {
  return platform === "douyin" ? "platform-douyin" : "platform-bilibili";
}

export function detectPlatform(value: string): Platform | null {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    if (["douyin.com", "iesdouyin.com"].some((item) => host === item || host.endsWith(`.${item}`))) return "douyin";
    if (["bilibili.com", "b23.tv"].some((item) => host === item || host.endsWith(`.${item}`))) return "bilibili";
    return null;
  } catch {
    return null;
  }
}

export function normalizeUrl(value: string) {
  const cleaned = value.trim().replace(/^["'<>\s]+|["'<>，,；;。\s]+$/g, "");
  try {
    return new URL(cleaned).toString();
  } catch {
    return cleaned;
  }
}

export function formatDate(value?: string) {
  const date = parsePublishedAt(value);
  return !date ? "发布时间未知" : SHORT_DATE_FORMATTER.format(date);
}

export function formatLongDate(value?: string) {
  const date = parsePublishedAt(value);
  return !date ? "暂无记录" : LONG_DATE_FORMATTER.format(date);
}

export function formatDateTime(value?: string) {
  const date = parsePublishedAt(value);
  return !date ? "待同步" : DATE_TIME_FORMATTER.format(date);
}

export function formatCount(value: number) {
  return COUNT_FORMATTER.format(value);
}

export function parseCreatorLines(value: string) {
  const entries: CreatorDraft[] = [];
  const invalidLines: number[] = [];
  const duplicateLines: number[] = [];
  const seen = new Set<string>();
  const lines = value.split(/\r?\n/);
  const limitExceeded = lines.length > MAX_CREATOR_IMPORT_LINES;

  lines.slice(0, MAX_CREATOR_IMPORT_LINES).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (/^(url|link|链接|主页|名称|昵称)(\s*[,，\t;；]|$)/i.test(line)) return;

    const match = line.match(/https?:\/\/[^\s，,；;\t]+/i);
    if (!match || match.index === undefined) {
      invalidLines.push(lineNumber);
      return;
    }
    const profileUrl = normalizeUrl(match[0]);
    const platform = detectPlatform(profileUrl);
    if (!platform || !isPlatformProfileUrl(profileUrl, platform)) {
      invalidLines.push(lineNumber);
      return;
    }

    const before = line.slice(0, match.index).replace(/["'\s|｜:：]+/g, " ").trim();
    const after = line.slice(match.index + match[0].length).replace(/["'\s|｜:：]+/g, " ").trim();
    const name = (before || after).replace(/^[,，;；\t]+|[,，;；\t]+$/g, "").trim().slice(0, 80);
    const key = profileUrl.toLowerCase();
    if (seen.has(key)) {
      duplicateLines.push(lineNumber);
      return;
    }
    seen.add(key);
    entries.push({
      platform,
      profileUrl,
      name: name || `${platformLabel(platform)}博主`,
      nameSource: name ? "manual" : "fallback",
    });
  });

  return { entries, invalidLines, duplicateLines, limitExceeded };
}
