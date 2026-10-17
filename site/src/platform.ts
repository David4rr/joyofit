import { useSyncExternalStore } from "react";

export type Platform = "android" | "ios" | "other";

type UaData = { platform?: string };

/** The visitor's phone OS. Never runs on the server; the server snapshot below is "other". */
function detect(): Platform {
  const nav = navigator as Navigator & { userAgentData?: UaData };
  const uaPlatform = nav.userAgentData?.platform ?? "";
  if (/android/i.test(uaPlatform) || /Android/i.test(nav.userAgent)) return "android";
  // iPadOS asks for the desktop site and reports itself as a Mac with a touch screen.
  if (/iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)) return "ios";
  return "other";
}

const subscribe = () => () => {};

/**
 * "other" while rendering on the server and during hydration, so the prerendered HTML and the first client render
 * match; the real OS follows right after hydration.
 */
export function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, detect, () => "other");
}
