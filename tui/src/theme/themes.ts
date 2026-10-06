// Theme registry + persistence. Each palette lives in its own theme-<name>.ts;
// this module just aggregates them and stores the selection in
// ~/.bee/queen-theme.json. QUEEN_THEME overrides the file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { defaultTheme } from "./theme-purple";
import { classicTheme } from "./theme-default";
import { gruvboxTheme } from "./theme-gruvbox";
import { nordTheme } from "./theme-nord";
import { catppuccinTheme } from "./theme-catppuccin";
import { tokyoNightTheme } from "./theme-tokyo-night";
import type { Theme } from "./types";

export const themes: Theme[] = [
  classicTheme,
  defaultTheme,
  gruvboxTheme,
  nordTheme,
  catppuccinTheme,
  tokyoNightTheme,
];

export const DEFAULT_THEME_NAME = classicTheme.name;

const CONFIG_DIR = join(homedir(), ".bee");
const THEME_FILE = join(CONFIG_DIR, "queen-theme.json");

export function themeByName(name: string | null | undefined): Theme {
  return themes.find((theme) => theme.name === name) ?? classicTheme;
}

export function loadSavedThemeName(): string {
  const env = process.env.QUEEN_THEME;
  if (env && themes.some((theme) => theme.name === env)) return env;
  try {
    const parsed = JSON.parse(readFileSync(THEME_FILE, "utf8")) as { theme?: string };
    if (parsed.theme && themes.some((theme) => theme.name === parsed.theme)) return parsed.theme;
  } catch {
    // No config yet (or unreadable) — fall through to the default.
  }
  return DEFAULT_THEME_NAME;
}

export function saveThemeName(name: string): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(THEME_FILE, `${JSON.stringify({ theme: name }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Best-effort: a read-only home should not break the app.
  }
}

export function loadInitialTheme(): Theme {
  return themeByName(loadSavedThemeName());
}
