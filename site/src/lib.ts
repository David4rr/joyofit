import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GITHUB_URL = "https://github.com/dzulfikar08/joyofit";
/** Pricing link from this site; from=joyofit and the UTM tags let JoyoRogo's sign-in and purchase goals say where the visit began. */
export const HARGA_URL =
  "https://joyorogo.com/harga?from=joyofit&utm_source=joyofit&utm_medium=site&utm_campaign=cloud";
export const CLOUDAGNI_URL = "https://cloudagni.my.id";
export const JOYOROGO_URL = "https://joyorogo.com";
export const TRAKTEER_URL = "https://trakteer.id/dzulfikar_ats_tsauri";
export const TESTER_GROUP_URL = "https://groups.google.com/g/joyofit-testers";
export const TESTER_OPTIN_URL = "https://play.google.com/apps/testing/com.joyodigitama.joyofit";
export const CONTACT_EMAIL = "dzulfikar.at@gmail.com";
export const DUKUNG_JAM_PATH = "/dukung-jam";
export const WATCH_REPORTS_URL = `${GITHUB_URL}/issues?q=is%3Aissue+label%3Awatch-report`;
export const WATCH_REPORT_FORM_URL = `${GITHUB_URL}/issues/new?template=watch-report.yml`;
export const WATCH_REQUEST_URL = `${GITHUB_URL}/issues/new?title=${encodeURIComponent("[Permintaan jam] ")}&body=${encodeURIComponent("Model jam:\nNama Bluetooth di HP (kalau tahu):\nSaya bisa: bantu uji / pinjamkan jam / hanya meminta\n")}`;

/** Sets one attribute on the first element matching [selector] in the document head. */
export function setMeta(selector: string, attr: string, value: string) {
  document.head.querySelector(selector)?.setAttribute(attr, value);
}

/** RevKlik click goal for a link or button (same attributes as JoyoRogo's data-revklik-goal convention). */
export function goal(name: string, location: string) {
  return { "data-revklik-goal": name, "data-revklik-goal-location": location } as const;
}

/**
 * Flip to true once Apple approves the JoyoFit TestFlight beta for external
 * testers. While false, the site shows no iPhone beta and still says there
 * is no iPhone version.
 */
export const IOS_TESTFLIGHT_LIVE = true;
export const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/GXzrQ8GJ";

export const STRAVA_PATH = "/strava";
export const IPHONE_PATH = "/iphone";
/** JoyoFit Worker; `POST /v1/waitlist` takes the /strava and /iphone forms. */
export const WAITLIST_API = "https://api.fit.joyorogo.com/v1/waitlist";
