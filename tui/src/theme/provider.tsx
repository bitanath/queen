/* @jsxImportSource @opentui/react */
// Terminal theme provider (ported from termcn `opentui/theme-provider`).
import { useEffect, useMemo, useState } from "react";
import { defaultTheme } from "./theme-purple";
import { ThemeContext } from "./use-theme";
import type {
  AutoThemeProviderProps,
  Theme,
  ThemeProviderProps,
} from "./types";

export type {
  AutoThemeProviderProps,
  BorderStyle,
  BorderTokens,
  ColorTokens,
  SpacingTokens,
  Theme,
  ThemeProviderProps,
  TypographyTokens,
} from "./types";

const getEnv = (name: string): string | undefined =>
  typeof process !== "undefined" && process.env ? process.env[name] : undefined;

export const detectColorScheme = (): "dark" | "light" => {
  const colorFgBg = getEnv("COLORFGBG");
  if (colorFgBg) {
    const parts = colorFgBg.split(";");
    const background = Number.parseInt(parts.at(-1) ?? "0", 10);
    if (!Number.isNaN(background)) {
      return background <= 6 ? "dark" : "light";
    }
  }

  const termBackground = getEnv("TERM_BACKGROUND");
  if (termBackground === "light") return "light";
  if (termBackground === "dark") return "dark";

  return "dark";
};

export const ThemeProvider = ({
  children,
  theme = defaultTheme,
}: ThemeProviderProps) => {
  const [currentTheme, setCurrentTheme] = useState(theme);

  useEffect(() => {
    setCurrentTheme(theme);
  }, [theme]);

  const themeValue = useMemo(
    () => ({ setTheme: setCurrentTheme, theme: currentTheme }),
    [currentTheme],
  );

  return (
    <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>
  );
};

export const AutoThemeProvider = ({
  children,
  darkTheme,
  lightTheme,
}: AutoThemeProviderProps) => {
  const scheme = detectColorScheme();
  return (
    <ThemeProvider theme={scheme === "dark" ? darkTheme : lightTheme}>
      {children}
    </ThemeProvider>
  );
};

export const createTheme = (
  overrides: Partial<Theme> & { name: string },
): Theme => ({
  ...defaultTheme,
  ...overrides,
  border: { ...defaultTheme.border, ...overrides.border },
  colors: { ...defaultTheme.colors, ...overrides.colors },
  spacing: { ...defaultTheme.spacing, ...overrides.spacing },
  typography: { ...defaultTheme.typography, ...overrides.typography },
});
