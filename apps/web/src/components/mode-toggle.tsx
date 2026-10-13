"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = ["light", "dark", "system"] as const;

/** Light / dark / system switch (shadcn "mode toggle"). The choice is kept in localStorage. */
export function ModeToggle({ className }: { className?: string }) {
  const t = useTranslations("Theme");
  // `theme` is undefined until mounted (the server does not know it); the menu only opens after
  const { theme = "system", setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className={className} aria-label={t("toggle")} />}
      >
        {/* Pure CSS swap, so the right icon shows before hydration */}
        <SunIcon className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
        <MoonIcon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value: string) => setTheme(value)}>
          {THEMES.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {t(key)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
