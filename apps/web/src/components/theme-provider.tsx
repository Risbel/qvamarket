"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Light / dark / system theme: toggles the `dark` class on <html> (see globals.css). */
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
