import { createHash } from "node:crypto";

import type { Platform } from "@/lib/feed-types";

export function createVideoId(platform: Platform, canonicalVideoUrl: string) {
  const digest = createHash("sha256").update(canonicalVideoUrl).digest("base64url");
  return `sync-${platform}-${digest}`;
}
