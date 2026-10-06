// Provider-optional theme context. `useTheme()` works even without a provider.
import { createContext, useContext } from "react";
import { defaultTheme } from "./theme-purple";
import type { Theme, ThemeContextValue } from "./types";

export const ThemeContext = createContext<ThemeContextValue>({
  setTheme: () => {
    // The default context keeps useTheme provider-optional.
  },
  theme: defaultTheme,
});

export const useTheme = (): Theme => useContext(ThemeContext).theme;

export const useThemeUpdater = (): ((theme: Theme) => void) =>
  useContext(ThemeContext).setTheme;
