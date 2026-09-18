import type { Metadata } from "next";
import "./globals.css";
import { FeedProvider } from "@/lib/feed-context";
import { NoticeProvider } from "@/lib/notice-context";
import { UiPreferencesProvider } from "@/lib/ui-preferences";

export const metadata: Metadata = {
  title: "只看关注",
  description: "把真正想看的视频，收进一条干净的关注流。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const raw = localStorage.getItem("just-follow-feed:ui-preferences"); const value = raw ? JSON.parse(raw) : null; const theme = value && value.version === 1 && (value.theme === "light" || value.theme === "dark") ? value.theme : "system"; document.documentElement.dataset.theme = theme; } catch { document.documentElement.dataset.theme = "system"; } })();`,
          }}
        />
      </head>
      <body>
        <UiPreferencesProvider>
          <NoticeProvider>
            <FeedProvider>{children}</FeedProvider>
          </NoticeProvider>
        </UiPreferencesProvider>
      </body>
    </html>
  );
}
