"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One icon button that flips between light and dark. Until the visitor clicks it the theme
 * follows the system (the provider's default); the choice is then kept in localStorage.
 */
export function ModeToggle({ className }: { className?: string }) {
  const t = useTranslations("Theme");
  const { setTheme } = useTheme();

  function toggle() {
    // The class on <html> is what is shown right now (also before hydration, and for "system")
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("relative", className)}
      aria-label={t("toggle")}
      onClick={toggle}
    >
      {/* Pure CSS swap, so the right icon shows before hydration */}
      <SunIcon className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <MoonIcon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
}
