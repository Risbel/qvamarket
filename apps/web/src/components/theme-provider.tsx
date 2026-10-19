"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// next-themes renders an inline <script> that applies the theme before the first paint. It only
// has to run in the server HTML; when React creates it in the browser (a layout remounted on the
// client), React 19 warns that scripts created there never run. A non-JavaScript type makes it a
// data block in the browser, which React accepts (the script has suppressHydrationWarning).
const scriptProps = typeof window === "undefined" ? undefined : { type: "application/json" };

/** Light / dark / system theme: toggles the `dark` class on <html> (see globals.css). */
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider scriptProps={scriptProps} {...props}>
      {children}
    </NextThemesProvider>
  );
}
