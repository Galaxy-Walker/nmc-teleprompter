const STORAGE_KEY = "teleprompter.settings.v1";

export const DEFAULT_SETTINGS = Object.freeze({
  wpm: 220,
  fontSize: 48,
  lineHeight: 1.6,
  theme: "dark",
  flipX: false,
  flipY: false,
});

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or quota: preferences simply won't persist.
  }
}

export function applySettings(settings) {
  const root = document.documentElement;
  root.style.setProperty("--font-size", `${settings.fontSize}px`);
  root.style.setProperty("--line-height", String(settings.lineHeight));
  root.dataset.theme = settings.theme;
}
