/**
 * Number and time text for the screens. Pure; no padStart or toLocaleString (the Lite runtime is not known to have them).
 */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 75 -> "1:15", 3725 -> "1:02:05". Negative, NaN and fractions round down to whole seconds. */
export function formatDuration(totalSec) {
  var s = totalSec > 0 ? Math.floor(totalSec) : 0;
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(sec);
  return m + ':' + pad2(sec);
}

/** Whole kcal: 311.6 -> "312". */
export function formatKcal(kcal) {
  return '' + Math.round(kcal > 0 ? kcal : 0);
}

/** Grams with one decimal: 4.449 -> "4.4"; 0 -> "0.0". */
export function formatGrams(grams) {
  var g = grams > 0 ? grams : 0;
  var tenths = Math.round(g * 10);
  return Math.floor(tenths / 10) + '.' + (tenths % 10);
}

/** Share 0..1 as a whole percent text: 0.349 -> "35%". null gives "--". */
export function formatPercent(share) {
  if (share === null || share === undefined) return '--';
  return Math.round(share * 100) + '%';
}

/** Heart rate for display: whole bpm, "--" for null. */
export function formatBpm(hr) {
  if (hr === null || hr === undefined) return '--';
  return '' + Math.round(hr);
}

/** Pixel width of the fat part of a bar `totalPx` wide; an empty (null) share splits it in halves. */
export function fatBarPx(share, totalPx) {
  if (share === null || share === undefined) return Math.round(totalPx / 2);
  var s = share < 0 ? 0 : share > 1 ? 1 : share;
  return Math.round(s * totalPx);
}
