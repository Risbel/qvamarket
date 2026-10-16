import { useEffect, useState, type RefObject } from "react";

/** How far (px) the page must scroll in one direction before a bar hides or comes back. */
const SCROLL_TOLERANCE = 8;

/** Until this moment (performance.now()) scrolling never hides the bars. */
let holdUntil = 0;

/**
 * Keeps every bar shown through the scroll that follows, e.g. the jump from a category
 * link: the section heading then lands right under the bars (its scroll margin counts
 * them) instead of under a gap they left by sliding away.
 */
export function holdBars(ms = 500) {
  holdUntil = performance.now() + ms;
}

/**
 * Whether a sticky bar under the store header should be slid away: true while the shopper
 * scrolls down (more room for products), false again on any scroll up, near the top of the
 * page, or while focus is inside the bar (typing, tabbing through its links).
 */
export function useHideOnScroll(bar: RefObject<HTMLElement | null>, enabled = true) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.max(window.scrollY, 0); // iOS bounces below 0
      const height = bar.current?.offsetHeight ?? 0;
      if (y <= height) setHidden(false); // back at the top: always shown
      else if (performance.now() < holdUntil) setHidden(false);
      else if (bar.current?.contains(document.activeElement)) setHidden(false);
      else if (y - last > SCROLL_TOLERANCE) setHidden(true);
      else if (last - y > SCROLL_TOLERANCE) setHidden(false);
      else return; // small moves keep the anchor point, so slow scrolls still count
      last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [bar, enabled]);

  return enabled && hidden;
}
