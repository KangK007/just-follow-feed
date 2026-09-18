"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const UI_PREFERENCES_STORAGE_KEY = "just-follow-feed:ui-preferences";

export type UiTheme = "system" | "light" | "dark";
export type VideoView = "grid" | "list";

export type UiPreferences = {
  version: 1;
  theme: UiTheme;
  videoView: VideoView;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  theme: "system",
  videoView: "grid",
};

type UiPreferencesContextValue = {
  preferences: UiPreferences;
  setTheme: (theme: UiTheme) => void;
  setVideoView: (videoView: VideoView) => void;
  hydrated: boolean;
};

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTheme(value: unknown): value is UiTheme {
  return value === "system" || value === "light" || value === "dark";
}

function isVideoView(value: unknown): value is VideoView {
  return value === "grid" || value === "list";
}

function normalizePreferences(value: unknown): UiPreferences {
  if (!isRecord(value) || value.version !== 1) {
    return DEFAULT_UI_PREFERENCES;
  }

  return {
    version: 1,
    theme: isTheme(value.theme) ? value.theme : DEFAULT_UI_PREFERENCES.theme,
    videoView: isVideoView(value.videoView) ? value.videoView : DEFAULT_UI_PREFERENCES.videoView,
  };
}

function readStoredPreferences(): UiPreferences {
  try {
    const stored = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    return stored ? normalizePreferences(JSON.parse(stored)) : DEFAULT_UI_PREFERENCES;
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

function writeStoredPreferences(preferences: UiPreferences): void {
  try {
    window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in private browsing or when quota is exhausted.
  }
}

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const storedPreferences = readStoredPreferences();
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setPreferences(storedPreferences);
      setHydrated(true);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (hydrated) writeStoredPreferences(preferences);
  }, [hydrated, preferences]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);

  const setTheme = useCallback((theme: UiTheme) => {
    setPreferences((current) => ({ ...current, theme }));
  }, []);

  const setVideoView = useCallback((videoView: VideoView) => {
    setPreferences((current) => ({ ...current, videoView }));
  }, []);

  const value = useMemo(
    () => ({ preferences, setTheme, setVideoView, hydrated }),
    [hydrated, preferences, setTheme, setVideoView],
  );

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
}

export function useUiPreferences(): UiPreferencesContextValue {
  const context = useContext(UiPreferencesContext);
  if (!context) throw new Error("useUiPreferences 必须在 UiPreferencesProvider 内使用");
  return context;
}
