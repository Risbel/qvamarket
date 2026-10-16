import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The round buttons over a product image (heart, eye): a shadcn outline icon button, made
 * round and translucent. A plain module, not "use client", so server components can use it too.
 */
export const IMAGE_BUTTON = cn(
  buttonVariants({ variant: "outline", size: "icon-lg" }),
  "rounded-full bg-background/85 shadow-sm backdrop-blur hover:scale-110 dark:bg-background/85",
);
