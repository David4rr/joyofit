import { useEffect } from "react";

const STAGGER_MS = 70;
const MAX_STEPS = 3;
/** The reveal transition is 300 ms (index.css); drop the attribute once it and its stagger are done. */
const SETTLE_MS = 300 + STAGGER_MS * MAX_STEPS + 100;

/**
 * The blocks to reveal inside a section: its children, or one level down when the section only wraps a single div.
 * Backgrounds and borders stay on the section, so only content moves.
 */
function blocks(section: Element): HTMLElement[] {
  let kids = Array.from(section.children);
  if (kids.length === 1 && kids[0].tagName === "DIV") kids = Array.from(kids[0].children);
  return kids.filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/**
 * Fades and lifts each below-the-fold block of the home page once as it scrolls into view.
 *
 * The page is prerendered fully visible. Only after hydration do blocks that start below the viewport get
 * data-reveal="pending" (opacity and translate only, see index.css); blocks already on screen are never touched, so
 * the first screen and LCP are unaffected, and nothing here changes layout. Without JavaScript, IntersectionObserver
 * or with reduced motion, nothing is hidden.
 */
export function useScrollReveal(): void {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timers = new Set<number>();
    const touched = new Set<HTMLElement>();
    const clear = (el: HTMLElement) => {
      el.removeAttribute("data-reveal");
      el.style.removeProperty("transition-delay");
    };
    const io = new IntersectionObserver(
      (entries) => {
        const ready = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        let step = 0;
        for (const entry of ready) {
          const el = entry.target as HTMLElement;
          io.unobserve(el);
          past.unobserve(el);
          el.style.transitionDelay = `${Math.min(step++, MAX_STEPS) * STAGGER_MS}ms`;
          el.setAttribute("data-reveal", "in");
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            clear(el);
          }, SETTLE_MS);
          timers.add(timer);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    // Everything above the viewport: blocks scrolled past without being seen (jump to an anchor) show at once.
    const past = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (!entry.isIntersecting || el.getAttribute("data-reveal") !== "pending") continue;
          io.unobserve(el);
          past.unobserve(el);
          clear(el);
        }
      },
      { rootMargin: "100000px 0px -100% 0px" },
    );

    for (const section of document.querySelectorAll('main > section:not([data-section="hero"])')) {
      for (const el of blocks(section)) {
        if (el.getBoundingClientRect().top <= innerHeight) continue;
        el.setAttribute("data-reveal", "pending");
        touched.add(el);
        io.observe(el);
        past.observe(el);
      }
    }

    return () => {
      io.disconnect();
      past.disconnect();
      for (const timer of timers) clearTimeout(timer);
      for (const el of touched) clear(el);
    };
  }, []);
}
